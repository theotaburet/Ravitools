"""
MapGenerator module for creating interactive maps and KML/KMZ exports.
Supports Folium maps with GPX paths and POIs, with enhanced icon handling for various map applications.
"""
import lxml.etree as ET
import logging
from typing import List, Tuple, Dict, Optional, Union, Set, Literal
from pathlib import Path
import colorsys
import os
import zipfile
import shutil
import io
from PIL import Image
import folium
from folium import plugins
import gpxpy
import simplekml
from cairosvg import svg2png
from .config import Config
from .utils import POI, POICollection

logger = logging.getLogger(__name__)

class IconFormat:
    """Supported icon formats and their configurations"""
    SVG = "svg"
    PNG = "png"
    
    # Standard sizes for different map applications
    SIZES = {
        "google_earth": (32, 32),  # Google Earth preferred size
        "organic_maps": (64, 64),  # Larger size for mobile apps
        "default": (48, 48)        # Default size
    }

class IconStyler:
    """Helper class for icon styling operations"""
    
    def __init__(self, icon_folder: Path):
        self.icon_folder = icon_folder

    def color_svg(self, source_icon: Path, color: str) -> bytes:
        """Color all elements in an SVG file to a specified color."""
        tree = ET.parse(source_icon)
        root = tree.getroot()
        
        namespaces = {'svg': 'http://www.w3.org/2000/svg'}
        
        def _color_element(element):
            for tag in ['path', 'circle', 'rect', 'g']:
                for elem in element.xpath(f'.//svg:{tag}', namespaces=namespaces):
                    elem.set('fill', color)
                    elem.set('stroke', color)
        
        _color_element(root)
        return ET.tostring(root)

    def create_styled_svg(
        self,
        source_icon: Path,
        icon_name: str,
        icon_style: dict,
        temp_folder: Path,
        size: Tuple[int, int] = (48, 48)
    ) -> Path:
        """Create a styled SVG icon with a colored inner SVG inside a circular border."""
        colored_svg_data = self.color_svg(source_icon, '#' + icon_style['text_color'])
        
        styled_name = f"{icon_name}_{icon_style['background_color']}_{icon_style['text_color']}.svg"
        output_path = temp_folder / styled_name

        svg_root = ET.Element('svg', {
            'xmlns': 'http://www.w3.org/2000/svg',
            'width': str(size[0]),
            'height': str(size[1]),
            'viewBox': f'0 0 {size[0]} {size[1]}'
        })

        # Create circles
        center_x, center_y = size[0] // 2, size[1] // 2
        radius = min(size[0], size[1]) // 2 - 2  # Slightly smaller for border

        # Outer circle (border)
        ET.SubElement(svg_root, 'circle', {
            'cx': str(center_x),
            'cy': str(center_y),
            'r': str(radius + 2),  # Border circle
            'fill': '#' + icon_style['border_color']
        })

        # Inner circle (background)
        ET.SubElement(svg_root, 'circle', {
            'cx': str(center_x),
            'cy': str(center_y),
            'r': str(radius),
            'fill': '#' + icon_style['background_color']
        })

        # Scale factor for inner icon (slightly smaller to fit inside circle)
        scale_factor = 0.6
        
        # Add colored icon
        icon_group = ET.SubElement(svg_root, 'g', {
            'transform': (f'translate({center_x}, {center_y}) '
                        f'scale({scale_factor}) '
                        f'translate({-size[0]//2}, {-size[1]//2})')
        })
        icon_group.append(ET.fromstring(colored_svg_data))

        with output_path.open('w', encoding='utf-8') as f:
            f.write(ET.tostring(svg_root, pretty_print=True, encoding='unicode'))

        return output_path

    def convert_svg_to_png(
        self,
        svg_path: Path,
        output_path: Optional[Path] = None,
        size: Tuple[int, int] = (48, 48)
    ) -> Path:
        """Convert SVG icon to PNG format with specified size."""
        if output_path is None:
            output_path = svg_path.with_suffix('.png')
            
        # Use cairosvg to convert SVG to PNG
        svg2png(
            url=str(svg_path),
            write_to=str(output_path),
            output_width=size[0],
            output_height=size[1]
        )
        
        return output_path

