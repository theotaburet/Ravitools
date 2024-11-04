import argparse
import os
import logging
from Ravitools.config import Config
from Ravitools.overpass_client import OverpassClient
from Ravitools.data_processor import DataProcessor
from Ravitools.map_generator import MapGenerator
from Ravitools.gpx_smoother import GPXSmoother

def main():
    """
    Main entry point for the GPX Amenity Mapper.
    
    Design Pattern: Facade (provides a simple interface to the complex subsystem)
    """
    parser = argparse.ArgumentParser(description="GPX Amenity Mapper")
    parser.add_argument("gpx_file", help="Path to the GPX file")
    parser.add_argument("--config", default="config/config.yaml", help="Path to the configuration file")
    parser.add_argument("--output", default="map.html", help="Output file name")
    parser.add_argument("--radius", type=float, default=1000, help="Radius around the GPX path to search for amenities (in meters)")
    parser.add_argument("--log", default="info", choices=['debug', 'info', 'warning', 'error'], help="Logging level")
    args = parser.parse_args()

    config = Config(args.config)

    # Set up logging
    log_file = os.path.join(config.paths["logs"], f'{os.path.splitext(os.path.basename(args.gpx_file))[0]}.log') # Log file path, btw which is the basename of the gpx_file
    logging.basicConfig(level=getattr(logging, args.log.upper()),
                        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
                        handlers=[
                            logging.FileHandler(log_file),  # Log to file
                            logging.StreamHandler()         # Log to console
                        ])

    overpass_client = OverpassClient(config)
    data_processor = DataProcessor(config)
    map_generator = MapGenerator(config)

    # Load GPX file
    #gpx_latlon = GPXParser.parse(args.gpx_file)
    point_spacing = (0.5*args.radius)*(1-0.25)
    GPX_processing_result = GPXSmoother.smooth(args.gpx_file, point_spacing)

    # Query Overpass API
    overpass_queryresult = overpass_client.query_amenities(GPX_processing_result.smoothed_path, args.radius*(1+0.25))

    # Process data
    pois, feature_groups = data_processor.process_amenities(overpass_queryresult)

    # Then create map using the feature groups
    generator = MapGenerator(config)
    map_obj = generator.create_map(
        feature_groups=feature_groups,
        gpx_paths=[args.gpx_file]
    )

    # Save the map
    generator.save_map('output_map.html')


    # Export to KMZ with styled icons
    generator.export_to_kml(
        feature_groups=feature_groups,
        gpx_paths=[args.gpx_file],
        output_path='output_map.kmz'
    )
    
if __name__ == "__main__":
    main()