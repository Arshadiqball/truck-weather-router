from django.test import SimpleTestCase

from planner.services.risk import (
    Conditions,
    Level,
    assess,
    rain_level,
    snow_level,
    wind_level,
    wind_score,
)


class WindTests(SimpleTestCase):
    def test_bands(self):
        cases = [
            (0, Level.LOW),
            (24.9, Level.LOW),
            (25, Level.MODERATE),
            (34.9, Level.MODERATE),
            (35, Level.HIGH),
            (44.9, Level.HIGH),
            (45, Level.SEVERE),
            (54.9, Level.SEVERE),
            (55, Level.NO_TRAVEL),
            (80, Level.NO_TRAVEL),
        ]
        for mph, expected in cases:
            self.assertEqual(wind_level(mph), expected, mph)

    def test_55_is_no_travel_for_any_load(self):
        for load in (0, 10000, 80000):
            self.assertEqual(wind_level(55, load), Level.NO_TRAVEL)

    def test_severe_wind_with_load_over_30k_is_no_travel(self):
        self.assertEqual(wind_level(50, 30000), Level.SEVERE)
        self.assertEqual(wind_level(50, 30001), Level.NO_TRAVEL)
        self.assertEqual(wind_level(45, 45000), Level.NO_TRAVEL)

    def test_high_wind_with_load_over_40k_is_severe(self):
        self.assertEqual(wind_level(40, 40000), Level.HIGH)
        self.assertEqual(wind_level(40, 40001), Level.SEVERE)
        # 30-40k only matters in the 45-54 band
        self.assertEqual(wind_level(40, 35000), Level.HIGH)

    def test_load_does_not_change_lower_bands(self):
        self.assertEqual(wind_level(30, 80000), Level.MODERATE)
        self.assertEqual(wind_level(10, 80000), Level.LOW)


class PrecipitationTests(SimpleTestCase):
    def test_rain_bands(self):
        cases = [
            (0, Level.LOW),
            (0.09, Level.LOW),
            (0.10, Level.MODERATE),
            (0.24, Level.MODERATE),
            (0.25, Level.HIGH),
            (0.49, Level.HIGH),
            (0.50, Level.SEVERE),
            (1.00, Level.SEVERE),
            (1.01, Level.NO_TRAVEL),
        ]
        for rate, expected in cases:
            self.assertEqual(rain_level(rate), expected, rate)

    def test_snow_bands(self):
        cases = [
            (0, Level.LOW),
            (0.4, Level.LOW),
            (0.5, Level.MODERATE),
            (1.0, Level.HIGH),
            (1.9, Level.HIGH),
            (2.0, Level.SEVERE),
            (3.0, Level.SEVERE),
            (3.1, Level.NO_TRAVEL),
        ]
        for rate, expected in cases:
            self.assertEqual(snow_level(rate), expected, rate)


class AssessTests(SimpleTestCase):
    def test_worst_condition_wins(self):
        result = assess(Conditions(wind_mph=28, rain_in=0.6, snow_in=0), 20000)
        self.assertEqual(result.level, Level.SEVERE)
        self.assertEqual(result.wind, Level.MODERATE)
        self.assertEqual(result.reason, "rain 0.60 in/hr")

    def test_calm_weather(self):
        result = assess(Conditions(wind_mph=5, rain_in=0, snow_in=0), 44000)
        self.assertEqual(result.level, Level.LOW)
        self.assertEqual(result.reason, "No significant weather")

    def test_reason_mentions_load_when_it_raised_the_level(self):
        result = assess(Conditions(wind_mph=38, rain_in=0, snow_in=0), 44000)
        self.assertEqual(result.level, Level.SEVERE)
        self.assertIn("44,000 lb load", result.reason)

    def test_missing_forecast(self):
        self.assertIsNone(assess(Conditions(), 20000))

    def test_heatmap_score_follows_load_rules(self):
        self.assertAlmostEqual(wind_score(30), 1.5)
        self.assertEqual(wind_score(46, 35000), 4.0)
