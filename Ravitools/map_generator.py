import logging
from typing import List, Tuple, Dict, Optional
from pathlib import Path

import folium
from folium import plugins
from tqdm import tqdm
import gpxpy
import numpy as np

from .config import Config
from .utils import POI, POICollection

logger = logging.getLogger(__name__)

class MapGenerator:
    """
    Generator for creating Folium maps with GPX paths and POIs.
    Uses ant paths for GPX tracks visualization.
    
    Attributes:
        config (Config): Configuration settings for map generation
    """
    
    def __init__(self, config: Config):
        """
        Initialize the MapGenerator with configuration.
        
        Args:
            config (Config): Configuration settings for map generation
        """
        self.config = config

    def create_map(self, 
                  feature_groups: Dict[str, folium.FeatureGroup],
                  gpx_paths: List[Path] = None,
                  center: Optional[Tuple[float, float]] = None,
                  zoom_start: int = 12,
                  show_heatmap: bool = False) -> folium.Map:
        """
        Create a Folium map with GPX paths and POIs.
        
        Args:
            feature_groups (Dict[str, folium.FeatureGroup]): Feature groups from DataProcessor
            gpx_paths (List[Path], optional): List of paths to GPX files
            center (Tuple[float, float], optional): Map center coordinates
            zoom_start (int, optional): Initial zoom level
            show_heatmap (bool, optional): Whether to show POI density heatmap
            
        Returns:
            folium.Map: Generated map object
        """
        logger.info("Generating map")
        
        # Calculate center if not provided
        if not center and gpx_paths:
            center = self._calculate_center_from_gpx(gpx_paths[0])
        elif not center:
            center = self._calculate_center_from_feature_groups(feature_groups)
        
        # Create base map
        map_obj = folium.Map(
            location=center,
            zoom_start=zoom_start,
            control_scale=True
        )
        
        # Add GPX paths if provided
        if gpx_paths:
            for gpx_path in gpx_paths:
                self._add_gpx_ant_path(map_obj, gpx_path)

        # Add feature groups directly (no clustering)
        self._add_feature_groups(map_obj, feature_groups)

        # Add heatmap if requested
        if show_heatmap:
            self._add_heatmap_from_features(map_obj, feature_groups)

        # Add layer control and fullscreen option
        folium.LayerControl().add_to(map_obj)
        plugins.Fullscreen().add_to(map_obj)
        
        return map_obj

    def _calculate_center_from_feature_groups(
            self, feature_groups: Dict[str, folium.FeatureGroup]
        ) -> Tuple[float, float]:
        """
        Calculate center point from feature groups' markers.
        
        Args:
            feature_groups (Dict[str, folium.FeatureGroup]): Feature groups
            
        Returns:
            Tuple[float, float]: Center coordinates
        """
        all_coords = []
        for group in feature_groups.values():
            for _, child in group._children.items():
                if isinstance(child, folium.Marker):
                    all_coords.append(child.location)
        
        if not all_coords:
            return (0, 0)
            
        return (
            sum(lat for lat, _ in all_coords) / len(all_coords),
            sum(lon for _, lon in all_coords) / len(all_coords)
        )

    def _add_heatmap_from_features(self,
                                 map_obj: folium.Map,
                                 feature_groups: Dict[str, folium.FeatureGroup]) -> None:
        """
        Add heatmap based on markers in feature groups.
        
        Args:
            map_obj (folium.Map): Map object
            feature_groups (Dict[str, folium.FeatureGroup]): Feature groups to include
        """
        heat_data = []
        for group in feature_groups.values():
            for _, child in group._children.items():
                if isinstance(child, folium.Marker):
                    heat_data.append(list(child.location))
        
        if heat_data:
            plugins.HeatMap(
                heat_data,
                radius=15,
                blur=10,
                min_opacity=0.5,
                name='POI Density Heatmap'
            ).add_to(map_obj)

    def _calculate_center_from_gpx(self, gpx_path: Path) -> Tuple[float, float]:
        """
        Calculate the center point of a GPX file.
        
        Args:
            gpx_path (Path): Path to GPX file
            
        Returns:
            Tuple[float, float]: Center coordinates
        """
        try:
            with open(gpx_path, 'r') as gpx_file:
                gpx = gpxpy.parse(gpx_file)
                points = []
                for track in gpx.tracks:
                    for segment in track.segments:
                        points.extend([(p.latitude, p.longitude) for p in segment.points])
                
                if not points:
                    return (0, 0)
                    
                return (
                    sum(lat for lat, _ in points) / len(points),
                    sum(lon for _, lon in points) / len(points)
                )
        except Exception as e:
            logger.error(f"Error calculating center from GPX: {e}")
            return (0, 0)

    def _add_gpx_ant_path(self, map_obj: folium.Map, gpx_path: Path) -> None:
        """
        Add a GPX path to the map as an ant path with elevation profile.
        
        Args:
            map_obj (folium.Map): Map object to add the path to
            gpx_path (Path): Path to GPX file
        """
        logger.info(f"Adding GPX ant path from {gpx_path}")
        try:
            with open(gpx_path, 'r') as gpx_file:
                gpx = gpxpy.parse(gpx_file)
                
                for track in gpx.tracks:
                    for segment in track.segments:
                        points = [(p.latitude, p.longitude) for p in segment.points]
                        
                        # Add path to map
                        track_group = folium.FeatureGroup(name=f"Track: {track.name or gpx_path.stem}")
                        
                        # Add ant path
                        plugins.AntPath(
                            locations=points,
                            weight=3,
                            color='blue',
                            opacity=0.8,
                            popup=f"Distance: {track.length_3d():.1f}m",
                            delay=1000,  # Animation delay in milliseconds
                            dash_array=[10, 20],  # Pattern of the ant path
                            pulse_color='#FFF'  # Color of the pulse animation
                        ).add_to(track_group)
                        
                        track_group.add_to(map_obj)
                        
        except Exception as e:
            logger.error(f"Error adding GPX ant path: {e}")

    def _add_feature_groups(self, 
                          map_obj: folium.Map,
                          feature_groups: Dict[str, folium.FeatureGroup]) -> None:
        """
        Add feature groups directly to map without clustering.
        
        Args:
            map_obj (folium.Map): Map object
            feature_groups (Dict[str, folium.FeatureGroup]): Feature groups to add
        """
        for group in feature_groups.values():
            map_obj.add_child(group)

    def save_map(self, map_obj: folium.Map, output_path: Path) -> None:
        """
        Save the map to an HTML file.
        
        Args:
            map_obj (folium.Map): Map to save
            output_path (Path): Path where to save the map
        """
        try:
            map_obj.save(str(output_path))
            logger.info(f"Map saved to {output_path}")
        except Exception as e:
            logger.error(f"Error saving map: {e}")
            raise