"""Weather risk rules from the assessment brief.

Condition   Low     Moderate    High        Severe      No Travel
Wind (mph)  <25     25-34       35-44       45-54       >=55
Rain (in/h) <0.10   0.10-0.25   0.25-0.50   0.50-1.00   >1.00
Snow (in/h) <0.5    0.5-1.0     1.0-2.0     2.0-3.0     >3.0

Load rules (wind only):
  >=55 mph                  -> No Travel for any load
  45-54 mph and >30,000 lb  -> No Travel
  35-44 mph and >40,000 lb  -> Severe

A value sitting exactly on a shared boundary (e.g. 0.25 in/hr rain) goes to
the higher band, except the top one where the table says "greater than".
"""

from dataclasses import dataclass
from enum import IntEnum
from typing import Optional


class Level(IntEnum):
    LOW = 0
    MODERATE = 1
    HIGH = 2
    SEVERE = 3
    NO_TRAVEL = 4

    @property
    def slug(self):
        return self.name.lower()

    @property
    def label(self):
        return self.name.replace("_", " ").title()


# lower bound of Moderate, High, Severe, No Travel
WIND_MPH = (25, 35, 45, 55)
RAIN_IN_HR = (0.10, 0.25, 0.50, 1.00)
SNOW_IN_HR = (0.5, 1.0, 2.0, 3.0)

HEAVY_LOAD_LBS = 40000
MEDIUM_LOAD_LBS = 30000


@dataclass
class Conditions:
    wind_mph: Optional[float] = None
    gust_mph: Optional[float] = None
    rain_in: Optional[float] = None
    snow_in: Optional[float] = None
    temp_f: Optional[float] = None

    @property
    def known(self):
        return None not in (self.wind_mph, self.rain_in, self.snow_in)


def _band(value, bounds, top_exclusive=False):
    level = 0
    for i, bound in enumerate(bounds):
        last = i == len(bounds) - 1
        if value > bound or (value == bound and not (last and top_exclusive)):
            level = i + 1
    return Level(level)


def wind_level(mph, load_lbs=0):
    level = _band(mph, WIND_MPH)
    if level == Level.SEVERE and load_lbs > MEDIUM_LOAD_LBS:
        return Level.NO_TRAVEL
    if level == Level.HIGH and load_lbs > HEAVY_LOAD_LBS:
        return Level.SEVERE
    return level


def rain_level(in_per_hr):
    return _band(in_per_hr, RAIN_IN_HR, top_exclusive=True)


def snow_level(in_per_hr):
    return _band(in_per_hr, SNOW_IN_HR, top_exclusive=True)


@dataclass
class Assessment:
    level: Level
    wind: Level
    rain: Level
    snow: Level
    reason: str


def assess(conditions, load_lbs):
    """Overall level at a checkpoint is the worst of the three conditions."""
    if not conditions.known:
        return None

    wind = wind_level(conditions.wind_mph, load_lbs)
    rain = rain_level(conditions.rain_in)
    snow = snow_level(conditions.snow_in)
    level = max(wind, rain, snow)

    parts = []
    if level > Level.LOW:
        if wind == level:
            text = "wind %d mph" % round(conditions.wind_mph)
            if wind > wind_level(conditions.wind_mph):
                text += " with a %s lb load" % format(int(load_lbs), ",")
            parts.append(text)
        if rain == level:
            parts.append("rain %.2f in/hr" % conditions.rain_in)
        if snow == level:
            parts.append("snow %.1f in/hr" % conditions.snow_in)
    reason = ", ".join(parts) if parts else "No significant weather"
    return Assessment(level, wind, rain, snow, reason)


def _score(value, bounds):
    """Continuous 0-4 position on a threshold scale, used by the heatmap."""
    if value <= 0:
        return 0.0
    stops = (0,) + tuple(bounds)
    for i in range(len(stops) - 1):
        lo, hi = stops[i], stops[i + 1]
        if value < hi:
            return i + (value - lo) / (hi - lo)
    return 4.0


def wind_score(mph, load_lbs=0):
    # the load rules bump whole bands, so never report less than the level
    return max(_score(mph, WIND_MPH), float(wind_level(mph, load_lbs)))


def rain_score(in_per_hr):
    return _score(in_per_hr, RAIN_IN_HR)


def snow_score(in_per_hr):
    return _score(in_per_hr, SNOW_IN_HR)
