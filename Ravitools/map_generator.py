import folium
from typing import List, Tuple
from .config import Config
from .utils import POI
import logging
from tqdm import tqdm

class MapGenerator:
    """
    Generator for creating Folium maps with GPX paths and POIs.
    
    Design Pattern: Builder (constructs complex map objects step by step)
    """
    def __init__(self, config: Config):
        self.config = config

    def create_map(self, gpx_path: List[Tuple[float, float]], pois: List[POI]) -> folium.Map:
        """Create a Folium map with the GPX path and POIs."""
        logging.info("Generating map")
        center = self._calculate_center(gpx_path)
        map_obj = folium.Map(location=center, zoom_start=10)
        self._add_gpx_path(map_obj, gpx_path)
        self._add_pois(map_obj, pois)
        return map_obj

    def _calculate_center(self, gpx_path: List[Tuple[float, float]]) -> Tuple[float, float]:
        """Calculate the center point of the GPX path."""
        if not gpx_path:
            return (0, 0)
        lat_sum = sum(lat for lat, _ in gpx_path)
        lon_sum = sum(lon for _, lon in gpx_path)
        return (lat_sum / len(gpx_path), lon_sum / len(gpx_path))

    def _add_gpx_path(self, map_obj: folium.Map, gpx_path: List[Tuple[float, float]]):
        """Add the GPX path to the map."""
        logging.info("Adding GPX path to map")
        folium.PolyLine(gpx_path, weight=3, color='blue', opacity=0.8).add_to(map_obj)

    def _add_pois(self, map_obj: folium.Map, pois: List[POI]):
        """Add POIs to the map."""
        logging.info("Adding POIs to map")
        for poi in tqdm(pois, desc="Adding POIs to map"):
            icon = folium.Icon(
                color=poi.color,
                icon_color='white',
                icon=poi.icon,
                prefix='fa'
            )
            folium.Marker(
                [poi.lat, poi.lon],
                popup=poi.description,
                tooltip=poi.name,
                icon=icon
            ).add_to(map_obj)