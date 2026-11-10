"""Place search backed by Photon (OpenStreetMap data, built for autocomplete)."""

import requests
from django.conf import settings
from django.core.cache import cache

CACHE_SECONDS = 24 * 60 * 60
TIMEOUT = 10


class GeocodingError(Exception):
    pass


def search(query, limit=6):
    query = " ".join(query.split())
    key = "geocode:%s:%d" % (query.lower(), limit)
    places = cache.get(key)
    if places is not None:
        return places

    try:
        resp = requests.get(
            settings.PHOTON_URL,
            params={"q": query, "limit": limit, "lang": "en"},
            headers=settings.HTTP_HEADERS,
            timeout=TIMEOUT,
        )
        resp.raise_for_status()
    except requests.RequestException as exc:
        raise GeocodingError("Place search is unavailable right now.") from exc

    places = []
    for feature in resp.json().get("features", []):
        lon, lat = feature["geometry"]["coordinates"]
        label = _label(feature["properties"])
        if label and not any(p["label"] == label for p in places):
            places.append({"label": label, "lat": lat, "lon": lon})

    cache.set(key, places, CACHE_SECONDS)
    return places


def _label(props):
    street = props.get("street")
    if street and props.get("housenumber"):
        street = "%s %s" % (props["housenumber"], street)

    parts = [props.get("name"), street, props.get("city"), props.get("state"), props.get("country")]
    seen = []
    for part in parts:
        if part and part not in seen:
            seen.append(part)
    return ", ".join(seen)
