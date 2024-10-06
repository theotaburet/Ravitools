import yaml
import re

class YAMLParser:
    @staticmethod
    def parse_yaml_with_substitution(file_path: str) -> dict:
        """
        Parse a YAML file and substitute variables in the format ${var_name}.
        
        :param file_path: Path to the YAML file
        :return: Parsed YAML content with substitutions applied
        """
        def subst(match):
            var_name = match.group(1)
            keys = var_name.split('.')
            value = yaml_data
            for key in keys:
                value = value[key]
            return str(value)

        # Read and load the YAML content
        with open(file_path, 'r') as file:
            content = file.read()
        yaml_data = yaml.safe_load(content)

        # Apply substitutions
        pattern = re.compile(r'\$\{([^\}]+)\}')  # Pattern to find ${var_name}
        new_content = pattern.sub(subst, content)

        # Parse the final YAML content with substitutions
        parsed_yaml = yaml.safe_load(new_content)

        return parsed_yaml

# Example usage:
if __name__ == "__main__":
    parser = YAMLParser()
    parsed_yaml = parser.parse_yaml_with_substitution('example.yaml')
    
    print(parsed_yaml['queues']['mail-queue-name'])  # Output: mail-app-test
    print(parsed_yaml['queues']['mail-dlq-name'])    # Output: mail-app-test-dlq
