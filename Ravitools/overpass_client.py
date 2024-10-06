import requests
from typing import Dict, Any, List, Tuple, Optional
from .config import Config
import json
import hashlib
from datetime import date
import os
import logging

class OverpassClient:
    """
    Client for interacting with the Overpass API.
    
    Design Pattern: Adapter (adapts the Overpass API to our application's needs)
    """
    def __init__(self, config: Config):
        self.config = config
        self.cache_dir = config.get('paths', {}).get('cache', 'cache')
        os.makedirs(self.cache_dir, exist_ok=True)

    def query_amenities(self, path: List[Tuple[float, float]], radius: float) -> Dict[str, Any]:
        """Query amenities around the given path within the specified radius."""
        cache_key = self._generate_cache_key(path, radius)
        cached_data = self._get_cached_data(cache_key)
        
        if cached_data:
            logging.info("Using cached Overpass API results")
            return cached_data
        
        query = self._build_query(path, radius)
        logging.info("Querying Overpass API")
        response = requests.get(self.config.get('overpass_api_url', 'https://overpass-api.de/api/interpreter'), 
                                params={'data': query})
        response.raise_for_status()
        result = response.json()
        
        self._cache_data(cache_key, result)
        return result

    def _generate_cache_key(self, path: List[Tuple[float, float]], radius: float) -> str:
        """Generate a unique cache key based on the path, configuration, and current date."""
        path_hash = hashlib.md5(str(path).encode()).hexdigest()
        config_hash = hashlib.md5(json.dumps(self.config.config, sort_keys=True).encode()).hexdigest()
        today = date.today().isoformat()
        return f"{path_hash}_{config_hash}_{radius}_{today}"

    def _get_cached_data(self, cache_key: str) -> Optional[Dict[str, Any]]:
        """Retrieve cached data if available."""
        cache_file = os.path.join(self.cache_dir, f"{cache_key}.json")
        if os.path.exists(cache_file):
            with open(cache_file, 'r') as f:
                return json.load(f)
        return None

    def _cache_data(self, cache_key: str, data: Dict[str, Any]):
        """Cache the query results."""
        cache_file = os.path.join(self.cache_dir, f"{cache_key}.json")
        with open(cache_file, 'w') as f:
            json.dump(data, f)

    def _build_query(self, path: List[Tuple[float, float]], radius: float) -> str:
        """Build the Overpass API query string."""
        path_str = ' '.join([f'{lat} {lon}' for lat, lon in path])
        
        # Access OSM elements directly from the config object
        map_features = self.config.osm_elements
        
        # Build the Overpass API query for each key and its values
        queries = []
        
        for osm_key, values in map_features.items():
            if isinstance(values, list):
                # Join the values with '|', so it creates a query like "amenity~"hospital|school|restaurant"
                values_str = '|'.join(values)
                queries.append(f'nwr["{osm_key}"~"{values_str}"](around:{radius}, poly:"{path_str}");')
        
        # Combine all queries into one Overpass query
        query_str = '\n'.join(queries)
        
        # Final Overpass API query string
        return f"""
        [out:json];
        (
        {query_str}
        );
        out center;
        """
