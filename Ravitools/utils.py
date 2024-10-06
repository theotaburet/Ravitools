import hashlib
import json
import os
from dataclasses import dataclass
from typing import List, Tuple, Optional
import gpxpy
from tqdm import tqdm
import logging
from math import radians, sin, cos, sqrt, atan2

@dataclass
class POI:
    """Data class representing a Point of Interest."""
    lat: float
    lon: float
    type: str
    name: Optional[str]
    icon: str
    color: str
    description: Optional[str]

class GPXParser:
    """
    Parser for GPX files.
    
    Design Pattern: Static Factory Method (parse method creates and returns objects)
    """
    @staticmethod
    def parse(gpx_file: str, simplify_distance: float = 100) -> List[Tuple[float, float]]:
        """Parse a GPX file and return a simplified list of coordinates."""
        logging.info(f"Parsing GPX file: {gpx_file}")
        with open(gpx_file, 'r') as gpx_file:
            gpx = gpxpy.parse(gpx_file)
        
        path = []
        for track in gpx.tracks:
            for segment in track.segments:
                path.extend((point.latitude, point.longitude) for point in segment.points)

        simplified_path = GPXParser._simplify_path(path, simplify_distance)
        logging.info(f"Simplified GPX path from {len(path)} to {len(simplified_path)} points")
        return simplified_path

    @staticmethod
    def _simplify_path(path: List[Tuple[float, float]], distance: float) -> List[Tuple[float, float]]:
        """Simplify a path by removing points that are too close together."""
        if not path:
            return []

        simplified = [path[0]]
        for point in path[1:]:
            if GPXParser._haversine(simplified[-1], point) >= distance:
                simplified.append(point)
        return simplified

    @staticmethod
    def _haversine(point1: Tuple[float, float], point2: Tuple[float, float]) -> float:
        """Calculate the great-circle distance between two points on Earth."""
        lat1, lon1 = map(radians, point1)
        lat2, lon2 = map(radians, point2)
        
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        
        a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
        c = 2 * atan2(sqrt(a), sqrt(1-a))
        
        return 6371 * c * 1000  # Earth radius in meters