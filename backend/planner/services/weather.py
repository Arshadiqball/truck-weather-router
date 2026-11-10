"""Hourly forecasts from Open-Meteo."""

import hashlib
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import timezone

import requests
from django.conf import settings
from django.core.cache import cache

from .risk import Conditions

log = logging.getLogger(__name__)

VARIABLES = "wind_speed_10m,wind_gusts_10m,rain,showers,snowfall,temperature_2m"
BATCH_SIZE = 100  # locations per request
CACHE_SECONDS = 10 * 60
TIMEOUT = 30

# Forecast models are a few miles per cell at best, so nearby points share a
# lookup. Keeps us well inside Open-Meteo's free limits, since the three
# routes usually overlap near both ends.
SNAP_DEGREES = 0.05


class WeatherError(Exception):
    pass


class Forecast:
    """Hourly conditions for a list of points over one time window."""

    def __init__(self, hours, series):
        self.hours = hours
        self._series = series
        self._hour_index = {ts: i for i, ts in enumerate(hours)}

    def at(self, point_idx, when):
        """Conditions for the forecast hour closest to `when`."""
        ts = int(round(when.timestamp() / 3600.0)) * 3600
        i = self._hour_index.get(ts)
        if i is None:
            return Conditions()
        return self.hourly(point_idx)[i]

    def hourly(self, point_idx):
        return self._series[point_idx]


def get_forecast(points, start, end):
    """Fetch the hourly forecast for `points` between two aware datetimes."""
    snapped = [_snap(p) for p in points]
    unique = sorted(set(snapped))
    batches = [unique[i:i + BATCH_SIZE] for i in range(0, len(unique), BATCH_SIZE)]

    start_hour = start.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:00")
    end_hour = end.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:00")

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda b: _fetch_batch(b, start_hour, end_hour), batches))

    hours = []
    by_point = {}
    for batch, locations in zip(batches, results):
        for point, loc in zip(batch, locations):
            hourly = loc["hourly"]
            hours = hours or hourly["time"]
            by_point[point] = _to_conditions(hourly)

    return Forecast(hours, [by_point[p] for p in snapped])


def _snap(point):
    lat = round(round(point[0] / SNAP_DEGREES) * SNAP_DEGREES, 2)
    lon = round(round(point[1] / SNAP_DEGREES) * SNAP_DEGREES, 2)
    return lat, lon


def _fetch_batch(points, start_hour, end_hour):
    params = {
        "latitude": ",".join(str(p[0]) for p in points),
        "longitude": ",".join(str(p[1]) for p in points),
        "hourly": VARIABLES,
        "wind_speed_unit": "mph",
        "precipitation_unit": "inch",
        "temperature_unit": "fahrenheit",
        "timeformat": "unixtime",
        "timezone": "GMT",
        "start_hour": start_hour,
        "end_hour": end_hour,
    }
    key = "wx:" + hashlib.md5(repr(sorted(params.items())).encode()).hexdigest()
    data = cache.get(key)
    if data is not None:
        return data

    try:
        resp = requests.get(
            settings.OPEN_METEO_URL, params=params, headers=settings.HTTP_HEADERS, timeout=TIMEOUT
        )
    except requests.RequestException as exc:
        raise WeatherError("The weather service could not be reached.") from exc

    if resp.status_code == 429:
        raise WeatherError("Weather service rate limit reached. Try again in a minute.")
    if not resp.ok:
        log.warning("open-meteo %s: %s", resp.status_code, resp.text[:200])
        raise WeatherError("The weather service returned an error.")

    data = resp.json()
    if isinstance(data, dict):  # a single location is not wrapped in a list
        data = [data]
    cache.set(key, data, CACHE_SECONDS)
    return data


def _to_conditions(hourly):
    out = []
    rows = zip(
        hourly["wind_speed_10m"],
        hourly["wind_gusts_10m"],
        hourly["rain"],
        hourly["showers"],
        hourly["snowfall"],
        hourly["temperature_2m"],
    )
    for wind, gust, rain, showers, snow, temp in rows:
        if rain is not None and showers is not None:
            rain += showers
        out.append(Conditions(wind_mph=wind, gust_mph=gust, rain_in=rain, snow_in=snow, temp_f=temp))
    return out
