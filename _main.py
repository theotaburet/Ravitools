import logging
from pathlib import Path
from gpx_parser import GPXParser, ConfigParser
from poi_extractor import POIExtractor
from slope_extractor import SlopeExtractor
from material_extractor import MaterialExtractor
from cache_manager import CacheManager

def setup_logging(gpx_path):
    gpx_stem = Path(gpx_path).stem
    log_dir = Path("./logs")
    log_dir.mkdir(exist_ok=True)
    
    log_file = log_dir / f"{gpx_stem}.log"
    
    logging.basicConfig(
        level=logging.DEBUG,
        format='%(asctime)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler(log_file),  # Log to file
            logging.StreamHandler()         # Log to console
        ]
    )
    logging.debug(f"Logging setup complete. Logs will be stored in ./logs/{gpx_stem}.log")

def main():
    config_path = 'config.yaml'
    gpx_path = "gpx_files/sr_du_desert-12783279-1715761221-507.gpx"

    setup_logging(gpx_path)

    try:
        # Step 1: Parse GPX and Config
        gpx_parser = GPXParser(gpx_path)
        config_parser = ConfigParser(config_path)

        input_df = gpx_parser.parse_gpx()
        config = config_parser.parse_config()

        # Step 2: Extract POIs
        cache_manager = CacheManager(config_path, gpx_path)
        poi_extractor = POIExtractor(input_df, config, cache_manager)
        pois = poi_extractor.extract_pois()

        # # Step 3: Extract Slopes
        # slope_extractor = SlopeExtractor(input_df)
        # input_df = slope_extractor.calculate_slopes()

        # # Step 4: Extract Material
        # material_extractor = MaterialExtractor(input_df, config)
        # input_df = material_extractor.classify_materials()

        # Further processing like plotting or analysis can be added here
        logging.info("Pipeline executed successfully.")
        
    except Exception as e:
        logging.error(f"An error occurred: {e}", exc_info=True)

if __name__ == "__main__":
    main()