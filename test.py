import yaml

# Load the YAML file
with open('config.yaml', 'r') as file:
    config = yaml.safe_load(file)

# Print the loaded configuration
print(config)

# Access specific paths
print(config['paths']['cache'])  # This should print 'data_0/cache'