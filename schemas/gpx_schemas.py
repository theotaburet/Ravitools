# schemas/gpx_schemas.py
import folium
from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Tuple, Dict, Union
from utils.utils import POI, POICollection
from pathlib import Path

class GPXUploadResponse(BaseModel):
    """Response schema for GPX file upload."""
    message: str
    file_path: Path
    
    model_config = ConfigDict(from_attributes=True)

class ProcessGPXRequest(BaseModel):
    """Request schema for GPX processing."""
    file_path: Path
    radius: float = Field(
        default=500.0, 
        ge=0.0, 
        le=5000.0, 
        description="Search radius in meters"
    )

class ProcessGPXResponse(BaseModel):
    """Response schema for GPX processing."""
    message: str
    map_path: Optional[Path] = None
    kmz_path: Optional[Path] = None
    pois: Optional[List[POI]] = None
    pois_collection: Optional[POICollection] = None
    feature_groups: Optional[Union[str, folium.FeatureGroup]] = None
    pois_count: int

    # Enable support for arbitrary types like folium.FeatureGroup
    model_config = ConfigDict(arbitrary_types_allowed=True)

class VisualizationRequest(BaseModel):
    """Request schema for visualization."""
    file_paths: List[Path]