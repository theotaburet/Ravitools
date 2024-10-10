from dataclasses import asdict, dataclass, field
from typing import Dict, Any, List, Tuple, Optional, TypedDict
from pathlib import Path

from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Tuple, Optional, TypedDict
import json
import logging

logger = logging.getLogger(__name__)

@dataclass
class GPXProcessingResult:
    """
    Data structure to hold the results of GPX path smoothing and processing.
    
    Attributes:
        original_points (int): The number of points in the original GPX file.
        smoothed_points (int): The number of points after smoothing.
        original_path (List[Tuple[float, float]]): The original list of (latitude, longitude) points.
        smoothed_path (List[Tuple[float, float]]): The resampled and smoothed list of points.
        total_distance (float): The total distance of the path in meters.
    """
    original_points: int
    smoothed_points: int
    original_path: List[Tuple[float, float]]
    smoothed_path: List[Tuple[float, float]]
    total_distance: float

class IconPrototype(TypedDict):
    """Type definition for icon prototype configuration."""
    icon_shape: str
    border_color: str
    border_width: str
    text_color: str
    background_color: str

class OSMKeyConfig(TypedDict):
    """Type definition for OSM key configuration."""
    name: bool
    icon: str
    group: Optional[str]

class FeatureConfig(TypedDict):
    """Type definition for feature configuration."""
    icon_prototype: IconPrototype
    OSM_key: List[Dict[str, Any]]

@dataclass
class OSMMapping:
    """Data class for OSM mapping information."""
    map_feature: str
    icon_prototype: IconPrototype
    name: bool
    icon: str
    group: Optional[str]

@dataclass
class POI:
    """Represents a Point of Interest."""
    lat: float
    lon: float
    type: str
    name: Optional[str]
    icon: str
    color: str
    description: Optional[str]
    tags: Dict[str, Any] = field(default_factory=dict)

@dataclass
class POICollection:
    """Collection of POIs with metadata."""
    pois: List[POI]
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    config_hash: str = ""

    def save(self, filepath: Path) -> None:
        """Save the POI collection to a JSON file."""
        data = asdict(self)
        with open(filepath, 'w') as f:
            json.dump(data, f, indent=2)
        logger.info(f"Saved {len(self.pois)} POIs to {filepath}")

    @classmethod
    def load(cls, filepath: Path) -> 'POICollection':
        """Load a POI collection from a JSON file."""
        try:
            with open(filepath, 'r') as f:
                data = json.load(f)
            
            pois = [POI(**poi_data) for poi_data in data['pois']]
            return cls(
                pois=pois,
                created_at=data['created_at'],
                config_hash=data['config_hash']
            )
        except FileNotFoundError:
            logger.error(f"File not found: {filepath}")
            raise
        except json.JSONDecodeError:
            logger.error(f"Invalid JSON in file: {filepath}")
            raise