from __future__ import annotations
import json
import shutil
from dataclasses import asdict, dataclass, field
from datetime import datetime
import yaml
import os
import hashlib
from pathlib import Path
import logging
from tqdm import tqdm
from .utils import OSMMapping
from .utils import POICollection, POI
from typing import Dict, Any, List, Tuple, Optional, TypedDict


logger = logging.getLogger(__name__)

class Config:
    """
    Configuration manager for the GPX Amenity Mapper.
    
    This class implements the Singleton pattern to ensure only one instance exists.
    It handles loading and parsing the YAML configuration file, creating necessary
    directories, and providing easy access to configuration values.
    """
    _instance: Optional[Config] = None
    
    def __new__(cls, config_path: str) -> Config:
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialize(config_path)
        return cls._instance

    def _initialize(self, config_path: str) -> None:
        """Initialize the Config instance."""
        self._load_config(config_path)
        self.paths = self._create_directories()
        self.osm_macro_group = self.config.get('OSM_POI_configuration', {})
        self.osm_key_mapping = self._build_osm_key_mapping()
        self.config_hash = self._generate_config_hash()
        self.icons_folder = self.get_nested('font-awesome', 'path')
        
        # Transfer .svg files from icons_folder to paths['icons']
        self._transfer_svg_files()

    def _transfer_svg_files(self) -> None:
        """Transfer .svg files from icons_folder to paths['icons'] directory with a progress bar."""
        if not self.icons_folder or not os.path.isdir(self.icons_folder):
            logger.warning("Icons folder does not exist or is not a directory.")
            return

        icons_dest = self.paths.get('icons')
        if not icons_dest:
            logger.warning("Destination icons path not set in configuration.")
            return

        svg_files = list(Path(self.icons_folder).glob("*.svg"))  # Get all .svg files in icons_folder
        dest_svg_files = list(Path(icons_dest).glob("*.svg"))  # Get all .svg files in destination directory

        # Create a set of existing SVG files in the destination directory
        existing_svg_files = {p.name for p in dest_svg_files}

        # Display progress bar with tqdm
        for svg_file in tqdm(svg_files, desc="Transferring .svg files", unit="file"):
            if svg_file.name in existing_svg_files:
                logger.info(f"{svg_file.name} already exists in {icons_dest}, skipping.")
                continue

            try:
                shutil.copy(svg_file, icons_dest)
                logger.info(f"Copied {svg_file} to {icons_dest}")
            except Exception as e:
                logger.error(f"Failed to copy {svg_file} to {icons_dest}: {e}")

    def _generate_config_hash(self) -> str:
        """Generate a hash of the configuration for tracking changes."""
        config_str = json.dumps(self.osm_macro_group, sort_keys=True)
        return hashlib.md5(config_str.encode()).hexdigest()

    def _load_config(self, config_path: str) -> None:
        """
        Load the configuration file.
        
        Args:
            config_path: Path to the YAML configuration file.
        
        Raises:
            FileNotFoundError: If the configuration file doesn't exist.
            yaml.YAMLError: If the configuration file is invalid YAML.
        """
        try:
            with open(config_path, 'r') as config_file:
                self.config = yaml.safe_load(config_file)
        except FileNotFoundError:
            raise FileNotFoundError(f"Configuration file not found: {config_path}")
        except yaml.YAMLError as e:
            raise ValueError(f"Invalid YAML in configuration file: {e}")

    def _create_directories(self) -> Dict[str, str]:
        """
        Create directories specified in the 'paths' section of the config.
        
        Returns:
            Dictionary of path names to created directory paths.
        """
        paths = self.config.get('paths', {})
        for path in paths.values():
            os.makedirs(path, exist_ok=True)
        return paths

    def _build_osm_key_mapping(self) -> Dict[Tuple[str, str], Dict[str, Any]]:
        """
        Build a mapping from (osm_key_type, osm_key_value) to their corresponding
        map features, icon_prototype, and other details.
        
        This method processes the 'OSM_POI_configuration' section of the YAML file 
        and builds a dictionary for fast lookups based on OSM key-value pairs.
        
        Returns:
            Dictionary mapping (key, value) tuples to a dictionary containing 
            feature configuration details.
        """
        osm_poi_config = self.config.get('OSM_POI_configuration', {})
        osm_key_mapping = {}

        for feature_name, feature_config in osm_poi_config.items():
            icon_prototype = feature_config.get('icon_prototype', {})
            elements = feature_config.get('OSM_key', [])
            
            # Iterate through each OSM key in the feature configuration
            for element in elements:
                osm_key_type, osm_key_value = list(element.items())[0]
                
                # Store a mapping with all relevant details
                osm_key_mapping[(osm_key_type, osm_key_value)] = {
                    'map_feature': feature_name,
                    'icon_prototype': icon_prototype,
                    'name': element.get('name', False),
                    'icon': element.get('icon', None),
                    'group': element.get('group', None)
                }
        
        return osm_key_mapping

    def get_osm_mapping(self, key: str, value: Any) -> Optional[OSMMapping]:
        """
        Get the OSM mapping for a given key-value pair.
        
        Args:
            key: The OSM key (e.g., 'amenity')
            value: The OSM value (e.g., 'toilets')
        
        Returns:
            OSMMapping object if found, None otherwise.
        """
        return self.osm_key_mapping.get((key, value))

    def get_feature_groups(self) -> List[str]:
        """
        Get a list of all feature groups defined in the configuration.
        
        Returns:
            List of feature group names from the OSM_POI_configuration.
        """
        return list(self.config.get('OSM_POI_configuration', {}).keys())

    def get(self, key: str, default: Any = None) -> Any:
        """
        Get a configuration value by key.
        
        Args:
            key: The configuration key to retrieve
            default: Default value if key is not found
        
        Returns:
            The configuration value or default if not found.
        """
        return self.config.get(key, default)

    def get_nested(self, *keys: str, default: Any = None) -> Any:
        """
        Retrieve a nested configuration value.
        
        Args:
            *keys: Sequence of keys to traverse
            default: Default value if path is not found
        
        Returns:
            The nested configuration value or default if not found.
        
        Example:
            config.get_nested('OSM_POI_configuration', 'Restroom', 'icon_prototype')
        """
        value = self.config
        for key in keys:
            if isinstance(value, dict):
                value = value.get(key, {})
            else:
                return default
        return value if value else default