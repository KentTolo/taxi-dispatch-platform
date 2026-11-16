from math import asin, cos, radians, sin, sqrt

EARTH_RADIUS_KM = 6371.0088


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Straight-line distance between two points in kilometres."""
    dlat = radians(lat2 - lat1)
    dlng = radians(lng2 - lng1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng / 2) ** 2
    return 2 * EARTH_RADIUS_KM * asin(sqrt(a))


def bounding_box(lat: float, lng: float, radius_km: float) -> tuple[float, float, float, float]:
    """Cheap pre-filter box (min_lat, max_lat, min_lng, max_lng) around a point."""
    dlat = radius_km / 111.32
    dlng = radius_km / (111.32 * max(cos(radians(lat)), 0.01))
    return lat - dlat, lat + dlat, lng - dlng, lng + dlng
