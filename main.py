# main.py
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
import os
from typing import Optional

import uvicorn
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware

from config.settings import settings
from schemas.gpx_schemas import (
    GPXUploadResponse, 
    ProcessGPXRequest, 
    ProcessGPXResponse,
    VisualizationRequest
)
from services.gpx_service import GPXService
from utils.overpass_client import Config
from utils.overpass_client import OverpassClient
from utils.data_processor import DataProcessor
from utils.map_generator import MapGenerator
from utils.gpx_smoother import GPXSmoother
import folium
import zipfile
import xml.etree.ElementTree as ET

# Configure logging
def configure_logging():
    logging.basicConfig(
        level=getattr(logging, settings.LOG_LEVEL),
        format=settings.LOG_FORMAT,
        handlers=[
            logging.StreamHandler(),
            RotatingFileHandler(
                "gpx_converter.log", 
                maxBytes=10*1024*1024,  # 10MB
                backupCount=5
            )
        ]
    )

# Dependency injection setup
def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    # Ensure directories exist
    Path(settings.UPLOAD_DIR).mkdir(exist_ok=True)
    Path(settings.OUTPUT_DIR).mkdir(exist_ok=True)
    
    # Configure logging
    configure_logging()
    logger = logging.getLogger(__name__)
    
    # Initialize dependencies
    config = Config("config/config.yaml")
    overpass_client = OverpassClient(config)
    data_processor = DataProcessor(config)
    map_generator = MapGenerator(config)
    
    # Create service
    gpx_service = GPXService(
        overpass_client, 
        data_processor, 
        map_generator
    )
    
    app = FastAPI(
        title="GPX Converter and Visualizer",
        description="Process and visualize GPX files with POI integration",
        version="1.0.0"
    )
    
    # Middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    # Routes
    @app.get("/visualize-gpx/")
    def visualize_gpx(file_paths: str):
        """
        Visualize multiple GPX files on a single map.
        """
        try:
            # Convert file paths string to list
            paths = [Path(fp) for fp in file_paths.split(",")]
            
            # Validate file existence
            for path in paths:
                if not path.exists():
                    raise HTTPException(status_code=404, detail=f"GPX file not found: {path}")
            
            # Initialize map generator
            config = Config("config.yaml")
            map_generator = MapGenerator(config)
            
            # Smooth GPX paths and get first point for map center
            smoothed_paths = []
            for path in paths:
                smoothing_result = GPXSmoother.smooth(str(path), point_spacing=1000)
                smoothed_paths.append(smoothing_result.smoothed_path)
            
            # Default center is the first point of the first route
            center = smoothed_paths[0][0] if smoothed_paths else (0, 0)
            
            # Generate the map
            map_obj = map_generator.create_map(
                feature_groups={},  # No feature groups for this initial visualization
                gpx_paths=paths,
                center=center
            )
            
            # Save map
            output_map_path = Path(settings.OUTPUT_DIR) / "gpx_visualization.html"
            map_obj.save(str(output_map_path))
            
            # Return map as HTML response
            return HTMLResponse(content=output_map_path.read_text())
        
        except Exception as e:
            logger.error(f"Visualization error: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/upload-gpx/", response_model=GPXUploadResponse)
    async def upload_gpx(file: UploadFile = File(...)):
        """
        Upload a GPX file and save it to the uploads directory.
        """
        try:
            # Ensure the uploads directory exists
            upload_dir = Path(settings.UPLOAD_DIR)
            upload_dir.mkdir(exist_ok=True)
            
            # Generate a unique filename to prevent overwriting
            file_path = upload_dir / f"{int(os.urandom(4).hex(), 16)}_{file.filename}"
            
            # Save the uploaded file
            with open(file_path, "wb") as buffer:
                buffer.write(await file.read())
            
            logger.info(f"File uploaded successfully: {file_path}")
            
            return {
                "message": "File uploaded successfully", 
                "file_path": str(file_path)
            }
        except Exception as e:
            logger.error(f"Upload error: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @app.get("/visualize-pois/")
    def visualize_pois(file_paths: str):
        ...
            
    @app.post("/process-gpx/", response_model=ProcessGPXResponse)
    def process_gpx(request: ProcessGPXRequest):
        """
        Process a GPX file, find POIs, and generate map and KMZ.
        """
        try:
            # Use the GPX service to process the file
            result = gpx_service.process_gpx(
                file_path=request.file_path, 
                radius=request.radius
            )
            return result
        except Exception as e:
            logger.error(f"GPX processing error: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @app.get("/download-kmz/")
    def download_kmz(kmz_name: str):
        """
        Download a specific KMZ file.
        """
        kmz_file = Path(settings.OUTPUT_DIR) / kmz_name
        if not kmz_file.exists():
            raise HTTPException(status_code=404, detail="KMZ file not found")
        
        return FileResponse(
            kmz_file, 
            media_type="application/vnd.google-earth.kmz",
            filename=kmz_name
        )

    @app.get("/download-kmz-zip/")
    def download_kmz_zip():
        """
        Download all KMZ files as a single ZIP archive.
        """
        # Path for the zip file
        zip_path = Path(settings.OUTPUT_DIR) / "all_kmz_files.zip"
        
        # Create zip file
        with zipfile.ZipFile(zip_path, "w") as zipf:
            for kmz_file in Path(settings.OUTPUT_DIR).glob("*.kmz"):
                zipf.write(kmz_file, kmz_file.name)
        
        # Return zip file
        return FileResponse(
            zip_path, 
            media_type="application/zip", 
            filename="all_kmz_files.zip"
        )

    logger.info("Application configured successfully")
    return app

# Create the app instance
app = create_app()

# Run the application
if __name__ == "__main__":
    uvicorn.run(
        "main:app", 
        host="0.0.0.0", 
        port=8000, 
        reload=True
    )