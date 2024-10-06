import logging
import pandas as pd

class SlopeExtractor:
    def __init__(self, input_df):
        self.input_df = input_df

    def calculate_slopes(self):
        self.input_df['slope'] = self.input_df['elevation'].diff() / self.input_df[['latitude', 'longitude']].apply(lambda row: self._haversine(row[0], row[1]), axis=1).diff()
        self.input_df['slope'] = self.input_df['slope'].fillna(0)
        logging.debug("Slopes calculated.")
        return self.input_df

    @staticmethod
    def _haversine(lat, lon):
        # Haversine formula to calculate distance between two points on Earth
        R = 6371  # Earth radius in kilometers
        dlat = pd.np.radians(lat.diff())
        dlon = pd.np.radians(lon.diff())
        a = pd.np.sin(dlat/2)**2 + pd.np.cos(pd.np.radians(lat.shift())) * pd.np.cos(pd.np.radians(lat)) * pd.np.sin(dlon/2)**2
        c = 2 * pd.np.arcsin(pd.np.sqrt(a))
        return R * c * 1000  # Return in meters
