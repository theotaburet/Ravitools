import json
import time
import overpy
from urllib.error import HTTPError
from urllib.request import urlopen
from tqdm import tqdm
from typing import Union, List

class QueryResult:
    def __init__(self, raw_data: bytes):
        self.raw_data = raw_data
    
    def save(self, output_file: str):
        """Save the raw JSON data to a file."""
        with open(output_file, 'wb') as f:
            f.write(self.raw_data)

class OverpassExtended(overpy.Overpass):
    
    def query_to_json(self, query: Union[bytes, str]) -> QueryResult:
        """
        Query the Overpass API and return a QueryResult object containing the raw JSON response.

        :param query: The query string in Overpass QL
        :return: A QueryResult object containing the raw JSON response
        """
        response = self._make_raw_request(query)  # Make the raw request and get the response
        return QueryResult(response)
    
    def _make_raw_request(self, query: Union[bytes, str]) -> bytes:
        """
        Make a raw request to the Overpass API and return the response bytes.

        :param query: The query string in Overpass QL
        :return: The raw response from the Overpass API
        """
        if not isinstance(query, bytes):
            query = query.encode("utf-8")

        retry_num: int = 0
        retry_exceptions: List[Exception] = []
        do_retry: bool = True if self.max_retry_count > 0 else False

        while retry_num <= self.max_retry_count:
            if retry_num > 0:
                time.sleep(self.retry_timeout)
            retry_num += 1
            try:
                f = urlopen(self.url, query)
            except HTTPError as e:
                f = e

            response = b""
            content_length = f.getheader('Content-Length')
            total_size = int(content_length) if content_length else None

            # Initialize the tqdm progress bar
            with tqdm(total=total_size, unit='B', unit_scale=True, desc="Downloading") as pbar:
                while True:
                    data = f.read(self.read_chunk_size)
                    if len(data) == 0:
                        break
                    response += data
                    pbar.update(len(data))
            f.close()

            if f.code == 200:
                return response  # Return the raw response bytes if successful
            
            # Handle various HTTP errors and retry if needed
            if f.code == 400:
                current_exception = self._handle_400_error(response, query)
                if not do_retry:
                    raise current_exception
                retry_exceptions.append(current_exception)
                continue

            if f.code == 429:
                current_exception = exception.OverpassTooManyRequests()
                if not do_retry:
                    raise current_exception
                retry_exceptions.append(current_exception)
                continue

            if f.code == 504:
                current_exception = exception.OverpassGatewayTimeout()
                if not do_retry:
                    raise current_exception
                retry_exceptions.append(current_exception)
                continue

            current_exception = exception.OverpassUnknownHTTPStatusCode(f.code)
            if not do_retry:
                raise current_exception
            retry_exceptions.append(current_exception)
            continue

        raise exception.MaxRetriesReached(retry_count=retry_num, exceptions=retry_exceptions)
    
    def _handle_400_error(self, response: bytes, query: Union[bytes, str]) -> Exception:
        """
        Handle HTTP 400 error by extracting and returning the appropriate exception.

        :param response: The raw response from the server
        :param query: The original query that caused the error
        :return: The appropriate exception based on the error message
        """
        msgs: List[str] = []
        for msg_raw in self._regex_extract_error_msg.finditer(response):
            msg_clean_bytes = self._regex_remove_tag.sub(b"", msg_raw.group("msg"))
            try:
                msg = msg_clean_bytes.decode("utf-8")
            except UnicodeDecodeError:
                msg = repr(msg_clean_bytes)
            msgs.append(msg)

        return exception.OverpassBadRequest(query, msgs=msgs)
