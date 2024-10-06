import requests
import json
import logging

class OverpassQueryBuilder:
    def __init__(self, input_latlons):
        self.input_latlons = input_latlons

    def build_query(self, features):
        logging.debug(f"Building Overpass query with features: {features}")
        query_parts = []
        for feature, details in features.items():
            for osm_key in details['OSM_key']:
                key, value = list(osm_key.items())[0]
                query_parts.append(f'nwr["{key}" = "{value}"](around:1000,{self.input_latlons});')
        query_body = "\n".join(query_parts)
        query = f"""
        [out:json][timeout: 500];
        (
            {query_body}
            ( ._; >; );
        );
        out center;
        """
        logging.debug(f"Generated Overpass query: {query[:100]}")
        return query

class POIExtractor:
    def __init__(self, input_df, config, cache_manager):
        self.input_latlons = ",".join(input_df[["latitude", "longitude"]].to_numpy().flatten().astype("str"))
        self.map_features = config.get('map_features', {})
        self.cache_manager = cache_manager

    def extract_pois(self):
        query_builder = OverpassQueryBuilder(self.input_latlons)
        overpass_query = query_builder.build_query(self.map_features)

        if self.cache_manager.cache_exists():
            logging.info("Cache found, loading results from cache.")
            result_data = self.cache_manager.load_cache()
        else:
            logging.info("Cache not found, querying Overpass API.")
            overpass_url = "http://overpass-api.de/api/interpreter"
            response = requests.post(overpass_url, data={'data': overpass_query})

            if response.status_code == 200:
                result_data = response.json()
                self.cache_manager.save_cache(result_data)
                logging.info("Result data cached successfully.")
            else:
                logging.error(f"Error: {response.status_code}")
                logging.error(response.text)
                raise Exception(f"Failed to fetch data from Overpass API: {response.status_code} - {response.text}")

        # Update the cached JSON with the "center" property if missing
        self.cache_manager.update_json_with_center()

        return result_data
