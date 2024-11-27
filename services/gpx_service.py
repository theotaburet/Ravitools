# services/gpx_service.py
import logging
from pathlib import Path
import folium
import zipfile
import json
from typing import List, Tuple

from config.settings import settings
from exceptions.custom_exceptions import GPXProcessingError, FileNotFoundError
from schemas.gpx_schemas import ProcessGPXResponse
from utils.gpx_smoother import GPXSmoother
from utils.overpass_client import OverpassClient
from utils.map_generator import MapGenerator
from utils.data_processor import DataProcessor

class GPXService:
    """Service for processing GPX files and related operations."""
    
    def __init__(
        self, 
        overpass_client: OverpassClient, 
        data_processor: DataProcessor,
        map_generator: MapGenerator
    ):
        self.logger = logging.getLogger(self.__class__.__name__)
        self.overpass_client = overpass_client
        self.data_processor = data_processor
        self.map_generator = map_generator
    
    def process_gpx(
        self, 
        file_path: Path, 
        radius: float = settings.DEFAULT_RADIUS
    ) -> ProcessGPXResponse:
        """
        Process a GPX file with comprehensive error handling.
        
        Args:
            file_path (Path): Path to the GPX file
            radius (float): Search radius for amenities
        
        Returns:
            ProcessGPXResponse: Processing results
        """
        try:
            # Validate file exists
            if not file_path.exists():
                raise FileNotFoundError(str(file_path))
            
            # Smooth GPX path
            smoothing_result = GPXSmoother.smooth(
                str(file_path), 
                point_spacing=radius * 0.5
            )
            
            # Query amenities
            query_result = self.overpass_client.query_amenities(
                smoothing_result.smoothed_path, 
                radius
            )
            
            # Process amenities
            pois, feature_groups = self.data_processor.process_amenities(query_result)
            
            # Generate map
            map_obj = self.map_generator.create_map(
                feature_groups=feature_groups, 
                gpx_paths=[file_path]
            )
            
            # Output paths
            output_map_path = Path(settings.OUTPUT_DIR) / f"{file_path.stem}_map.html"
            output_kmz_path = Path(settings.OUTPUT_DIR) / f"{file_path.stem}.kmz"
            
            # Save map and KMZ
            map_obj.save(str(output_map_path))
            self.map_generator.export_to_kml(
                feature_groups=feature_groups,
                gpx_paths=[file_path],
                output_path=str(output_kmz_path)
            )
            
            self.logger.info(f"Successfully processed {file_path}")
            
            return ProcessGPXResponse(
                message="GPX processed successfully",
                map_path=output_map_path,
                kmz_path=output_kmz_path,
                pois = pois,
                feature_groups = feature_groups,
                pois_count=len(pois.pois)
            )
        
        except Exception as e:
            self.logger.error(f"GPX processing error: {e}")
            raise GPXProcessingError(str(e))