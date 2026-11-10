"""Small geometry helpers. Points are (lat, lon) tuples in degrees."""

import math
from bisect import bisect_left

EARTH_RADIUS_MILES = 3958.8


def haversine_miles(a, b):
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_MILES * math.asin(math.sqrt(h))


def decode_polyline(encoded, precision=6):
    """Decode a Google-style encoded polyline (Valhalla uses 6 decimals)."""
    factor = 10 ** precision
    coords = []
    lat = lon = 0
    i = 0
    while i < len(encoded):
        for is_lon in (False, True):
            shift = result = 0
            while True:
                byte = ord(encoded[i]) - 63
                i += 1
                result |= (byte & 0x1F) << shift
                shift += 5
                if byte < 0x20:
                    break
            delta = ~(result >> 1) if result & 1 else result >> 1
            if is_lon:
                lon += delta
            else:
                lat += delta
        coords.append((lat / factor, lon / factor))
    return coords


def cumulative_miles(coords):
    out = [0.0]
    for prev, cur in zip(coords, coords[1:]):
        out.append(out[-1] + haversine_miles(prev, cur))
    return out


def interpolate_along(coords, cum_miles, mile):
    """Return (point, segment index, fraction) at `mile` along the line."""
    if mile <= 0:
        return coords[0], 0, 0.0
    if mile >= cum_miles[-1]:
        return coords[-1], len(coords) - 2, 1.0
    i = bisect_left(cum_miles, mile)
    seg_len = cum_miles[i] - cum_miles[i - 1]
    t = (mile - cum_miles[i - 1]) / seg_len if seg_len else 0.0
    a, b = coords[i - 1], coords[i]
    point = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
    return point, i - 1, t


def simplify(coords, tolerance=0.0002):
    """Douglas-Peucker. Tolerance is in degrees (0.0002 is roughly 20 m).

    Valhalla returns ~50 points per mile, which is far more than the map
    needs. Iterative version so long routes don't hit the recursion limit.
    """
    if len(coords) < 3:
        return list(coords)

    keep = [False] * len(coords)
    keep[0] = keep[-1] = True
    stack = [(0, len(coords) - 1)]
    while stack:
        start, end = stack.pop()
        if end - start < 2:
            continue
        a, b = coords[start], coords[end]
        # scale longitude so the distance is roughly isotropic
        kx = math.cos(math.radians(a[0]))
        ax, ay = a[1] * kx, a[0]
        bx, by = b[1] * kx, b[0]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy)

        worst, worst_idx = 0.0, None
        for i in range(start + 1, end):
            px, py = coords[i][1] * kx, coords[i][0]
            if norm == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                d = abs(dy * (px - ax) - dx * (py - ay)) / norm
            if d > worst:
                worst, worst_idx = d, i
        if worst > tolerance:
            keep[worst_idx] = True
            stack.append((start, worst_idx))
            stack.append((worst_idx, end))

    return [c for c, k in zip(coords, keep) if k]
