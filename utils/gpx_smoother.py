import gpxpy
import logging
from math import radians, sin, cos, sqrt, atan2
from typing import List, Tuple
import numpy as np
from tqdm import tqdm
import folium
from .utils import GPXProcessingResult
from dataclasses import dataclass

logger = logging.getLogger(__name__)

class GPXSmoother:
    """
    A class for smoothing GPX path data by resampling points with regular spacing.
    
    Goal:
        The main goal of this class is to reduce the weight of GPX latitude and longitude points 
        by smoothing and resampling the path. This process is useful when querying the Overpass API 
        or similar geospatial services where lighter GPX files lead to faster query performance 
        and processing efficiency. By reducing redundant data points and ensuring a uniform 
        spacing between points, the amount of data transferred is minimized, and irrelevant data is 
        removed.
    
    Key Benefits:
        - Reduced data size, which speeds up overpass queries.
        - Avoids redundant and closely spaced points.
        - Ensures consistent spacing between points for better path representation.
    """
    
    EARTH_RADIUS = 6371000  # Earth radius in meters
    
    @staticmethod
    def smooth(gpx_file: str, point_spacing: float = 1000.0) -> GPXProcessingResult:
        """
        Smooth the GPX path by resampling points with regular intervals.

        Args:
            gpx_file (str): Path to the GPX file to be processed.
            point_spacing (float): Desired distance between points in meters (default is 1000 meters).

        Returns:
            GPXProcessingResult: A dataclass containing the original and smoothed paths, along with distance metrics.
        
        Raises:
            ValueError: If no points are found in the GPX file.

        Purpose:
            This method reduces the weight of the GPX file by resampling the path with evenly spaced points.
            This makes the file more efficient for Overpass API queries or similar services by reducing
            unnecessary or overly dense data points.
        """
        logger.info(f"Processing GPX file: {gpx_file}")
        
        # Parse the GPX file
        with open(gpx_file, 'r') as f:
            gpx = gpxpy.parse(f)
        
        # Extract latitude and longitude points from the GPX file
        original_path = []
        for track in gpx.tracks:
            for segment in track.segments:
                original_path.extend((point.latitude, point.longitude) for point in segment.points)
        
        if not original_path:
            raise ValueError("No points found in GPX file")

        logger.info(f"Extracted {len(original_path)} points from the GPX file.")
        
        # Calculate the total distance of the path
        total_distance = GPXSmoother._calculate_path_length(original_path)
        logger.info(f"Total path distance: {total_distance / 1000:.2f} km")
        
        # Resample and smooth the path
        smoothed_path = GPXSmoother._smooth_and_resample_path(
            original_path, point_spacing, total_distance)
        logger.info(f"Resampled path from {len(original_path)} to {len(smoothed_path)} points.")
        
        # Return the results in a structured format
        return GPXProcessingResult(
            original_points=len(original_path),
            smoothed_points=len(smoothed_path),
            original_path=original_path,
            smoothed_path=smoothed_path,
            total_distance=total_distance
        )

    @staticmethod
    def _haversine(point1: Tuple[float, float], point2: Tuple[float, float]) -> float:
        """
        Calculate the great-circle distance between two points on the Earth's surface.
        
        Args:
            point1 (Tuple[float, float]): Latitude and longitude of the first point.
            point2 (Tuple[float, float]): Latitude and longitude of the second point.
        
        Returns:
            float: Distance between the two points in meters.
        """
        lat1, lon1 = map(radians, point1)
        lat2, lon2 = map(radians, point2)
        
        # Calculate haversine distance
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
        
        return GPXSmoother.EARTH_RADIUS * 2 * atan2(sqrt(a), sqrt(1 - a))

    @staticmethod
    def _calculate_path_length(path: List[Tuple[float, float]]) -> float:
        """
        Compute the total length of a path based on the haversine distance between consecutive points.

        Args:
            path (List[Tuple[float, float]]): List of latitude and longitude tuples representing the path.

        Returns:
            float: The total length of the path in meters.
        """
        total_distance = 0
        for i in range(len(path) - 1):
            total_distance += GPXSmoother._haversine(path[i], path[i + 1])
        return total_distance

    @staticmethod
    def _smooth_and_resample_path(path: List[Tuple[float, float]], 
                                  point_spacing: float,
                                  total_distance: float) -> List[Tuple[float, float]]:
        """
        Smooth the path by resampling it with evenly spaced points along the original path.

        Args:
            path (List[Tuple[float, float]]): Original list of latitude and longitude points.
            point_spacing (float): Desired distance between consecutive points in meters.
            total_distance (float): Total distance of the path in meters.

        Returns:
            List[Tuple[float, float]]: A new list of latitude and longitude points with regular spacing.
        
        Purpose:
            This function reduces the overall size of the GPX data by eliminating overly dense sections
            of the path and ensuring points are uniformly spaced. The goal is to retain a representative
            shape of the original path while minimizing unnecessary data.
        """
        # Determine the number of points needed based on the total distance and spacing
        num_points = max(2, int(total_distance / point_spacing))
        
        # Compute cumulative distances along the path
        distances = [0]
        for i in range(1, len(path)):
            distances.append(distances[-1] + GPXSmoother._haversine(path[i-1], path[i]))
        
        # Normalize distances to the range [0, 1]
        normalized_distances = np.array(distances) / distances[-1]
        
        # Generate evenly spaced points (normalized between 0 and 1)
        evenly_spaced = np.linspace(0, 1, num_points)
        
        # Interpolate latitude and longitude separately based on the normalized distances
        lats = np.array([p[0] for p in path])
        lons = np.array([p[1] for p in path])
        
        smoothed_lats = np.interp(evenly_spaced, normalized_distances, lats)
        smoothed_lons = np.interp(evenly_spaced, normalized_distances, lons)
        
        # Return the resampled path
        return list(zip(smoothed_lats, smoothed_lons))

    @staticmethod
    def visualize(result: GPXProcessingResult, output_file: str = 'smooth_path_visualization.html'):
        """
        Visualize both the original and smoothed paths on a map and save the output as an HTML file.

        Args:
            result (GPXProcessingResult): The result of the GPX smoothing process, containing both paths.
            output_file (str): The output HTML file where the visualization will be saved.
        """
        logger.info("Generating visualization...")
        
        # Compute the center of the path to initialize the map
        center_lat = sum(p[0] for p in result.original_path) / len(result.original_path)
        center_lon = sum(p[1] for p in result.original_path) / len(result.original_path)
        
        # Initialize the folium map
        m = folium.Map(location=[center_lat, center_lon], zoom_start=10)
        
        # Add the original path (blue) and the smoothed path (red) to the map
        folium.PolyLine(result.original_path, color='blue', weight=2, opacity=0.8, popup='Original Path').add_to(m)
        folium.PolyLine(result.smoothed_path, color='red', weight=2, opacity=0.8, popup='Smoothed Path').add_to(m)
        
        # Save the map to an HTML file
        m.save(output_file)
        logger.info(f"Visualization saved to {output_file}")
