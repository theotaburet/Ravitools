"""
Data Processor Module

This module processes raw OpenStreetMap data into structured POI objects and Folium feature groups.
It handles the raw data from the Overpass API and converts it into usable POI objects.
"""

import json
import logging
from typing import Dict, Any, Tuple, Optional, List
import folium
from tqdm import tqdm

from .utils import POI, POICollection
from .config import Config

logger = logging.getLogger(__name__)

class DataProcessor:
    """
    Processes raw OpenStreetMap data into structured POI objects and Folium feature groups.
    
    This class handles the conversion of raw OSM data into structured POI objects and
    organizes them into feature groups for display on a map.
    
    Attributes:
        config (Config): Configuration object containing OSM mapping rules
        feature_groups (Dict[str, folium.FeatureGroup]): Dictionary of feature groups by category
    """

    def __init__(self, config: Config):
        """
        Initialize the DataProcessor with configuration.
        
        Args:
            config (Config): Configuration object containing OSM mapping rules
        """
        self.config = config
        self.feature_groups: Dict[str, folium.FeatureGroup] = {}
        self._initialize_feature_groups()

    def _initialize_feature_groups(self) -> None:
        """Initialize Folium feature groups based on configuration."""
        for category in self.config.osm_macro_group:
            self.feature_groups[category] = folium.FeatureGroup(name=category)

    def process_amenities(self, query_result: Dict[str, Any]) -> Tuple[POICollection, Dict[str, folium.FeatureGroup]]:
        """
        Process raw amenity data into a POICollection and Folium feature groups.
        
        Args:
            query_result (Dict[str, Any]): Data from Overpass API in dictionary format.
        
        Returns:
            Tuple containing:
                - POICollection: Collection of processed POI objects
                - Dict[str, folium.FeatureGroup]: Dictionary of feature groups by category
        
        Raises:
            ValueError: If the raw data format is not as expected
        """
        logger.info("Processing amenities")
        pois: List[POI] = []
        
        try:
            # Process each element in the query_result dictionary
            for element in tqdm(query_result.get('elements', []), desc="Processing POIs"):
                poi = self._create_poi(element)
                if poi:
                    pois.append(poi)
                    self._add_to_feature_group(poi)

            poi_collection = POICollection(pois=pois, config_hash=self.config.config_hash)
            logger.info(f"Processed {len(pois)} POIs")
            
            return poi_collection, self.feature_groups
            
        except ValueError as e:
            logger.error(f"Failed to process the raw data: {e}")
            raise
        except Exception as e:
            logger.error(f"An error occurred while processing amenities: {e}")
            raise

    def _create_poi(self, element: Dict[str, Any]) -> Optional[POI]:
        """
        Create a POI object from an Overpass API element.
        
        Args:
            element: Raw OSM element data
        
        Returns:
            POI object if the element matches configuration rules, None otherwise
        """
        try:
            tags = element.get('tags', {})
            
            # Get coordinates based on element type
            if element['type'] == 'node':
                lat, lon = element.get('lat'), element.get('lon')
            elif element['type'] == 'way':
                center = element.get('center', {})
                lat, lon = center.get('lat'), center.get('lon')
            else:
                return None

            if not (lat and lon):
                return None

            # Try to match the element with our configuration using osm_key_mapping
            for (key, value), config in self.config.osm_key_mapping.items():
                if key in tags and (value == tags[key] or value == "*"):
                    return POI(
                        lat=lat,
                        lon=lon,
                        type=config['map_feature'],
                        name=tags.get('name') if config.get('name', True) else None,
                        icon=config.get('icon', 'info'),
                        color=config['icon_prototype']['background_color'].lstrip('#'),
                        description=self._create_description(tags, config),
                        tags=tags
                    )
            return None
        except Exception as e:
            logger.error(f"Error creating POI from element: {e}")
            return None

    def _create_description(self, tags: Dict[str, Any], osm_key: Dict[str, Any]) -> str:
        """Create a description string from tags."""
        try:
            desc_parts = []
            if 'name' in tags and osm_key.get('name', True):
                desc_parts.append(f"<strong>Name:</strong> {tags['name']}")
            
            # Add other relevant tags
            for key, value in tags.items():
                if key not in ['name']:
                    desc_parts.append(f"<strong>{key}:</strong> {value}")
            
            return '<br>'.join(desc_parts)
        except Exception as e:
            logger.error(f"Error creating description: {e}")
            return "No description available"

    def _add_to_feature_group(self, poi: POI) -> None:
        """Add a POI to the appropriate feature group."""
        try:
            if poi.type not in self.feature_groups:
                logger.warning(f"No feature group found for POI type: {poi.type}")
                return

            icon = folium.Icon(
                color='white',
                icon_color=f"#{poi.color}",
                icon=poi.icon,
                prefix='fa'
            )
            
            marker = folium.Marker(
                location=[poi.lat, poi.lon],
                popup=folium.Popup(poi.description, max_width=300),
                icon=icon
            )
            
            self.feature_groups[poi.type].add_child(marker)
        except Exception as e:
            logger.error(f"Error adding POI to feature group: {e}")
