# Ravitools

**Ravitools** is a tool designed for bikepacking enthusiasts and long-distance cyclists to simplify their adventures. It enriches GPX files with essential points of interest (POIs) such as water sources, restaurants, and campsites, all available offline to ensure a stress-free journey.

---

## Features

- **Automatic GPX enhancement**: Add relevant POIs directly to your routes.
- **Offline usage**: POIs are embedded into the final KMZ file, usable without an internet connection.
- **Customizable settings**: Adjust the types of POIs to include using a `.yaml` file (user-friendly interface coming soon).
- **Multi-software compatibility**: Export files compatible with Google Maps, Locus Map, and more.

---

## How It Works

1. **Upload a GPX trace** via the interface or API.
2. **Customize POIs** (types and proximity to the route) through a `.yaml` configuration file.
3. **Download the KMZ file** for offline use.

---

## Installation

Ravitools is currently in the prototype stage, but a stable version is coming soon. Follow these steps to test the project locally:

1. Clone the GitHub repository:
   ```bash
   git clone https://github.com/username/ravitools.git

## Project structure

Ravitools/
├── app/
│   ├── __init__.py
│   ├── main.py           # FastAPI application
│   ├── services.py       # Service layer
│   ├── dependencies.py   # FastAPI dependencies
│   ├── config.py         # OLD config
│   ├── data_processor.py # OLD processor
│   ├── gpx_smoother.py   # OLD smoother
│   ├── overpass_client.py# OLD client
│   └── utils.py          # OLD utils
├── config.yaml           # Configuration file
└── run.py               # Script to run the application