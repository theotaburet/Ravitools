# app_frontend.py
import streamlit as st
import requests
from pathlib import Path
from config.settings import settings
import logging
import os

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Configuration
BASE_URL = os.getenv("API_BASE_URL", "http://127.0.0.1:8000")

class GPXConverterApp:
    def __init__(self):
        # Initialize session state
        self._init_session_state()
        
        # Set up page configuration
        st.set_page_config(
            page_title="GPX Converter and Visualizer", 
            page_icon=":world_map:", 
            layout="wide"
        )

    def _init_session_state(self):
        """Initialize or reset session state variables."""
        session_states = {
            "uploaded_files": {},
            "radius_settings": {},
            "visualized_map": None,
            "visualized_poi_map": None,
            "processed_files": [],
            "kmz_files": [],
            "poi_display_mode": "None",
            "error_messages": []
        }
        
        for key, default_value in session_states.items():
            if key not in st.session_state:
                st.session_state[key] = default_value

    def _handle_file_upload(self):
        """
        Handle GPX file uploads to the backend.
        """
        uploaded_files = st.session_state.uploaded_files_uploader

        if not uploaded_files:
            # Clear all session states if no files are uploaded
            st.session_state.uploaded_files.clear()
            st.session_state.radius_settings.clear()
            st.session_state.visualized_map = None
            st.session_state.processed_files.clear()
            st.session_state.kmz_files.clear()
            return

        # Remove files no longer in the uploader
        current_filenames = [f.name for f in uploaded_files]
        to_remove = [
            file_name for file_name in list(st.session_state.uploaded_files.keys())
            if file_name not in current_filenames
        ]
        
        for file_name in to_remove:
            st.session_state.uploaded_files.pop(file_name, None)
            st.session_state.radius_settings.pop(file_name, None)
            
            # Reset visualization if files are removed
            st.session_state.visualized_map = None
            st.session_state.processed_files = []
            st.session_state.kmz_files = []

        # Add new files
        for uploaded_file in uploaded_files:
            if uploaded_file.name not in st.session_state.uploaded_files:
                try:
                    response = requests.post(
                        f"{BASE_URL}/upload-gpx/",
                        files={"file": (uploaded_file.name, uploaded_file.getvalue())},
                    )
                    response.raise_for_status()
                    
                    file_path = response.json()["file_path"]
                    st.session_state.uploaded_files[uploaded_file.name] = file_path
                    st.session_state.radius_settings[uploaded_file.name] = 1000  # Default radius
                    st.success(f"Uploaded {uploaded_file.name} successfully!")
                except requests.RequestException as e:
                    st.error(f"Error uploading {uploaded_file.name}: {str(e)}")
                    logger.error(f"Upload error: {e}")

    def _create_radius_sliders(self):
        """Create radius sliders for each uploaded file."""
        if not st.session_state.uploaded_files:
            return

        st.subheader("Adjust Search Radius")
        for file_name in st.session_state.uploaded_files:
            st.session_state.radius_settings[file_name] = st.slider(
                f"Radius for {file_name}",
                min_value=500,
                max_value=5000,
                value=st.session_state.radius_settings.get(file_name, 1000),
                key=f"radius_{file_name}",
                help="Set the search radius for Points of Interest (POIs) around your GPX route"
            )

    def _process_gpx_files(self):
        """Process all uploaded GPX files with their respective radii."""
        if not st.session_state.uploaded_files:
            st.warning("No files to process. Upload GPX files first.")
            return

        st.session_state.processed_files = []
        st.session_state.kmz_files = []

        for file_name, file_path in st.session_state.uploaded_files.items():
            radius = st.session_state.radius_settings.get(file_name, 1000)
            
            try:
                with st.spinner(f"Processing {file_name}..."):
                    response = requests.post(
                        f"{BASE_URL}/process-gpx/",
                        json={"file_path": file_path, "radius": radius}
                    )
                    response.raise_for_status()
                    
                    result = response.json()
                    st.session_state.processed_files.append(file_name)
                    
                    # Generate KMZ with basename of GPX file
                    gpx_basename = Path(file_name).stem
                    kmz_filename = f"{gpx_basename}.kmz"
                    
                    if result.get('kmz_path'):
                        st.session_state.kmz_files.append(kmz_filename)
                    
                    st.success(f"Processed {file_name}! Found {result.get('pois_count', 0)} POIs.")
            
            except requests.RequestException as e:
                st.error(f"Error processing {file_name}: {str(e)}")
                logger.error(f"Processing error: {e}")

    def _create_download_section(self):
        """Create download links for processed KMZ files."""
        if not st.session_state.kmz_files:
            return

        st.subheader("Download KMZ Files")
        
        # Individual file downloads
        cols = st.columns(len(st.session_state.kmz_files))
        for i, kmz_file in enumerate(st.session_state.kmz_files):
            with cols[i]:
                st.download_button(
                    label=f"Download {kmz_file}",
                    data=requests.get(
                        f"{BASE_URL}/download-kmz/", 
                        params={"kmz_name": kmz_file}
                    ).content,
                    file_name=kmz_file,
                    mime="application/vnd.google-earth.kmz"
                )

        # Zip download
        st.download_button(
            label="Download All KMZ Files (ZIP)",
            data=requests.get(f"{BASE_URL}/download-kmz-zip/").content,
            file_name="all_kmz_files.zip",
            mime="application/zip"
        )

    def _visualize_uploaded_files(self):
        """Visualize all uploaded GPX files."""
        if not st.session_state.uploaded_files:
            st.warning("No files uploaded yet.")
            return

        try:
            file_paths = ",".join(st.session_state.uploaded_files.values())
            with st.spinner("Generating visualization..."):
                response = requests.get(f"{BASE_URL}/visualize-gpx/", params={"file_paths": file_paths})
                response.raise_for_status()
                
                st.session_state.visualized_map = response.text
                st.success("Visualization generated successfully!")
        except requests.RequestException as e:
            st.error(f"Visualization failed: {str(e)}")
            logger.error(f"Visualization error: {e}")

    def _visualize_pois(self):
        """Visualize POIs for processed files."""
        if not st.session_state.kmz_files:
            st.warning("No KMZ files available. Process GPX files first.")
            return

        try:
            # Construct full paths to KMZ files in the output directory
            kmz_paths = [
                str(Path(settings.OUTPUT_DIR) / kmz_file) 
                for kmz_file in st.session_state.kmz_files
            ]
            
            kmz_paths_str = ",".join(kmz_paths)
            
            with st.spinner("Generating POI visualization..."):
                response = requests.get(
                    f"{BASE_URL}/visualize-pois/", 
                    params={"file_paths": kmz_paths_str}
                )
                response.raise_for_status()
                
                st.session_state.visualized_poi_map = response.text
                st.success("POI visualization generated successfully!")
        
        except requests.RequestException as e:
            st.error(f"POI visualization failed: {str(e)}")
            logger.error(f"POI visualization error: {e}")

    def run(self):
        """Main application run method."""
        st.title("🗺️ GPX to KMZ Converter and Visualizer")
        
        # Sidebar for configuration
        st.sidebar.header("Application Settings")
        st.sidebar.info("Upload GPX files, set search radii, and generate KMZ files.")
        
        # File upload section
        uploaded_files = st.file_uploader(
            "Upload GPX Files", 
            type=["gpx"], 
            accept_multiple_files=True,
            key="uploaded_files_uploader"
        )
        
        # Trigger file upload handling
        if uploaded_files:
            # Initialize uploaded files in session state if not already present
            if "uploaded_files" not in st.session_state:
                st.session_state.uploaded_files = {}
            if "radius_settings" not in st.session_state:
                st.session_state.radius_settings = {}
            
            # Remove files no longer in the uploader
            current_filenames = [f.name for f in uploaded_files]
            to_remove = [
                file_name for file_name in list(st.session_state.uploaded_files.keys())
                if file_name not in current_filenames
            ]
            
            for file_name in to_remove:
                st.session_state.uploaded_files.pop(file_name, None)
                st.session_state.radius_settings.pop(file_name, None)
                
                # Reset visualization if files are removed
                st.session_state.visualized_map = None
                st.session_state.processed_files = []
                st.session_state.kmz_files = []

            # Add new files
            for uploaded_file in uploaded_files:
                if uploaded_file.name not in st.session_state.uploaded_files:
                    try:
                        response = requests.post(
                            f"{BASE_URL}/upload-gpx/",
                            files={"file": (uploaded_file.name, uploaded_file.getvalue())},
                        )
                        response.raise_for_status()
                        
                        file_path = response.json()["file_path"]
                        st.session_state.uploaded_files[uploaded_file.name] = file_path
                        st.session_state.radius_settings[uploaded_file.name] = 1000  # Default radius
                        st.success(f"Uploaded {uploaded_file.name} successfully!")
                    except requests.RequestException as e:
                        st.error(f"Error uploading {uploaded_file.name}: {str(e)}")
                        logger.error(f"Upload error: {e}")
        
        # Radius adjustment
        self._create_radius_sliders()
        
        # Visualization and processing columns
        col1, col2, col3 = st.columns(3)
        
        with col1:
            if st.button("Visualize GPX Routes"):
                self._visualize_uploaded_files()
        
        with col2:
            if st.button("Process Files and Find POIs"):
                self._process_gpx_files()
        
        with col3:
            if st.button("Visualize All POIs"):
                self._visualize_pois()
        
        # Display visualizations
        if st.session_state.visualized_map:
            st.components.v1.html(st.session_state.visualized_map, height=600)
        
        if st.session_state.visualized_poi_map:
            st.components.v1.html(st.session_state.visualized_poi_map, height=600)
        
        # Download section
        self._create_download_section()

# Run the application
def main():
    app = GPXConverterApp()
    app.run()

if __name__ == "__main__":
    main()