class MapGenerator:
    """Generator for creating Folium maps with GPX paths and POIs."""
    
    def __init__(self, config: Config):
        self.config = config
        self.icon_folder = Path('icons/fontawesome-free-6.6.0-desktop/svgs/solid/')
        self.temp_folder = Path('temp_icons')
        self._last_map = None
        self.icon_styler = IconStyler(self.icon_folder)

    def create_map(self, 
                  feature_groups: Dict[str, folium.FeatureGroup],
                  gpx_paths: Optional[List[Path]] = None,
                  center: Optional[Tuple[float, float]] = None,
                  zoom_start: int = 12) -> folium.Map:
        """Create a Folium map with GPX paths and POIs."""
        logger.info("Generating map")
        
        center = center or (
            self._calculate_center_from_gpx(gpx_paths[0]) if gpx_paths
            else self._calculate_center_from_feature_groups(feature_groups)
        )
        
        map_obj = folium.Map(
            location=center,
            zoom_start=zoom_start,
            control_scale=True
        )
        
        if gpx_paths:
            for gpx_path in gpx_paths:
                self._add_gpx_ant_path(map_obj, gpx_path)

        self._add_feature_groups(map_obj, feature_groups)

        folium.LayerControl().add_to(map_obj)
        plugins.Fullscreen().add_to(map_obj)
        
        self._last_map = map_obj
        return map_obj

    def export_to_kml(self, 
                     feature_groups: Dict[str, folium.FeatureGroup],
                     gpx_paths: Optional[List[Path]] = None,
                     output_path: Union[str, Path] = 'output.kmz',
                     use_kmz: bool = True,
                     icon_format: str = IconFormat.PNG,
                     target_app: str = "google_earth") -> None:
        """
        Export map data to KML/KMZ format.
        
        Args:
            feature_groups: Feature groups to export
            gpx_paths: Optional list of GPX files to include
            output_path: Path to save the output file
            use_kmz: Whether to create a KMZ file with embedded icons
            icon_format: Format for icons ("svg" or "png")
            target_app: Target application ("google_earth", "organic_maps", or "default")
        """
        logger.info(f"Exporting to {'KMZ' if use_kmz else 'KML'} with {icon_format} icons")
        output_path = Path(output_path)
        
        self.temp_folder.mkdir(exist_ok=True)
        
        try:
            kml = simplekml.Kml()
            icon_files: Set[Path] = set()

            # Get icon size based on target app
            icon_size = IconFormat.SIZES.get(target_app, IconFormat.SIZES["default"])

            self._process_feature_groups(
                kml, 
                feature_groups, 
                icon_files, 
                icon_format=icon_format,
                icon_size=icon_size
            )
            
            if gpx_paths:
                self._process_gpx_tracks(kml, gpx_paths)

            if use_kmz and icon_files:
                self._save_kmz(kml, icon_files, output_path)
            else:
                kml.save(str(output_path))
                
        finally:
            if self.temp_folder.exists():
                shutil.rmtree(self.temp_folder)
            
        logger.info(f"Export completed: {output_path}")

    def _process_feature_groups(self, 
                              kml: simplekml.Kml, 
                              feature_groups: Dict[str, folium.FeatureGroup],
                              icon_files: Set[Path],
                              icon_format: str = IconFormat.PNG,
                              icon_size: Tuple[int, int] = (48, 48)) -> None:
        """Process feature groups for KML export."""
        for group_name, group in feature_groups.items():
            folder = kml.newfolder(name=group_name)
            
            for _, child in group._children.items():
                if isinstance(child, folium.Marker):
                    # Extract all possible description content
                    name, description = self._extract_marker_content(child)
                    
                    icon_style = self._extract_icon_style(child.icon.options)
                    icon_path = self._create_styled_icon(
                        icon_style, 
                        icon_format=icon_format,
                        size=icon_size
                    )
                    
                    if icon_path:
                        icon_files.add(Path(icon_path))
                    
                    point = folder.newpoint(
                        name=name,
                        description=description,  # Add the full description
                        coords=[(child.location[1], child.location[0])]
                    )
                    
                    if icon_path:
                        style = self._create_kml_style(kml, Path(icon_path))
                        point.style = style

    def _create_styled_icon(self, 
                          icon_style: dict, 
                          icon_format: str = IconFormat.PNG,
                          size: Tuple[int, int] = (48, 48)) -> Optional[str]:
        """Create a styled icon based on BeautifyIcon properties."""
        icon_name = icon_style['icon']
        source_icon = self.icon_folder / f"{icon_name}.svg"

        if not source_icon.exists():
            logger.warning(f"Icon file not found: {source_icon}")
            return None
            
        try:
            # Create SVG first
            svg_path = self.icon_styler.create_styled_svg(
                source_icon, 
                icon_name, 
                icon_style, 
                self.temp_folder,
                size=size
            )
            
            # Convert to PNG if requested
            if icon_format == IconFormat.PNG:
                png_path = self.icon_styler.convert_svg_to_png(svg_path, size=size)
                return str(png_path)
            
            return str(svg_path)
            
        except Exception as e:
            logger.error(f"Error creating styled icon: {e}")
            return None

    def _create_kml_style(self, kml: simplekml.Kml, icon_path: Path) -> simplekml.Style:
        """Create a KML style with custom icon styling."""
        style = simplekml.Style()
        style.iconstyle.icon.href = icon_path.name
        
        # Set icon scale based on size
        style.iconstyle.scale = 1.0  # Adjust if needed
        
        return style

    def _save_kmz(self, kml: simplekml.Kml, icon_files: Set[Path], output_path: Path) -> None:
        """Save KML and icons as a KMZ file."""
        temp_kml = self.temp_folder / 'doc.kml'
        kml.save(str(temp_kml))
        
        with zipfile.ZipFile(output_path, 'w') as kmz:
            kmz.write(temp_kml, 'doc.kml')
            for icon_file in icon_files:
                kmz.write(icon_file, icon_file.name)
                
        temp_kml.unlink()

    def _calculate_center_from_feature_groups(
            self, feature_groups: Dict[str, folium.FeatureGroup]
        ) -> Tuple[float, float]:
        """
        Calculate center point from feature groups' markers.
        
        Args:
            feature_groups (Dict[str, folium.FeatureGroup]): Feature groups
            
        Returns:
            Tuple[float, float]: Center coordinates
        """
        all_coords = []
        for group in feature_groups.values():
            for _, child in group._children.items():
                if isinstance(child, folium.Marker):
                    all_coords.append(child.location)
        
        if not all_coords:
            return (0, 0)
            
        return (
            sum(lat for lat, _ in all_coords) / len(all_coords),
            sum(lon for _, lon in all_coords) / len(all_coords)
        )

    def _calculate_center_from_gpx(self, gpx_path: Path) -> Tuple[float, float]:
        """
        Calculate the center point of a GPX file.
        
        Args:
            gpx_path (Path): Path to GPX file
            
        Returns:
            Tuple[float, float]: Center coordinates
        """
        try:
            with open(gpx_path, 'r') as gpx_file:
                gpx = gpxpy.parse(gpx_file)
                points = []
                for track in gpx.tracks:
                    for segment in track.segments:
                        points.extend([(p.latitude, p.longitude) for p in segment.points])
                
                if not points:
                    return (0, 0)
                    
                return (
                    sum(lat for lat, _ in points) / len(points),
                    sum(lon for _, lon in points) / len(points)
                )
        except Exception as e:
            logger.error(f"Error calculating center from GPX: {e}")
            return (0, 0)

    def _add_gpx_ant_path(self, map_obj: folium.Map, gpx_path: Path) -> None:
        """
        Add a GPX path to the map as an ant path.
        
        Args:
            map_obj (folium.Map): Map object to add the path to
            gpx_path (Path): Path to GPX file
        """
        logger.info(f"Adding GPX ant path from {gpx_path}")
        try:
            with open(gpx_path, 'r') as gpx_file:
                gpx = gpxpy.parse(gpx_file)
                
                for track in gpx.tracks:
                    for segment in track.segments:
                        points = [(p.latitude, p.longitude) for p in segment.points]
                        
                        # Add path to map
                        track_group = folium.FeatureGroup(name=f"Track: {track.name or gpx_path.stem}")
                        
                        # Add ant path
                        plugins.AntPath(
                            locations=points,
                            weight=3,
                            color='blue',
                            opacity=0.8,
                            popup=f"Distance: {track.length_3d():.1f}m",
                            delay=1000,  # Animation delay in milliseconds
                            dash_array=[10, 20],  # Pattern of the ant path
                            pulse_color='#FFF'  # Color of the pulse animation
                        ).add_to(track_group)
                        
                        track_group.add_to(map_obj)
                        
        except Exception as e:
            logger.error(f"Error adding GPX ant path: {e}")

    def _extract_marker_content(self, marker: folium.Marker) -> Tuple[str, str]:
        """
        Extract name and description from a Folium marker.
        
        Args:
            marker (folium.Marker): The marker to extract content from
            
        Returns:
            Tuple[str, str]: (name, description)
        """
        name = ""
        description = ""
        
        # Handle popup content
        if hasattr(marker, 'popup') and marker.popup:
            popup_content = marker.popup
            
            # If popup is an IFrame, extract its content
            if isinstance(popup_content, folium.elements.IFrame):
                popup_content = popup_content.html
            
            # If popup is a string, use it directly
            if isinstance(popup_content, str):
                # Try to split into title and description if the content contains line breaks
                parts = popup_content.split('<br>', 1)
                if len(parts) > 1:
                    name = self._clean_html(parts[0])
                    description = self._clean_html(parts[1])
                else:
                    name = self._clean_html(popup_content)
        
        # Add tooltip content to description if available
        if hasattr(marker, 'tooltip') and marker.tooltip:
            tooltip_content = self._clean_html(str(marker.tooltip))
            if description:
                description += "\n\n" + tooltip_content
            else:
                description = tooltip_content
                
        # If no name was found but we have a description, use the first line as name
        if not name and description:
            parts = description.split('\n', 1)
            name = parts[0]
            description = parts[1] if len(parts) > 1 else ""
            
        # Ensure we have at least a minimal name
        if not name:
            name = "Point of Interest"
            
        return name, description

    def _clean_html(self, text: str) -> str:
        """
        Clean HTML content from text while preserving line breaks.
        
        Args:
            text (str): Text to clean
            
        Returns:
            str: Cleaned text
        """
        # Replace HTML line breaks with newlines
        text = text.replace('<br>', '\n').replace('<br/>', '\n').replace('<br />', '\n')
        
        # Remove other HTML tags
        text = re.sub(r'<[^>]+>', '', text)
        
        # Clean up whitespace
        text = re.sub(r'\s+', ' ', text).strip()
        
        return text

    def _add_gpx_to_kml(self, folder: simplekml.Folder, gpx_path: Path) -> None:
        """
        Add GPX track to KML folder.
        
        Args:
            folder (simplekml.Folder): KML folder to add track to
            gpx_path (Path): Path to GPX file
        """
        try:
            with open(gpx_path, 'r') as gpx_file:
                gpx = gpxpy.parse(gpx_file)
                
                for track in gpx.tracks:
                    for segment in track.segments:
                        coords = [(p.longitude, p.latitude) for p in segment.points]
                        
                        if coords:
                            line = folder.newlinestring(
                                name=track.name or gpx_path.stem,
                                coords=coords
                            )
                            # Style the track
                            line.style.linestyle.color = simplekml.Color.blue
                            line.style.linestyle.width = 3
                            
        except Exception as e:
            logger.error(f"Error adding GPX to KML: {e}")

    def _add_feature_groups(self, 
                          map_obj: folium.Map,
                          feature_groups: Dict[str, folium.FeatureGroup]) -> None:
        """Add feature groups to map."""
        for group in feature_groups.values():
            map_obj.add_child(group)
    
    def save_map(self, output_path: str) -> None:
        """
        Save the map to an HTML file.
        
        Args:
            output_path (str): Path where to save the map
        """
        if not self._last_map:
            raise ValueError("No map to save. Call create_map() first.")
            
        try:
            self._last_map.save(output_path)
            logger.info(f"Map saved to {output_path}")
        except Exception as e:
            logger.error(f"Error saving map: {e}")
            raise

    def _process_gpx_tracks(self, kml: simplekml.Kml, gpx_paths: List[Path]) -> None:
        """Process GPX tracks for KML export."""
        tracks_folder = kml.newfolder(name='GPX Tracks')
        for gpx_path in gpx_paths:
            self._add_gpx_to_kml(tracks_folder, gpx_path)

    def _extract_icon_style(self, folium_icon) -> dict:
        """
        Extract styling information from a Folium BeautifyIcon.
        
        Args:
            folium_icon: Folium icon object
            
        Returns:
            dict: Icon styling properties
        """

        style = {
            'icon': folium_icon['icon'],
            'icon_shape': folium_icon['iconShape'],
            'border_color': folium_icon['borderColor'],
            'border_width': folium_icon['borderWidth'],
            'text_color': folium_icon['textColor'],
            'background_color': folium_icon['backgroundColor'],
        }

        # Remove '#' from color codes
        for key in ['border_color', 'text_color', 'background_color']:
            if style[key].startswith('#'):
                style[key] = style[key][1:]
                
        return style