# exceptions/custom_exceptions.py
from fastapi import HTTPException, status

class GPXProcessingError(HTTPException):
    """Custom exception for GPX processing errors."""
    def __init__(self, detail: str = "Error processing GPX file"):
        super().__init__(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, 
            detail=detail
        )

class FileNotFoundError(HTTPException):
    """Custom exception for file not found scenarios."""
    def __init__(self, file_path: str):
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND, 
            detail=f"File not found: {file_path}"
        )

class OverpassQueryError(HTTPException):
    """Custom exception for Overpass API query failures."""
    def __init__(self, detail: str = "Failed to query Overpass API"):
        super().__init__(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, 
            detail=detail
        )