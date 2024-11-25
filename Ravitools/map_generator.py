"""
MapGenerator module for creating interactive maps and KML/KMZ exports.
Supports Folium maps with GPX paths and POIs, with enhanced icon handling for various map applications.
"""
import logging
import re
from typing import List, Tuple, Dict, Optional, Union, Set
from pathlib import Path
import zipfile
import shutil
import tempfile
from dataclasses import dataclass
from enum import Enum
from functools import lru_cache
from contextlib import contextmanager
import lxml.etree as ET
from defusedxml.lxml import parse as safe_parse
import folium
from folium import plugins
import gpxpy
import simplekml
from cairosvg import svg2png
from .config import Config

logger = logging.getLogger(__name__)

class MapGeneratorError(Exception):
    """Base exception for MapGenerator errors"""
    pass

class IconProcessingError(MapGeneratorError):
    """Raised when icon processing fails"""
    pass

class FileOperationError(MapGeneratorError):
    """Raised when file operations fail"""
    pass

class IconFormat(Enum):
    """Supported icon formats and their configurations"""
    SVG = "svg"
    PNG = "png"
    
    @classmethod
    def get_size(cls, target_app: str) -> Tuple[int, int]:
        """Get icon size for target application"""
        SIZES = {
            "google_earth": (32, 32),
            "organic_maps": (64, 64),
            "default": (48, 48)
        }
        return SIZES.get(target_app, SIZES["default"])

@dataclass
class IconStyle:
    """Icon styling configuration"""
    icon: str
    icon_shape: str
    border_color: str
    border_width: int
    text_color: str
    background_color: str
    
    @classmethod
    def from_folium_icon(cls, folium_icon) -> 'IconStyle':
        """Create IconStyle from Folium icon options"""
        return cls(
            icon=folium_icon['icon'],
            icon_shape=folium_icon['iconShape'],
            border_color=folium_icon['borderColor'].lstrip('#'),
            border_width=folium_icon['borderWidth'],
            text_color=folium_icon['textColor'].lstrip('#'),
            background_color=folium_icon['backgroundColor'].lstrip('#')
        )

class IconStyler:
    """Helper class for icon styling operations"""
    
    def __init__(self, icon_folder: Path):
        self.icon_folder = Path(icon_folder)
        if not self.icon_folder.is_dir():
            raise FileOperationError(f"Icon folder not found: {icon_folder}")

    @lru_cache(maxsize=128)
    def color_svg(self, source_icon: str, color: str) -> bytes:
        """Color all elements in an SVG file to a specified color."""
        try:
            source_path = Path(source_icon)
            if not source_path.is_file():
                raise FileOperationError(f"Icon file not found: {source_icon}")
                
            tree = safe_parse(source_path)
            root = tree.getroot()
            namespaces = {'svg': 'http://www.w3.org/2000/svg'}
            
            for tag in ['path', 'circle', 'rect', 'g']:
                for elem in root.xpath(f'.//svg:{tag}', namespaces=namespaces):
                    elem.set('fill', color)
                    elem.set('stroke', color)
            
            return ET.tostring(root)
        except Exception as e:
            raise IconProcessingError(f"Failed to color SVG: {e}")

    @contextmanager
    def create_temp_folder(self):
        """Create and manage temporary folder for icon processing"""
        temp_dir = tempfile.mkdtemp(prefix='map_icons_')
        try:
            yield Path(temp_dir)
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def create_styled_svg(
        self,
        source_icon: Path,
        icon_style: IconStyle,
        temp_folder: Path,
        size: Tuple[int, int] = (48, 48)
    ) -> Path:
        """Create a styled SVG icon with a colored inner SVG inside a circular border."""
        try:
            colored_svg_data = self.color_svg(str(source_icon), '#' + icon_style.text_color)
            styled_name = f"{icon_style.icon}_{icon_style.background_color}_{icon_style.text_color}.svg"
            output_path = temp_folder / styled_name

            svg_root = ET.Element('svg', {
                'xmlns': 'http://www.w3.org/2000/svg',
                'width': str(size[0]),
                'height': str(size[1]),
                'viewBox': f'0 0 {size[0]} {size[1]}'
            })

            center_x, center_y = size[0] // 2, size[1] // 2
            radius = min(size[0], size[1]) // 2 - 2

            # Create border and background circles
            for r, fill in [(radius + 2, '#' + icon_style.border_color),
                           (radius, '#' + icon_style.background_color)]:
                ET.SubElement(svg_root, 'circle', {
                    'cx': str(center_x),
                    'cy': str(center_y),
                    'r': str(r),
                    'fill': fill
                })

            # Add colored icon
            icon_group = ET.SubElement(svg_root, 'g', {
                'transform': (f'translate({center_x}, {center_y}) '
                            f'scale(0.6) '
                            f'translate({-size[0]//2}, {-size[1]//2})')
            })
            icon_group.append(ET.fromstring(colored_svg_data))

            with output_path.open('w', encoding='utf-8') as f:
                f.write(ET.tostring(svg_root, pretty_print=True, encoding='unicode'))

            return output_path
        except Exception as e:
            raise IconProcessingError(f"Failed to create styled SVG: {e}")

    def convert_svg_to_png(
        self,
        svg_path: Path,
        output_path: Optional[Path] = None,
        size: Tuple[int, int] = (48, 48)
    ) -> Path:
        """Convert SVG icon to PNG format with specified size."""
        try:
            if output_path is None:
                output_path = svg_path.with_suffix('.png')
                
            svg2png(
                url=str(svg_path),
                write_to=str(output_path),
                output_width=size[0],
                output_height=size[1]
            )
            
            return output_path
        except Exception as e:
            raise IconProcessingError(f"Failed to convert SVG to PNG: {e}")

