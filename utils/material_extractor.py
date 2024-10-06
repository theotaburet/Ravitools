import logging

class MaterialExtractor:
    def __init__(self, input_df, config):
        self.input_df = input_df
        self.surface_mapping = config.get('surface_mapping', {})

    def classify_materials(self):
        self.input_df['material'] = self.input_df['surface'].map(self.surface_mapping).fillna('unknown')
        logging.debug("Materials classified.")
        return self.input_df
