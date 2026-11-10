"""Route scoring and the recommendation.

Routes are ranked by, in order:
  1. fewest Severe miles
  2. fewest High miles
  3. lowest average risk
  4. shortest travel time

The brief doesn't list No Travel miles, but a route you shouldn't drive at
all is clearly worse than a Severe one, so those are compared first.
"""

from dataclasses import dataclass
from typing import Dict

from .risk import Level


@dataclass
class RouteStats:
    miles: Dict[Level, float]
    unknown_miles: float
    avg_risk: float
    duration_s: float

    @property
    def worst(self):
        hit = [level for level, miles in self.miles.items() if miles > 0]
        return max(hit) if hit else None

    def sort_key(self):
        # Round so that a fraction of a mile or a hair of average risk
        # doesn't beat a route that is an hour faster.
        return (
            round(self.miles[Level.NO_TRAVEL]),
            round(self.miles[Level.SEVERE]),
            round(self.miles[Level.HIGH]),
            round(self.avg_risk, 2),
            self.duration_s,
        )


def summarize(segments, duration_s):
    """`segments` is a list of (miles, Level or None) pairs covering a route."""
    miles = {level: 0.0 for level in Level}
    unknown = 0.0
    for length, level in segments:
        if level is None:
            unknown += length
        else:
            miles[level] += length

    known = sum(miles.values())
    weighted = sum(int(level) * m for level, m in miles.items())
    avg = weighted / known if known else 0.0
    return RouteStats(miles=miles, unknown_miles=unknown, avg_risk=avg, duration_s=duration_s)


def rank(stats):
    """Indexes of `stats` from best to worst."""
    return sorted(range(len(stats)), key=lambda i: stats[i].sort_key())


def explain(best, rival, rival_name):
    """One sentence on why `best` was picked over `rival`.

    The caller passes the fastest route as the rival when the pick isn't the
    fastest itself, since that's the comparison a driver cares about.
    """
    if rival is None:
        return "Only one route was found for this trip."

    a, b = best.sort_key(), rival.sort_key()
    extra_min = round((a[4] - b[4]) / 60)
    cost = ", for %d min more driving" % extra_min if extra_min > 0 else ""

    if a[0] != b[0]:
        return "Fewer No Travel miles than %s (%d mi vs %d mi)%s." % (rival_name, a[0], b[0], cost)
    if a[1] != b[1]:
        return "Fewer Severe miles than %s (%d mi vs %d mi)%s." % (rival_name, a[1], b[1], cost)
    if a[2] != b[2]:
        return "Fewer High-risk miles than %s (%d mi vs %d mi)%s." % (rival_name, a[2], b[2], cost)
    if a[3] != b[3]:
        return "Lower average weather risk than %s (%.2f vs %.2f)%s." % (rival_name, a[3], b[3], cost)
    if extra_min < 0:
        return "Same weather risk as %s and %d min faster." % (rival_name, -extra_min)
    return "Tied with %s on weather risk and travel time." % rival_name


def advisory(best):
    if best.miles[Level.NO_TRAVEL] >= 0.5:
        return (
            "Even the best route crosses No Travel conditions. "
            "Consider a different departure time."
        )
    if best.miles[Level.SEVERE] >= 0.5:
        return "Even the best route has Severe stretches. Drive with caution or delay departure."
    return None
