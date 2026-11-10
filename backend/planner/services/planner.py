"""Puts routing, weather and the risk rules together for one trip."""

from datetime import timedelta

from . import geo, recommend, routing, weather
from .risk import Level, assess


def plan_trip(origin, destination, departure, load_lbs, interval_miles):
    routes = routing.get_routes(origin, destination, load_lbs)

    # Work out where and when the truck will be at every checkpoint first, so
    # the weather for all routes can be fetched in one go.
    stops = []
    for route_idx, route in enumerate(routes):
        for mile in checkpoint_miles(route.distance_miles, interval_miles):
            point, seconds = route.position_at(mile)
            stops.append((route_idx, mile, point, departure + timedelta(seconds=seconds)))

    last_eta = max(stop[3] for stop in stops)
    forecast = weather.get_forecast(
        [stop[2] for stop in stops], departure, last_eta + timedelta(hours=1)
    )

    per_route = [[] for _ in routes]
    for i, (route_idx, mile, point, eta) in enumerate(stops):
        conditions = forecast.at(i, eta)
        per_route[route_idx].append(
            {
                "mile": mile,
                "point": point,
                "eta": eta,
                "conditions": conditions,
                "risk": assess(conditions, load_lbs),
            }
        )

    stats = []
    for route, checkpoints in zip(routes, per_route):
        spans = coverage([c["mile"] for c in checkpoints], route.distance_miles)
        for checkpoint, (start, end) in zip(checkpoints, spans):
            checkpoint["from_mile"], checkpoint["to_mile"] = start, end
        segments = [
            (c["to_mile"] - c["from_mile"], c["risk"].level if c["risk"] else None)
            for c in checkpoints
        ]
        stats.append(recommend.summarize(segments, route.duration_s))

    order = recommend.rank(stats)
    best = order[0]
    names = ["Route %s" % "ABC"[i] for i in range(len(routes))]

    # Explain the pick against the fastest route (routes come sorted by time),
    # or against the runner-up when the pick is the fastest one.
    rival = None
    if len(routes) > 1:
        rival = 0 if best != 0 else order[1]
    reason = recommend.explain(
        stats[best],
        stats[rival] if rival is not None else None,
        names[rival] if rival is not None else "",
    )

    payload_routes = []
    for i, route in enumerate(routes):
        payload_routes.append(
            {
                "id": "route-%d" % (i + 1),
                "name": names[i],
                "via": route.via,
                "rank": order.index(i) + 1,
                "distance_miles": round(route.distance_miles, 1),
                "duration_s": round(route.duration_s),
                "arrival": departure + timedelta(seconds=route.duration_s),
                "geometry": [[round(lon, 5), round(lat, 5)] for lat, lon in geo.simplify(route.coords)],
                "summary": _summary_payload(stats[i]),
                "checkpoints": [_checkpoint_payload(n, c) for n, c in enumerate(per_route[i])],
            }
        )

    return {
        "departure": departure,
        "load_lbs": load_lbs,
        "interval_miles": interval_miles,
        "recommended_route_id": payload_routes[best]["id"],
        "reason": reason,
        "advisory": recommend.advisory(stats[best]),
        "routes": payload_routes,
    }


def checkpoint_miles(total, interval):
    """Mile markers to sample: the origin, every `interval` miles, the destination."""
    marks = []
    mile = 0.0
    while mile < total:
        marks.append(mile)
        mile += interval
    # don't leave a stub checkpoint right before the destination
    if len(marks) > 1 and total - marks[-1] < interval * 0.25:
        marks.pop()
    marks.append(total)
    return marks


def coverage(marks, total):
    """Stretch of road each checkpoint stands for: halfway to its neighbours."""
    spans = []
    for i, mile in enumerate(marks):
        start = 0.0 if i == 0 else (marks[i - 1] + mile) / 2
        end = total if i == len(marks) - 1 else (mile + marks[i + 1]) / 2
        spans.append((start, end))
    return spans


def _summary_payload(stats):
    return {
        "miles": {level.slug: round(stats.miles[level], 1) for level in Level},
        "unknown_miles": round(stats.unknown_miles, 1),
        "avg_risk": round(stats.avg_risk, 2),
        "worst": stats.worst.slug if stats.worst is not None else None,
    }


def _checkpoint_payload(index, checkpoint):
    conditions = checkpoint["conditions"]
    risk = checkpoint["risk"]
    lat, lon = checkpoint["point"]
    return {
        "index": index,
        "mile": round(checkpoint["mile"], 1),
        "from_mile": round(checkpoint["from_mile"], 1),
        "to_mile": round(checkpoint["to_mile"], 1),
        "lat": round(lat, 5),
        "lon": round(lon, 5),
        "eta": checkpoint["eta"],
        "weather": {
            "wind_mph": conditions.wind_mph,
            "gust_mph": conditions.gust_mph,
            "rain_in": conditions.rain_in,
            "snow_in": conditions.snow_in,
            "temp_f": conditions.temp_f,
        }
        if conditions.known
        else None,
        "risk": {
            "level": risk.level.slug,
            "wind": risk.wind.slug,
            "rain": risk.rain.slug,
            "snow": risk.snow.slug,
            "reason": risk.reason,
        }
        if risk
        else None,
    }
