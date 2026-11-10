from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers

from .services.geo import haversine_miles

INTERVAL_CHOICES = (10, 25, 50)
MAX_LOAD_LBS = 80000

# Open-Meteo forecasts run 16 days out. Leave a couple of days for the drive.
MAX_DAYS_AHEAD = 13


class PlaceSerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lon = serializers.FloatField(min_value=-180, max_value=180)


class PlanRequestSerializer(serializers.Serializer):
    origin = PlaceSerializer()
    destination = PlaceSerializer()
    departure = serializers.DateTimeField()
    load_lbs = serializers.IntegerField(min_value=0, max_value=MAX_LOAD_LBS)
    interval_miles = serializers.ChoiceField(choices=INTERVAL_CHOICES, default=25)

    def validate_departure(self, value):
        now = timezone.now()
        if value < now - timedelta(hours=1):
            raise serializers.ValidationError("Departure time is in the past.")
        if value > now + timedelta(days=MAX_DAYS_AHEAD):
            raise serializers.ValidationError(
                "Forecasts are only available %d days ahead." % MAX_DAYS_AHEAD
            )
        return value

    def validate(self, data):
        a, b = data["origin"], data["destination"]
        if haversine_miles((a["lat"], a["lon"]), (b["lat"], b["lon"])) < 1:
            raise serializers.ValidationError("Origin and destination are the same place.")
        return data


class HeatmapRequestSerializer(serializers.Serializer):
    # GeoJSON order: [lon, lat]
    paths = serializers.ListField(
        child=serializers.ListField(
            child=serializers.ListField(child=serializers.FloatField(), min_length=2, max_length=2),
            min_length=2,
            max_length=500,
        ),
        min_length=1,
        max_length=3,
    )
    load_lbs = serializers.IntegerField(min_value=0, max_value=MAX_LOAD_LBS, default=0)
