from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse, FileResponse, HTMLResponse
from pathlib import Path
import os
import folium
from Ravitools.gpx_smoother import GPXSmoother
from Ravitools.overpass_client import OverpassClient
from Ravitools.data_processor import DataProcessor
from Ravitools.map_generator import MapGenerator
from Ravitools.config import Config
from pydantic import BaseModel, validator, Field
from typing import Any

class ProcessGPXRequest(BaseModel):
    file_path: str = Field(..., description="Path to the GPX file to be processed.")
    radius: float = Field(..., gt=0, description="Search radius in meters (must be greater than 0).")

    @validator("file_path")
    def validate_file_path(cls, value: str) -> str:
        """Validate that the file_path exists and points to a GPX file."""
        path = Path(value)
        if not path.exists():
            raise ValueError("The file does not exist.")
        if not path.is_file():
            raise ValueError("The provided path is not a file.")
        if not path.suffix.lower() == ".gpx":
            raise ValueError("The file must have a .gpx extension.")
        return value

    @validator("radius")
    def validate_radius(cls, value: float) -> float:
        """Validate that the radius is a reasonable value."""
        if value > 5000:  # Example: limit the radius to 5 km
            raise ValueError("Radius must not exceed 5,000 meters.")
        return value

app = FastAPI()

# Configuration setup
config = Config("config/config.yaml")
overpass_client = OverpassClient(config)
data_processor = DataProcessor(config)
map_generator = MapGenerator(config)

# Temporary storage for uploaded files
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

from fastapi.responses import HTMLResponse

@app.get("/visualize-gpx/", response_class=HTMLResponse)
def visualize_gpx(file_path: str):
    """
    Visualize the raw GPX path using the create_map function from MapGenerator.
    """
    try:
        file_path = Path(file_path)
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="GPX file not found")

        # Smooth the GPX file
        smoothing_result = GPXSmoother.smooth(str(file_path), point_spacing=500.0)

        # Generate the map using MapGenerator
        map_obj = map_generator.create_map(
            feature_groups={},  # No feature groups for this map
            gpx_paths=[file_path],
            center=(smoothing_result.smoothed_path[0][0], smoothing_result.smoothed_path[0][1]),
        )

        # Save the map to an HTML file
        output_map_path = "gpx_visualization.html"
        map_obj.save(output_map_path)

        # Return the HTML file content
        with open(output_map_path, "r") as f:
            return HTMLResponse(content=f.read())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating GPX visualization: {str(e)}")

# Temporary in-memory cache
processed_results_cache = {}

@app.post("/process-gpx/")
def process_gpx(request: ProcessGPXRequest):
    """
    Process the uploaded GPX file:
    - Smooth the GPX path.
    - Query Overpass API for amenities.
    - Generate a map with features and export it.
    """
    try:
        file_path = Path(request.file_path)
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="GPX file not found")

        # Smooth the GPX file
        radius = request.radius
        smoothing_result = GPXSmoother.smooth(str(file_path), point_spacing=radius * 0.5)

        # Query Overpass API
        query_result = overpass_client.query_amenities(smoothing_result.smoothed_path, radius)

        # Process amenities into POIs and feature groups
        pois, feature_groups = data_processor.process_amenities(query_result)

        # Cache results for reuse in visualization
        processed_results_cache[str(file_path)] = {
            "pois": pois,
            "feature_groups": feature_groups
        }

        # Generate the map
        map_obj = map_generator.create_map(feature_groups=feature_groups, gpx_paths=[file_path])
        output_map_path = "output_map.html"
        map_generator.save_map(output_map_path)

        # Export to KMZ
        output_kmz_path = "output_map.kmz"
        map_generator.export_to_kml(
            feature_groups=feature_groups,
            gpx_paths=[file_path],
            output_path=output_kmz_path
        )

        # Return the results
        return {
            "message": "GPX processed successfully",
            "map_path": output_map_path,
            "kmz_path": output_kmz_path,
            "pois_count": len(pois.pois),
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing GPX: {str(e)}")


@app.get("/visualize-pois/")
def visualize_pois(file_path: str):
    """
    Serve the pre-generated map (output_map.html) created during process_gpx.
    """
    try:
        # Verify if the GPX file was processed
        file_path = Path(file_path)
        if str(file_path) not in processed_results_cache:
            raise HTTPException(status_code=404, detail="Processed results not found. Please run 'process-gpx' first.")

        # Serve the pre-generated output_map.html
        output_map_path = "output_map.html"
        if not Path(output_map_path).exists():
            raise HTTPException(status_code=404, detail="Map file not found. Please reprocess the GPX file.")

        return FileResponse(output_map_path, media_type="text/html")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error serving POI visualization: {str(e)}")
        
@app.post("/upload-gpx/")
async def upload_gpx(file: UploadFile = File(...)):
    """Upload a GPX file and save it locally."""
    try:
        file_path = UPLOAD_DIR / file.filename
        with open(file_path, "wb") as f:
            f.write(await file.read())
        return {"message": "File uploaded successfully", "file_path": str(file_path)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error uploading file: {str(e)}")

@app.get("/download-map/")
def download_map():
    """Download the generated map as an HTML file."""
    map_file = "output_map.html"
    if not Path(map_file).exists():
        raise HTTPException(status_code=404, detail="Map file not found")
    return FileResponse(map_file)


@app.get("/download-kmz/")
def download_kmz():
    """Download the generated KMZ file."""
    kmz_file = "output_map.kmz"
    if not Path(kmz_file).exists():
        raise HTTPException(status_code=404, detail="KMZ file not found")
    return FileResponse(kmz_file)
