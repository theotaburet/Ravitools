import requests
import json
import hashlib
import os
import logging
import overpy 
import time
from datetime import date
from urllib.error import HTTPError
from urllib.request import urlopen
from tqdm import tqdm
from typing import Union, List
from typing import Dict, Any, List, Tuple, Optional
from .config import Config

logger = logging.getLogger(__name__)

class QueryResult:
    def __init__(self, raw_data: bytes):
        self.raw_data = raw_data
    
    def save(self, output_file: str):
        """Save the raw JSON data to a file."""
        with open(output_file, 'wb') as f:
            f.write(self.raw_data)

class OverpassExtended(overpy.Overpass):
    
    def query_to_json(self, query: Union[bytes, str]) -> QueryResult:
        """
        Query the Overpass API and return a QueryResult object containing the raw JSON response.

        :param query: The query string in Overpass QL
        :return: A QueryResult object containing the raw JSON response
        """
        response = self._make_raw_request(query)  # Make the raw request and get the response
        return QueryResult(response)
    
    def _make_raw_request(self, query: Union[bytes, str]) -> bytes:
        """
        Make a raw request to the Overpass API and return the response bytes.

        :param query: The query string in Overpass QL
        :return: The raw response from the Overpass API
        """
        if not isinstance(query, bytes):
            query = query.encode("utf-8")

        retry_num: int = 0
        retry_exceptions: List[Exception] = []
        do_retry: bool = True if self.max_retry_count > 0 else False

        while retry_num <= self.max_retry_count:
            if retry_num > 0:
                time.sleep(self.retry_timeout)
            retry_num += 1
            try:
                f = urlopen(self.url, query)
            except HTTPError as e:
                f = e

            response = b""
            content_length = f.getheader('Content-Length')
            total_size = int(content_length) if content_length else None

            # Initialize the tqdm progress bar
            with tqdm(total=total_size, unit='B', unit_scale=True, desc="Downloading") as pbar:
                while True:
                    data = f.read(self.read_chunk_size)
                    if len(data) == 0:
                        break
                    response += data
                    pbar.update(len(data))
            f.close()

            if f.code == 200:
                return response  # Return the raw response bytes if successful
            
            # Handle various HTTP errors and retry if needed
            if f.code == 400:
                current_exception = self._handle_400_error(response, query)
                if not do_retry:
                    raise current_exception
                retry_exceptions.append(current_exception)
                continue

            if f.code == 429:
                current_exception = exception.OverpassTooManyRequests()
                if not do_retry:
                    raise current_exception
                retry_exceptions.append(current_exception)
                continue

            if f.code == 504:
                current_exception = exception.OverpassGatewayTimeout()
                if not do_retry:
                    raise current_exception
                retry_exceptions.append(current_exception)
                continue

            current_exception = exception.OverpassUnknownHTTPStatusCode(f.code)
            if not do_retry:
                raise current_exception
            retry_exceptions.append(current_exception)
            continue

        raise exception.MaxRetriesReached(retry_count=retry_num, exceptions=retry_exceptions)
    
    def _handle_400_error(self, response: bytes, query: Union[bytes, str]) -> Exception:
        """
        Handle HTTP 400 error by extracting and returning the appropriate exception.

        :param response: The raw response from the server
        :param query: The original query that caused the error
        :return: The appropriate exception based on the error message
        """
        msgs: List[str] = []
        for msg_raw in self._regex_extract_error_msg.finditer(response):
            msg_clean_bytes = self._regex_remove_tag.sub(b"", msg_raw.group("msg"))
            try:
                msg = msg_clean_bytes.decode("utf-8")
            except UnicodeDecodeError:
                msg = repr(msg_clean_bytes)
            msgs.append(msg)

        return exception.OverpassBadRequest(query, msgs=msgs)

class OverpassClient:
    """
    Client for interacting with the Overpass API.
    
    Design Pattern: Adapter (adapts the Overpass API to our application's needs)
    """
    def __init__(self, config: Config):
        self.config = config
        self.cache_dir = config.paths['cache']

        os.makedirs(self.cache_dir, exist_ok=True)

    def query_amenities(self, path: List[Tuple[float, float]], radius: float) -> Dict[str, Any]:
        """Query amenities around the given path within the specified radius."""
        cache_key = self._generate_cache_key(path, radius)
        cached_data = self._get_cached_data(cache_key)
        
        if cached_data:
            logger.info("Using cached Overpass API results")
            return cached_data
        
        overpass_query = self._build_query(path, radius)
        logger.info("Querying Overpass API")

        overpass_instance = OverpassExtended()

        # Query and get the result as a QueryResult object
        result = overpass_instance.query_to_json(overpass_query)
        
        self._cache_data(cache_key, result)

        return self._get_cached_data(cache_key)

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

        # Save the result to a JSON file
        data.save(cache_file)

    def _build_query(self, path: List[Tuple[float, float]], radius: float) -> str:
        """Build the Overpass API query string."""
        path_latlon = ','.join([f'{str(lat)},{str(lon)}' for (lat, lon) in path])
        
        # Group OSM keys and values from the configuration
        osm_groups = {}
        
        # Iterate through all feature configurations
        for feature_name, feature_config in self.config.osm_macro_group.items():
            for osm_key_config in feature_config.get('OSM_key', []):
                # # Each OSM key config is a dictionary with one key-value pair
                # for osm_key, osm_value in osm_key_config.items():
                #     if osm_key not in osm_groups:
                #         osm_groups[osm_key] = set()
                #     osm_groups[osm_key].add(osm_value)

                # Each OSM key config is a dictionary with one key-value pair, so we get the first item
                osm_key, osm_value = next(iter(osm_key_config.items()))
                
                if osm_key not in osm_groups:
                    osm_groups[osm_key] = set()
                osm_groups[osm_key].add(osm_value)
        
        # Build queries for each OSM key and its values
        queries = []
        for osm_key, values in osm_groups.items():
            values_str = '|'.join(str(v) for v in values)
            queries.append(f'nwr["{osm_key}"~"{values_str}"](around:{radius}, {path_latlon});')
        
        # Final Overpass API query string
        return f"""
        [out:json];
        (
        {' '.join(queries)}
        );
        out center;
        """
