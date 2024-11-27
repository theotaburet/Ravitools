# config/settings.py
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    """Application configuration settings."""
    
    # Directories
    UPLOAD_DIR: str = "uploads"
    OUTPUT_DIR: str = "outputs"
    
    # Overpass API settings
    OVERPASS_ENDPOINT: str = "https://overpass-api.de/api/interpreter"
    QUERY_TIMEOUT: int = 180  # seconds
    
    # Processing configurations
    DEFAULT_RADIUS: float = 1000.0
    DEFAULT_POINT_SPACING: float = 500.0
    
    # Logging configuration
    LOG_LEVEL: str = "INFO"
    LOG_FORMAT: str = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    
    # Optional: Load from .env file
    model_config = SettingsConfigDict(
        env_file=".env", 
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()