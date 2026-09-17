from fastapi import FastAPI

app = FastAPI(title="MediTrack OCR Service", docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