class MapGenerator:
    """Generator for creating Folium maps with GPX paths and POIs."""
    
    def __init__(self, config: Config):
        """Initialize MapGenerator with configuration."""
        self.config = config
        self.icon_folder = Path(config.icons_folder)
        if not self.icon_folder.exists():
            raise FileOperationError(f"Icon folder not found: {self.icon_folder}")
        self._last_map = None
        self.icon_styler = IconStyler(self.icon_folder)

    def create_map(self, 
                  feature_groups: Dict[str, folium.FeatureGroup],
                  gpx_paths: Optional[List[Union[str, Path]]] = None,
                  center: Optional[Tuple[float, float]] = None,
                  zoom_start: int = 12) -> folium.Map:
        """Create a Folium map with GPX paths and POIs."""
        logger.info("Generating map")
        
        try:
            # Convert all gpx_paths to Path objects if they're strings
            if gpx_paths:
                gpx_paths = [Path(gpx) if isinstance(gpx, str) else gpx for gpx in gpx_paths]

            if not center:
                if gpx_paths:
                    center = self._calculate_center_from_gpx(gpx_paths[0])
                else:
                    center = self._calculate_center_from_feature_groups(feature_groups)
            
            map_obj = folium.Map(
                location=center,
                zoom_start=zoom_start,
                control_scale=True
            )
            
            if gpx_paths:
                for gpx_path in gpx_paths:
                    self._add_gpx_ant_path(map_obj, gpx_path)

            for group in feature_groups.values():
                map_obj.add_child(group)

            folium.LayerControl().add_to(map_obj)
            plugins.Fullscreen().add_to(map_obj)
            
            self._last_map = map_obj
            return map_obj
            
        except Exception as e:
            raise MapGeneratorError(f"Failed to create map: {e}")
            
    def export_to_kml(self, 
                     feature_groups: Dict[str, folium.FeatureGroup],
                     gpx_paths: Optional[List[Path]] = None,
                     output_path: Union[str, Path] = 'output.kmz',
                     use_kmz: bool = True,
                     icon_format: IconFormat = IconFormat.PNG,
                     target_app: str = "google_earth") -> None:
        """
        Export map data to KML/KMZ format.
        
        Args:
            feature_groups: Dictionary of feature groups to export
            gpx_paths: Optional list of GPX file paths to include
            output_path: Path for the output file
            use_kmz: Whether to create KMZ (True) or KML (False)
            icon_format: Format for icons (PNG or SVG)
            target_app: Target application for icon sizing
            
        Raises:
            MapGeneratorError: If export fails
        """
        logger.info(f"Exporting to {'KMZ' if use_kmz else 'KML'} with {icon_format.value} icons")
        output_path = Path(output_path)
        
        with self.icon_styler.create_temp_folder() as temp_folder:
            try:
                kml = simplekml.Kml()
                icon_files: Set[Path] = set()
                icon_size = IconFormat.get_size(target_app)

                self._process_feature_groups(
                    kml, feature_groups, icon_files, 
                    icon_format, icon_size, temp_folder
                )
                
                if gpx_paths:
                    tracks_folder = kml.newfolder(name='GPX Tracks')
                    for gpx_path in gpx_paths:
                        self._add_gpx_to_kml(tracks_folder, gpx_path)

                if use_kmz and icon_files:
                    self._save_kmz(kml, icon_files, output_path, temp_folder)
                else:
                    kml.save(str(output_path))
                    
            except Exception as e:
                raise MapGeneratorError(f"Failed to export map: {e}")
            
        logger.info(f"Export completed: {output_path}")

    def _process_feature_groups(self, 
                              kml: simplekml.Kml, 
                              feature_groups: Dict[str, folium.FeatureGroup],
                              icon_files: Set[Path],
                              icon_format: IconFormat,
                              icon_size: Tuple[int, int],
                              temp_folder: Path) -> None:
        """Process feature groups for KML export."""
        for group_name, group in feature_groups.items():
            folder = kml.newfolder(name=group_name)
            
            for _, child in group._children.items():
                if isinstance(child, folium.Marker):
                    self._process_marker(child, folder, icon_files, icon_format, icon_size, temp_folder)

    def _process_marker(self,
                   marker: folium.Marker,
                   folder: simplekml.Folder,
                   icon_files: Set[Path],
                   icon_format: IconFormat,
                   icon_size: Tuple[int, int],
                   temp_folder: Path) -> None:
        """Process a single marker for KML export."""
        name, description = self._extract_marker_content(marker)
        icon_style = IconStyle.from_folium_icon(marker.icon.options)
        icon_path = self._create_styled_icon(icon_style, icon_format, icon_size, temp_folder)
        
        if icon_path:
            icon_files.add(icon_path)
            icon_href = f'icons/{icon_path.name}'
        else:
            icon_href = None
        
        point = folder.newpoint(
            name=name,
            description=description,
            coords=[(marker.location[1], marker.location[0])]
        )
        
        if icon_href:
            style = simplekml.Style()
            style.iconstyle.icon.href = icon_href
            style.iconstyle.scale = 1.0
            point.style = style

    @staticmethod
    def _extract_marker_content(marker: folium.Marker) -> Tuple[str, str]:
        """
        Extract name and description from a Folium marker.
        
        Returns:
            Tuple[str, str]: (name, description)
        """
        try:
            name = marker.options['poi_data']['name']
            description = marker.options['poi_data']['description']
            return name, description
        except (KeyError, AttributeError) as e:
            logger.warning(f"Could not extract POI data from marker options: {e}. Using fallback method.")
            
            name = "Point of Interest"
            description = ""
            
            if hasattr(marker, 'popup') and marker.popup:
                popup_content = str(marker.popup)
                content = re.sub(r'<[^>]+>', '', popup_content).strip()
                
                parts = content.split('\n', 1)
                name = parts[0] or name
                description = parts[1] if len(parts) > 1 else ""
                
            if hasattr(marker, 'tooltip') and marker.tooltip:
                tooltip = re.sub(r'<[^>]+>', '', str(marker.tooltip)).strip()
                description = f"{description}\n\n{tooltip}" if description else tooltip
                
            return name, description

    def _create_styled_icon(self,
                          icon_style: IconStyle,
                          icon_format: IconFormat,
                          size: Tuple[int, int],
                          temp_folder: Path) -> Optional[Path]:
        """Create a styled icon based on icon properties."""
        source_icon = self.icon_folder / f"{icon_style.icon}.svg"

        if not source_icon.exists():
            logger.warning(f"Icon file not found: {source_icon}")
            return None
            
        try:
            svg_path = self.icon_styler.create_styled_svg(
                source_icon, 
                icon_style, 
                temp_folder,
                size=size
            )
            
            return (self.icon_styler.convert_svg_to_png(svg_path, size=size) 
                   if icon_format == IconFormat.PNG else svg_path)
            
        except IconProcessingError as e:
            logger.error(f"Error creating styled icon: {e}")
            return None

    def _save_kmz(self, 
                kml: simplekml.Kml, 
                icon_files: Set[Path], 
                output_path: Path,
                temp_folder: Path) -> None:
        """Save KML and icons as a KMZ file."""
        temp_kml = temp_folder / f'{output_path.stem}.kml'
        kml.save(str(temp_kml))
        
        with zipfile.ZipFile(output_path, 'w') as kmz:
            kmz.write(temp_kml, f'{output_path.stem}.kml')
            for icon_file in icon_files:
                kmz.write(icon_file, Path('icons')/icon_file.name)

    def _calculate_center_from_feature_groups(
            self, 
            feature_groups: Dict[str, folium.FeatureGroup]
        ) -> Tuple[float, float]:
        """Calculate center point from feature groups' markers."""
        all_coords = []
        for group in feature_groups.values():
            for _, child in group._children.items():
                if isinstance(child, folium.Marker):
                    all_coords.append(child.location)
        
        if not all_coords:
            return (0.0, 0.0)
            
        return (
            sum(lat for lat, _ in all_coords) / len(all_coords),
            sum(lon for _, lon in all_coords) / len(all_coords)
        )

    def _calculate_center_from_gpx(self, gpx_path: Path) -> Tuple[float, float]:
        """Calculate the center point of a GPX file."""
        try:
            with gpx_path.open('r') as gpx_file:
                gpx = gpxpy.parse(gpx_file)
                points = []
                for track in gpx.tracks:
                    for segment in track.segments:
                        points.extend([(p.latitude, p.longitude) for p in segment.points])
                
                if not points:
                    return (0.0, 0.0)
                    
                return (
                    sum(lat for lat, _ in points) / len(points),
                    sum(lon for _, lon in points) / len(points)
                )
        except Exception as e:
            logger.error(f"Error calculating center from GPX: {e}")
            return (0.0, 0.0)

    def _add_gpx_ant_path(self, map_obj: folium.Map, gpx_path: Union[Path, str]) -> None:
        """Add a GPX path to the map as an ant path."""
        try:
            # Ensure gpx_path is a Path object
            gpx_path = Path(gpx_path) if isinstance(gpx_path, str) else gpx_path

            with gpx_path.open('r') as gpx_file:
                gpx = gpxpy.parse(gpx_file)
                
                for track in gpx.tracks:
                    for segment in track.segments:
                        points = [(p.latitude, p.longitude) for p in segment.points]
                        track_group = folium.FeatureGroup(name=f"Track: {track.name or gpx_path.stem}")
                        
                        plugins.AntPath(
                            locations=points,
                            weight=3,
                            color='blue',
                            opacity=0.8,
                            popup=f"Distance: {track.length_3d():.1f}m",
                            delay=1000,
                            dash_array=[10, 20],
                            pulse_color='#FFF'
                        ).add_to(track_group)
                        
                        track_group.add_to(map_obj)
                        
        except Exception as e:
            logger.error(f"Error adding GPX ant path: {e}")
            raise MapGeneratorError(f"Failed to add GPX path: {e}")

    def _add_gpx_to_kml(self, folder: simplekml.Folder, gpx_path: Union[Path, str]) -> None:
        """Add GPX track to KML folder."""
        try:
            # Ensure gpx_path is a Path object
            gpx_path = Path(gpx_path) if isinstance(gpx_path, str) else gpx_path

            with gpx_path.open('r') as gpx_file:
                gpx = gpxpy.parse(gpx_file)
                
                for track in gpx.tracks:
                    for segment in track.segments:
                        coords = [(p.longitude, p.latitude) for p in segment.points]
                        
                        if coords:
                            line = folder.newlinestring(
                                name=track.name or gpx_path.stem,
                                coords=coords
                            )
                            line.style.linestyle.color = simplekml.Color.blue
                            line.style.linestyle.width = 3
                            
        except Exception as e:
            logger.error(f"Error adding GPX to KML: {e}")
            raise MapGeneratorError(f"Failed to add GPX to KML: {e}")

    def save_map(self, output_path: str) -> None:
        """
        Save the map to an HTML file.
        
        Args:
            output_path: Path to save the HTML file
            
        Raises:
            MapGeneratorError: If saving fails
            ValueError: If no map exists to save
        """
        if not self._last_map:
            raise ValueError("No map to save. Call create_map() first.")
            
        try:
            self._last_map.save(output_path)
            logger.info(f"Map saved to {output_path}")
        except Exception as e:
            raise MapGeneratorError(f"Failed to save map: {e}")