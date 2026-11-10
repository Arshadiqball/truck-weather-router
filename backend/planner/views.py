from rest_framework import status
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .serializers import HeatmapRequestSerializer, PlanRequestSerializer
from .services import geocoding, heatmap, planner
from .services.routing import RoutingError
from .services.weather import WeatherError


def upstream_error(exc):
    return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)


class GeocodeView(APIView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "geocode"

    def get(self, request):
        query = request.query_params.get("q", "").strip()
        if len(query) < 3:
            return Response([])
        try:
            return Response(geocoding.search(query))
        except geocoding.GeocodingError as exc:
            return upstream_error(exc)


class PlanView(APIView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "plan"

    def post(self, request):
        serializer = PlanRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            plan = planner.plan_trip(
                origin=(data["origin"]["lat"], data["origin"]["lon"]),
                destination=(data["destination"]["lat"], data["destination"]["lon"]),
                departure=data["departure"],
                load_lbs=data["load_lbs"],
                interval_miles=data["interval_miles"],
            )
        except (RoutingError, WeatherError) as exc:
            return upstream_error(exc)
        return Response(plan)


class HeatmapView(APIView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "plan"

    def post(self, request):
        serializer = HeatmapRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        paths = [[(lat, lon) for lon, lat in path] for path in data["paths"]]
        try:
            return Response(heatmap.corridor_heatmap(paths, data["load_lbs"]))
        except WeatherError as exc:
            return upstream_error(exc)
