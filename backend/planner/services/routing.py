"""Truck route options from Valhalla (public FOSSGIS instance by default)."""

import logging
import math
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import List, Tuple

import requests
from django.conf import settings
from django.core.cache import cache

from . import geo

log = logging.getLogger(__name__)

ROUTE_COUNT = 3
CACHE_SECONDS = 15 * 60
TIMEOUT = 45

# Rough empty weight of a tractor + 53' trailer, used to turn the load into a
# gross weight for Valhalla's truck profile.
EMPTY_TRUCK_LBS = 32000
MAX_GROSS_LBS = 80000
LBS_PER_TONNE = 2204.62

# A detour only counts as another option if it is reasonably different from
# the routes we already have and not absurdly slow.
MAX_OVERLAP = 0.8
MAX_SLOWDOWN = 1.6

# Valhalla error code for "path distance exceeds the max distance limit"
TOO_FAR = 154


class RoutingError(Exception):
    pass


@dataclass
class Route:
    coords: List[Tuple[float, float]]
    duration_s: float
    via: str = ""
    cum_miles: List[float] = field(default_factory=list)
    cum_seconds: List[float] = field(default_factory=list)

    def __post_init__(self):
        if not self.cum_miles:
            self.cum_miles = geo.cumulative_miles(self.coords)

    @property
    def distance_miles(self):
        return self.cum_miles[-1]

    def position_at(self, mile):
        """Point on the route and seconds since departure at a given mile."""
        point, i, t = geo.interpolate_along(self.coords, self.cum_miles, mile)
        a, b = self.cum_seconds[i], self.cum_seconds[i + 1]
        return point, a + (b - a) * t


def get_routes(origin, destination, load_lbs):
    """Return up to three distinct truck routes, fastest first."""
    weight = _gross_tonnes(load_lbs)
    key = "routes:%.4f,%.4f:%.4f,%.4f:%.0f" % (*origin, *destination, weight)
    routes = cache.get(key)
    if routes is None:
        routes = _find_routes(origin, destination, weight)
        cache.set(key, routes, CACHE_SECONDS)
    return routes


def _find_routes(origin, destination, weight):
    routes = _request([origin, destination], weight, alternates=ROUTE_COUNT - 1)

    # Valhalla often comes back with fewer alternates than asked for,
    # especially on long hauls. Fill the gap with our own candidates and
    # keep the quickest ones that really are different roads.
    if len(routes) < ROUTE_COUNT:
        for candidate in sorted(_extra_candidates(origin, destination, weight), key=lambda r: r.duration_s):
            if len(routes) == ROUTE_COUNT:
                break
            if _is_distinct(candidate, routes):
                routes.append(candidate)

    routes.sort(key=lambda r: r.duration_s)
    return routes


def _extra_candidates(origin, destination, weight):
    """Other ways to make the trip: detours either side, and routing tweaks."""
    jobs = [{"points": [origin, via, destination]} for via in _detour_points(origin, destination)]
    jobs.append({"points": [origin, destination], "options": {"use_highways": 0.4}})
    jobs.append({"points": [origin, destination], "options": {"use_tolls": 0.0}})

    def attempt(job):
        try:
            return _request(job["points"], weight, options=job.get("options"))[0]
        except RoutingError:
            return None

    with ThreadPoolExecutor(max_workers=3) as pool:
        return [route for route in pool.map(attempt, jobs) if route]


def _gross_tonnes(load_lbs):
    gross = min(EMPTY_TRUCK_LBS + load_lbs, MAX_GROSS_LBS)
    return round(gross / LBS_PER_TONNE, 1)


def _request(points, weight, alternates=0, options=None):
    locations = [{"lat": lat, "lon": lon} for lat, lon in points]
    for loc in locations[1:-1]:
        loc["type"] = "through"
        # snap the forced point to a proper road, not a farm track
        loc["search_filter"] = {"min_road_class": "secondary"}

    body = {
        "locations": locations,
        "costing": "truck",
        "costing_options": {"truck": dict(options or {}, weight=weight)},
        "units": "miles",
    }
    if alternates:
        body["alternates"] = alternates

    try:
        resp = requests.post(
            settings.VALHALLA_URL + "/route", json=body, headers=settings.HTTP_HEADERS, timeout=TIMEOUT
        )
    except requests.RequestException as exc:
        raise RoutingError("The routing service could not be reached.") from exc

    if resp.status_code == 400:
        error = resp.json()
        log.info("valhalla rejected request: %s", error.get("error"))
        if error.get("error_code") == TOO_FAR:
            raise RoutingError(
                "This trip is too long for the routing service (about 930 miles in a straight line)."
            )
        raise RoutingError("No truck route found between these places.")
    if not resp.ok:
        raise RoutingError("The routing service is unavailable right now (HTTP %s)." % resp.status_code)

    data = resp.json()
    trips = [data["trip"]] + [alt["trip"] for alt in data.get("alternates", [])]
    return [_parse_trip(trip) for trip in trips]


def _parse_trip(trip):
    coords, seconds = [], []
    road_miles = {}
    elapsed = 0.0

    for leg in trip["legs"]:
        shape = geo.decode_polyline(leg["shape"])
        leg_seconds = [elapsed] * len(shape)

        # Valhalla gives time per maneuver; spread it over the maneuver's
        # shape points by distance so we can get an ETA anywhere on the line.
        for man in leg["maneuvers"]:
            begin, end = man["begin_shape_index"], man["end_shape_index"]
            dist = geo.cumulative_miles(shape[begin:end + 1])
            for k in range(begin, end + 1):
                share = dist[k - begin] / dist[-1] if dist[-1] else 1.0
                leg_seconds[k] = elapsed + man["time"] * share
            elapsed += man["time"]

            names = man.get("street_names")
            if names:
                road_miles[names[0]] = road_miles.get(names[0], 0) + man["length"]

        # legs share their joining point
        skip = 1 if coords else 0
        coords.extend(shape[skip:])
        seconds.extend(leg_seconds[skip:])

    main_roads = sorted(road_miles, key=road_miles.get, reverse=True)[:3]
    return Route(coords=coords, duration_s=elapsed, via=", ".join(main_roads), cum_seconds=seconds)


def _detour_points(origin, destination):
    """Points either side of the midpoint, nearer ones first."""
    mid_lat = (origin[0] + destination[0]) / 2
    mid_lon = (origin[1] + destination[1]) / 2
    kx = math.cos(math.radians(mid_lat)) or 1e-6
    dx = (destination[1] - origin[1]) * kx
    dy = destination[0] - origin[0]

    points = []
    for frac in (0.12, 0.22):
        for side in (1, -1):
            points.append((mid_lat + dx * frac * side, mid_lon - dy * frac * side / kx))
    return points


def _is_distinct(candidate, routes):
    fastest = min(r.duration_s for r in routes)
    if candidate.duration_s > fastest * MAX_SLOWDOWN:
        return False
    return all(_overlap(candidate, r) < MAX_OVERLAP for r in routes)


def _overlap(candidate, other, samples=40):
    """Share of `candidate` that runs close to `other`."""
    tolerance = min(5.0, max(0.5, other.distance_miles * 0.02))
    ref = _sample(other, tolerance)
    near = 0
    for point in _sample(candidate, candidate.distance_miles / samples):
        if any(geo.haversine_miles(point, r) <= tolerance for r in ref):
            near += 1
    return near / (samples + 1)


def _sample(route, spacing):
    count = max(1, int(round(route.distance_miles / spacing)))
    return [
        geo.interpolate_along(route.coords, route.cum_miles, route.distance_miles * i / count)[0]
        for i in range(count + 1)
    ]
