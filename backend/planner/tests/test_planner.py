from datetime import datetime, timedelta, timezone
from unittest import mock

from django.test import SimpleTestCase
from django.utils import timezone as dj_timezone
from rest_framework.test import APIClient

from planner.services import geo, planner
from planner.services.risk import Conditions
from planner.services.routing import Route
from planner.services.weather import Forecast

DEPARTURE = datetime(2026, 1, 10, 8, 0, tzinfo=timezone.utc)


def straight_route(lat, hours):
    """A west-to-east line along one latitude, driven at constant speed."""
    coords = [(lat, -100 + i * 0.5) for i in range(9)]
    miles = geo.cumulative_miles(coords)
    seconds = [hours * 3600 * m / miles[-1] for m in miles]
    return Route(coords=coords, duration_s=hours * 3600, via="Test Hwy", cum_seconds=seconds)


def fake_forecast(windy_lat=None):
    """Calm everywhere, except 40 mph wind along `windy_lat`."""

    def build(points, start, end):
        hours = []
        ts = int(start.timestamp()) // 3600 * 3600
        while ts <= end.timestamp() + 3600:
            hours.append(ts)
            ts += 3600
        series = []
        for lat, _ in points:
            wind = 40 if windy_lat is not None and abs(lat - windy_lat) < 0.01 else 5
            series.append([Conditions(wind_mph=wind, rain_in=0, snow_in=0)] * len(hours))
        return Forecast(hours, series)

    return build


class CheckpointTests(SimpleTestCase):
    def test_marks_include_both_ends(self):
        self.assertEqual(planner.checkpoint_miles(100, 25), [0, 25, 50, 75, 100])
        self.assertEqual(planner.checkpoint_miles(60, 25), [0, 25, 50, 60])

    def test_no_stub_before_destination(self):
        self.assertEqual(planner.checkpoint_miles(52, 25), [0, 25, 52])

    def test_short_trip(self):
        self.assertEqual(planner.checkpoint_miles(8, 10), [0, 8])

    def test_coverage_adds_up_to_route_length(self):
        marks = planner.checkpoint_miles(60, 25)
        spans = planner.coverage(marks, 60)
        self.assertEqual(spans, [(0, 12.5), (12.5, 37.5), (37.5, 55), (55, 60)])
        self.assertAlmostEqual(sum(end - start for start, end in spans), 60)


class PlanTripTests(SimpleTestCase):
    def plan(self, routes, load_lbs=20000, windy_lat=None):
        with mock.patch("planner.services.routing.get_routes", return_value=routes), mock.patch(
            "planner.services.weather.get_forecast", side_effect=fake_forecast(windy_lat)
        ):
            return planner.plan_trip((40, -100), (40, -96), DEPARTURE, load_lbs, 25)

    def test_fastest_route_wins_in_calm_weather(self):
        plan = self.plan([straight_route(40.0, 4), straight_route(40.5, 5)])
        self.assertEqual(plan["recommended_route_id"], "route-1")
        self.assertEqual([r["rank"] for r in plan["routes"]], [1, 2])
        self.assertIsNone(plan["advisory"])

    def test_slower_route_wins_when_the_fast_one_is_windy(self):
        plan = self.plan([straight_route(40.0, 4), straight_route(40.5, 5)], windy_lat=40.0)
        self.assertEqual(plan["recommended_route_id"], "route-2")
        self.assertIn("Fewer High-risk miles than Route A", plan["reason"])

        windy = plan["routes"][0]["summary"]
        self.assertAlmostEqual(windy["miles"]["high"], plan["routes"][0]["distance_miles"], places=0)
        self.assertEqual(windy["avg_risk"], 2.0)

    def test_heavy_load_turns_high_wind_into_severe(self):
        plan = self.plan([straight_route(40.0, 4)], load_lbs=42000, windy_lat=40.0)
        checkpoint = plan["routes"][0]["checkpoints"][0]
        self.assertEqual(checkpoint["risk"]["level"], "severe")
        self.assertIn("Severe", plan["advisory"])

    def test_checkpoint_etas_follow_the_route_clock(self):
        route = straight_route(40.0, 4)
        plan = self.plan([route])
        checkpoints = plan["routes"][0]["checkpoints"]
        self.assertEqual(checkpoints[0]["eta"], DEPARTURE)
        self.assertEqual(checkpoints[-1]["eta"], DEPARTURE + timedelta(hours=4))
        self.assertEqual(plan["routes"][0]["arrival"], DEPARTURE + timedelta(hours=4))

        # constant speed, so 25 miles in is 25/total of the way through
        expected = DEPARTURE + timedelta(seconds=4 * 3600 * 25 / route.distance_miles)
        self.assertAlmostEqual(checkpoints[1]["eta"].timestamp(), expected.timestamp(), delta=1)


class PlanApiTests(SimpleTestCase):
    def post(self, **overrides):
        body = {
            "origin": {"lat": 40, "lon": -100},
            "destination": {"lat": 40, "lon": -96},
            "departure": (dj_timezone.now() + timedelta(hours=2)).isoformat(),
            "load_lbs": 30000,
            "interval_miles": 25,
        }
        body.update(overrides)
        return APIClient().post("/api/plan/", body, format="json")

    def test_rejects_bad_input(self):
        past = (dj_timezone.now() - timedelta(days=1)).isoformat()
        self.assertEqual(self.post(departure=past).status_code, 400)
        self.assertEqual(self.post(interval_miles=15).status_code, 400)
        self.assertEqual(self.post(load_lbs=-5).status_code, 400)
        self.assertEqual(self.post(destination={"lat": 40, "lon": -100}).status_code, 400)

    def test_returns_a_plan(self):
        with mock.patch(
            "planner.services.routing.get_routes", return_value=[straight_route(40.0, 4)]
        ), mock.patch("planner.services.weather.get_forecast", side_effect=fake_forecast()):
            resp = self.post()
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()["routes"]), 1)
