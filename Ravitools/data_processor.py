from typing import List, Dict, Any, Optional
from .config import Config
from .utils import POI
import logging
from tqdm import tqdm

class DataProcessor:
    """
    Processor for converting raw Overpass API data into POI objects.
    
    Design Pattern: Factory Method (creates POI objects)
    """
    def __init__(self, config: Config):
        self.config = config

    def process_amenities(self, raw_data: Dict[str, Any]) -> List[POI]:
        """Process raw amenity data into a list of POI objects."""
        logging.info("Processing amenities")
        pois = []
        for feature in tqdm(raw_data['features'], desc="Processing POIs"):
            poi = self._create_poi(feature)
            if poi:
                pois.append(poi)
        logging.info(f"Processed {len(pois)} POIs")
        return pois

    def _create_poi(self, feature: Dict[str, Any]) -> Optional[POI]:
        """Create a POI object from a feature dictionary."""
        amenity_type = feature['properties'].get('amenity')
        if not amenity_type:
            return None

        lon, lat = feature['geometry']['coordinates']
        name = feature['properties'].get('name')

        icon_config = self.config.get_nested('map_features', amenity_type, 'icon_prototype', default={})
        
        return POI(
            lat=lat,
            lon=lon,
            type=amenity_type,
            name=name,
            icon=icon_config.get('icon', 'info-sign'),
            color=icon_config.get('color', 'blue'),
            description=f"{amenity_type}: {name}" if name else amenity_type
        )