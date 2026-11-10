from django.test import SimpleTestCase

from planner.services import recommend
from planner.services.risk import Level

HOUR = 3600


def stats(hours, **miles):
    """stats(5, low=200, high=20) -> a 5 hour route with those miles per level."""
    segments = [(m, Level[name.upper()]) for name, m in miles.items()]
    return recommend.summarize(segments, hours * HOUR)


class SummarizeTests(SimpleTestCase):
    def test_miles_and_average(self):
        s = stats(4, low=150, moderate=50)
        self.assertEqual(s.miles[Level.LOW], 150)
        self.assertEqual(s.miles[Level.MODERATE], 50)
        self.assertAlmostEqual(s.avg_risk, 0.25)
        self.assertEqual(s.worst, Level.MODERATE)

    def test_unknown_miles_are_left_out_of_the_average(self):
        s = recommend.summarize([(100, Level.HIGH), (100, None)], HOUR)
        self.assertEqual(s.unknown_miles, 100)
        self.assertAlmostEqual(s.avg_risk, 2.0)


class RankTests(SimpleTestCase):
    def test_fewest_severe_miles_beats_everything_else(self):
        fast_but_severe = stats(4, low=180, severe=20)
        slow_and_high = stats(7, low=100, high=150)
        self.assertEqual(recommend.rank([fast_but_severe, slow_and_high]), [1, 0])

    def test_high_miles_break_a_severe_tie(self):
        a = stats(4, low=150, high=50)
        b = stats(5, low=190, high=10)
        self.assertEqual(recommend.rank([a, b]), [1, 0])

    def test_average_risk_breaks_a_high_tie(self):
        a = stats(4, low=100, moderate=100)
        b = stats(5, low=180, moderate=20)
        self.assertEqual(recommend.rank([a, b]), [1, 0])

    def test_time_decides_when_weather_is_equal(self):
        a = stats(6, low=300)
        b = stats(5, low=320)
        c = stats(5.5, low=310)
        self.assertEqual(recommend.rank([a, b, c]), [1, 2, 0])

    def test_no_travel_is_worse_than_severe(self):
        a = stats(4, low=190, no_travel=10)
        b = stats(4, low=150, severe=50)
        self.assertEqual(recommend.rank([a, b]), [1, 0])

    def test_tiny_differences_do_not_outweigh_time(self):
        a = stats(8, low=300)
        b = stats(5, low=299.7, high=0.3)
        self.assertEqual(recommend.rank([a, b]), [1, 0])


class ExplainTests(SimpleTestCase):
    def test_names_the_deciding_rule_and_the_time_cost(self):
        best = stats(5, low=200)
        fastest = stats(4, low=180, high=20)
        text = recommend.explain(best, fastest, "Route A")
        self.assertEqual(
            text, "Fewer High-risk miles than Route A (0 mi vs 20 mi), for 60 min more driving."
        )

    def test_equal_weather(self):
        text = recommend.explain(stats(4, low=200), stats(4.5, low=210), "Route B")
        self.assertEqual(text, "Same weather risk as Route B and 30 min faster.")

    def test_single_route(self):
        self.assertIn("Only one route", recommend.explain(stats(4, low=200), None, ""))

    def test_advisory(self):
        self.assertIsNone(recommend.advisory(stats(4, low=200, high=30)))
        self.assertIn("Severe", recommend.advisory(stats(4, low=200, severe=30)))
        self.assertIn("No Travel", recommend.advisory(stats(4, low=200, no_travel=30)))
