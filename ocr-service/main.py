"""Internal OCR endpoint. Run one worker: one model and one inference lane."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
import logging
import os
from pathlib import Path
import tempfile
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict
from PIL import Image

from paddle_engine import get_engine, run
from preprocessing import preprocess
from extraction import extract_prescription

load_dotenv(Path(__file__).with_name('.env'))
logger = logging.getLogger('uvicorn.error')
MAX_BYTES = 10 * 1024 * 1024


@asynccontextmanager
async def lifespan(app):
    # The same dedicated thread initializes and uses the shared Paddle model.
    app.state.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='paddle')
    app.state.pending = 0
    try:
        await asyncio.get_running_loop().run_in_executor(app.state.executor, get_engine)
        logger.info('PaddleOCR singleton loaded; ready for requests')
        yield
    finally:
        app.state.executor.shutdown(wait=True)


app = FastAPI(title='MediTrack OCR Service', lifespan=lifespan,
              docs_url=None, redoc_url=None, openapi_url=None)


class ExtractRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    imageUrl: str


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def extract_url(image_url):
    url = urlsplit(image_url)
    allowed = {value.strip().rstrip('/') for value in os.getenv(
        'OCR_IMAGE_ORIGINS', 'http://127.0.0.1:3000').split(',')}
    if (url.scheme not in ('http', 'https') or url.username or url.password
            or url.fragment or f'{url.scheme}://{url.netloc}' not in allowed):
        raise ValueError('Image storage origin is not allowed')
    with build_opener(NoRedirect).open(Request(image_url), timeout=30) as response:
        data = response.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError('Image exceeds 10 MB')
    with tempfile.TemporaryDirectory(prefix='meditrack-ocr-') as directory:
        path = Path(directory) / 'prescription'
        path.write_bytes(data)
        with Image.open(path) as image:
            if image.format not in ('JPEG', 'PNG') or not (100 <= image.width <= 6000
                    and 100 <= image.height <= 6000) or image.width * image.height > 20_000_000:
                raise ValueError('Use a JPEG or PNG, 100-6000 pixels per side, at most 20 megapixels')
            image.verify()
        pixels, _ = preprocess(path)
        result = run(pixels)
    fields = extract_prescription(result.raw_text)
    return {**fields, 'ocrRawText': result.raw_text,
            'ocrConfidenceScore': result.mean_confidence}


@app.get('/health')
async def health():
    return {'status': 'ok', 'engine': 'paddleocr'}


@app.post('/extract')
async def extract(body: ExtractRequest):
    if app.state.pending >= 8:
        raise HTTPException(503, 'OCR queue is full; try again later')
    app.state.pending += 1
    try:
        return await asyncio.get_running_loop().run_in_executor(
            app.state.executor, extract_url, body.imageUrl)
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    except Exception as error:
        logger.error('OCR failed: %s', type(error).__name__)
        raise HTTPException(502, 'Unable to extract this image') from None
    finally:
        app.state.pending -= 1
