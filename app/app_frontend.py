import streamlit as st
import requests
from streamlit_folium import folium_static

# Base URL of the FastAPI backend
BASE_URL = "http://127.0.0.1:8000"

st.title("GPX Amenity Mapper")

# Step 1: State Management
if "file_path" not in st.session_state:
    st.session_state.file_path = None
if "processed" not in st.session_state:
    st.session_state.processed = False

# Step 2: Upload GPX File
uploaded_file = st.file_uploader("Upload a GPX file", type=["gpx"])

if uploaded_file:
    with st.spinner("Uploading file..."):
        response = requests.post(
            f"{BASE_URL}/upload-gpx/",
            files={"file": (uploaded_file.name, uploaded_file.getvalue())}
        )
    
    if response.status_code == 200:
        st.session_state.file_path = response.json()["file_path"]
        st.success("File uploaded successfully!")

        # Checkbox to visualize the raw uploaded GPX file
        visualize_gpx = st.checkbox("Visualize uploaded GPX file", key="visualize_gpx")
        if visualize_gpx:
            with st.spinner("Generating visualization for GPX file..."):
                gpx_visualization_response = requests.get(
                    f"{BASE_URL}/visualize-gpx/",
                    params={"file_path": st.session_state.file_path}
                )
                if gpx_visualization_response.status_code == 200:
                    st.write("Visualization of GPX Path:")
                    st.components.v1.html(gpx_visualization_response.text, height=600)
                else:
                    st.error("Failed to generate GPX visualization.")

# Step 3: Process GPX File
if st.session_state.file_path:
    radius = st.slider(
        "Select radius for querying amenities (in meters)", min_value=500, max_value=5000, value=1000
    )

    if st.button("Process GPX"):
        with st.spinner("Processing GPX file and querying POIs..."):
            process_response = requests.post(
                f"{BASE_URL}/process-gpx/",
                json={"file_path": st.session_state.file_path, "radius": radius}
            )

        if process_response.status_code == 200:
            st.session_state.processed = True
            process_result = process_response.json()
            st.success(f"Processing complete! Found {process_result['pois_count']} POIs.")

# Step 4: Display Download Links (Independent of Visualization)
if st.session_state.processed:
    st.markdown(
        f"[Download Map (HTML)](http://127.0.0.1:8000/download-map/)", unsafe_allow_html=True
    )
    st.markdown(
        f"[Download KMZ](http://127.0.0.1:8000/download-kmz/)", unsafe_allow_html=True
    )

# Step 5: Visualize POIs
if st.session_state.processed:
    visualize_pois = st.checkbox("Visualize GPX with Points of Interest", key="visualize_pois")
    if visualize_pois:
        with st.spinner("Loading visualization for GPX and POIs..."):
            poi_visualization_response = requests.get(
                f"{BASE_URL}/visualize-pois/",
                params={"file_path": st.session_state.file_path}
            )
            if poi_visualization_response.status_code == 200:
                st.write("Visualization of GPX Path with POIs:")
                st.components.v1.html(poi_visualization_response.text, height=600)
            else:
                st.error("Failed to load POI visualization.")
