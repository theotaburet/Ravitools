import yaml
import os
from collections import defaultdict
from typing import Any, Dict, List, Tuple

class Config:
    """
    Configuration manager for the GPX Amenity Mapper.
    
    Design Pattern: Singleton (ensures only one instance of Config is created).
    This class parses the YAML file and provides mappings for OSM keys to their respective
    map features, icon prototypes, and other properties.
    """
    _instance = None

    def __new__(cls, config_path: str):
        if cls._instance is None:
            cls._instance = super(Config, cls).__new__(cls)
            with open(config_path, 'r') as config_file:
                cls._instance.config = yaml.safe_load(config_file)
            
            # Create necessary folders as defined in the config
            cls._instance.paths = cls._instance._create_directories()

            # Process OSM elements and mappings
            cls._instance.osm_elements = cls._instance._extract_osm_elements()
            cls._instance.osm_key_mapping = cls._instance._build_osm_key_mapping()
            
        return cls._instance

    def _create_directories(self):
        """Create directories as defined in the 'paths' section of the config.yaml file."""
        paths = self.config.get('paths', {})
        for path_name, path_value in paths.items():
            if not os.path.exists(path_value):
                os.makedirs(path_value, exist_ok=True)
                print(f"Directory created: {path_value}")
                
        return paths

    def get(self, key: str, default: Any = None) -> Any:
        """Get a configuration value by key."""
        return self.config.get(key, default)

    def _extract_osm_elements(self) -> Dict[str, List[str]]:
        """
        Extract OSM elements from the YAML file and group them by their type (e.g., 'amenity', 'type').
        
        This method extracts the OSM elements once during initialization and stores them in the instance.
        """
        map_features = self.get('map_features', {})
        return self.extract_osm_keys(map_features)

    def extract_osm_keys(self, map_features: Dict[str, Any]) -> Dict[str, List[str]]:
        """
        Extract and group OSM keys by osm_key_type from the map_features section.
        """
        grouped_osm_keys = defaultdict(list)
        
        for key, feature in map_features.items():
            elements = feature.get('OSM_key', [])
            
            for element in elements:
                osm_key_type, osm_key_value = list(element.items())[0]
                grouped_osm_keys[osm_key_type].append(osm_key_value)
        
        return {k: list(set(v)) for k, v in grouped_osm_keys.items()}

    def _build_osm_key_mapping(self) -> Dict[Tuple[str, str], Dict[str, Any]]:
        """
        Build a mapping from (osm_key_type, osm_key_value) to their corresponding
        map features, icon_prototype, and other details.
        
        This method processes the 'map_features' section of the YAML file and builds
        a dictionary for fast lookups based on OSM key and value pairs.
        """
        map_features = self.get('map_features', {})
        osm_key_mapping = {}

        for feature_name, feature in map_features.items():
            icon_prototype = feature.get('icon_prototype', {})
            elements = feature.get('OSM_key', [])
            
            # Iterate through each OSM key in the feature
            for element in elements:
                osm_key_type, osm_key_value = list(element.items())[0]
                
                # Store a mapping with all relevant details
                osm_key_mapping[(osm_key_type, osm_key_value)] = {
                    'map_feature': feature_name,
                    'icon_prototype': icon_prototype,
                    'name': element.get('name', False),  # Default to True if 'name' is not provided
                    'icon': element.get('icon', None),
                    'group': element.get('group', None)
                }
        
        return osm_key_mapping

    def get_osm_mapping(self, osm_key_type: str, osm_key_value: str) -> Dict[str, Any]:
        """
        Retrieve the mapping for a given (osm_key_type, osm_key_value) pair.
        
        This method looks up the preprocessed mapping and returns the corresponding
        map feature, icon prototype, and other attributes.
        """
        return self.osm_key_mapping.get((osm_key_type, osm_key_value), None)
