import yaml
import pandas as pd
import logging
from gpxpy import parse

class GPXParser:
    def __init__(self, gpx_path):
        self.gpx_path = gpx_path

    def parse_gpx(self):
        with open(self.gpx_path) as f:
            p = parse(f)
            points = [(point.latitude, point.longitude, point.elevation) for route in p.routes for point in route.points] + \
                     [(point.latitude, point.longitude, point.elevation) for track in p.tracks for segment in track.segments for point in segment.points]
        logging.debug(f"Parsed {len(points)} points from GPX file.")
        return pd.DataFrame(points, columns=["latitude", "longitude", "elevation"])

class ConfigParser:
    def __init__(self, config_path):
        self.config_path = config_path

    def parse_config(self):
        logging.debug(f"Loading configuration from {self.config_path}")
        with open(self.config_path, 'r') as file:
            config = yaml.safe_load(file)
        return config
