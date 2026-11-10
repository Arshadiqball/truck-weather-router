"""Gridded 48-hour forecast around the routes, for the map heatmap."""

from datetime import timedelta

from django.utils import timezone

from . import risk, weather

HOURS = 48
MAX_CELLS = 220

# Candidate grid sizes in degrees. We take the finest one that keeps the
# corridor under MAX_CELLS so a cross-country trip costs about the same as a
# short one. All are multiples of the weather snap size.
STEPS = (0.1, 0.15, 0.25, 0.4, 0.5, 0.75, 1.0, 1.5, 2.0)


def corridor_heatmap(paths, load_lbs):
    """`paths` is a list of [(lat, lon), ...] lines, one per route."""
    step, cells = _pick_grid(paths)
    cells = sorted(cells)

    start = timezone.now().replace(minute=0, second=0, microsecond=0)
    centers = [(row * step, col * step) for col, row in cells]
    forecast = weather.get_forecast(centers, start, start + timedelta(hours=HOURS))

    min_col = min(col for col, _ in cells)
    min_row = min(row for _, row in cells)
    out = []
    for i, (col, row) in enumerate(cells):
        layers = {"risk": [], "wind": [], "rain": [], "snow": []}
        for conditions in forecast.hourly(i):
            if not conditions.known:
                for values in layers.values():
                    values.append(None)
                continue
            wind = risk.wind_score(conditions.wind_mph, load_lbs)
            rain = risk.rain_score(conditions.rain_in)
            snow = risk.snow_score(conditions.snow_in)
            layers["wind"].append(round(wind, 2))
            layers["rain"].append(round(rain, 2))
            layers["snow"].append(round(snow, 2))
            layers["risk"].append(round(max(wind, rain, snow), 2))
        out.append({"col": col - min_col, "row": row - min_row, **layers})

    return {
        "step": step,
        "west": round(min_col * step, 4),
        "south": round(min_row * step, 4),
        "cols": max(col for col, _ in cells) - min_col + 1,
        "rows": max(row for _, row in cells) - min_row + 1,
        "hours": forecast.hours,
        "cells": out,
    }


def _pick_grid(paths):
    for step in STEPS:
        cells = _corridor_cells(paths, step)
        if len(cells) <= MAX_CELLS:
            break
    return step, cells


def _corridor_cells(paths, step):
    """Grid cells (col, row) touching the routes, plus one cell either side."""
    cells = set()
    for path in paths:
        for point in _densify(path, step / 2):
            col = int(round(point[1] / step))
            row = int(round(point[0] / step))
            for dc in (-1, 0, 1):
                for dr in (-1, 0, 1):
                    cells.add((col + dc, row + dr))

    # Fill the gaps between routes so the corridor is one solid area.
    spans = {}
    for col, row in cells:
        lo, hi = spans.get(row, (col, col))
        spans[row] = (min(lo, col), max(hi, col))
    return {(col, row) for row, (lo, hi) in spans.items() for col in range(lo, hi + 1)}


def _densify(path, max_gap):
    """Yield the path with extra points so no gap is wider than `max_gap` degrees."""
    for a, b in zip(path, path[1:]):
        gap = max(abs(b[0] - a[0]), abs(b[1] - a[1]))
        pieces = max(1, int(gap / max_gap) + 1)
        for k in range(pieces):
            t = k / pieces
            yield a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
    if path:
        yield path[-1]
