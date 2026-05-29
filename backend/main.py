import os
import uuid
import asyncio
import time
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request, BackgroundTasks, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from queue_manager import job_queue, jobs_db, start_workers
from models import Job, VideoOptions

# Configure logging centrally with level from environment
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=getattr(logging, LOG_LEVEL, logging.INFO), format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("videosquash")

# FastAPI will still log via uvicorn; ensure uvicorn picks up our level
uvicorn_log_level = LOG_LEVEL.lower() if 'uvicorn_log_level' not in globals() else globals()['uvicorn_log_level']

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Start queue workers and cleanup task
    app.state.workers = await start_workers()
    cleanup_task = asyncio.create_task(cleanup_old_files())
    logger.info("Application started: workers and cleanup task initialized.")
    yield
    # Shutdown: Clean up resources if needed
    cleanup_task.cancel()
    try:
        await cleanup_task
    except asyncio.CancelledError:
        pass
    logger.info("Application shutdown: cleanup task cancelled.")

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

from fastapi.exceptions import RequestValidationError
from fastapi.responses import PlainTextResponse


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.warning(f"Validation error for request {request.url}: {exc}")
    return JSONResponse(status_code=422, content={"detail": exc.errors()})


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    # Log the full exception server-side, but return a safe message to clients
    logger.exception(f"Unhandled exception for request {request.url}: {exc}")
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # For development, we allow all
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "uploads"
PROCESSED_DIR = "processed"
# File size limits and intervals
GB = 1024 * 1024 * 1024
MAX_UPLOAD_SIZE = 2.5 * GB
CLEANUP_INTERVAL_SEC = 600
FILE_EXPIRY_SEC = 3600

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(PROCESSED_DIR, exist_ok=True)

async def cleanup_old_files() -> None:
    """Background task to clean up processed files and metadata older than 1 hour."""
    while True:
        try:
            now = time.time()
            # Clean up files and corresponding jobs_db entries
            for filename in os.listdir(PROCESSED_DIR):
                file_path = os.path.join(PROCESSED_DIR, filename)
                if os.path.isfile(file_path):
                    try:
                        file_stat = os.stat(file_path)
                        if file_stat.st_mtime < now - FILE_EXPIRY_SEC:
                            os.remove(file_path)
                            logger.info(f"Deleted expired file: {file_path}")
                            
                            # Prune from jobs_db if job_id matches filename
                            # Filename format: {job_id}.mp4
                            job_id = filename.split('.')[0]
                            if job_id in jobs_db:
                                del jobs_db[job_id]
                                logger.info(f"Pruned job {job_id} from jobs_db")
                    except Exception:
                        logger.exception(f"Failed to process/delete {file_path} during cleanup")
            
            # Also prune jobs_db entries that failed and are old
            to_prune = []
            for job_id, job in jobs_db.items():
                if job.status == 'failed' and job.created_at < now - FILE_EXPIRY_SEC:
                    to_prune.append(job_id)
            
            for job_id in to_prune:
                del jobs_db[job_id]
                logger.info(f"Pruned failed job {job_id} from jobs_db")
                
        except Exception:
            logger.exception("Error in cleanup_old_files loop")
            
        await asyncio.sleep(CLEANUP_INTERVAL_SEC)

@app.post("/upload")
@limiter.limit("5/minute")
async def upload_video(
    request: Request,
    video: UploadFile = File(...),
    target_size_mb: float = Form(...),
    mute: bool = Form(False),
    crop: str = Form("none"),
    start_time: float = Form(0.0),
    end_time: float = Form(0.0),
    target_resolution: str = Form("original")
) -> JSONResponse:
    # Validate file type
    if not video.content_type.startswith("video/"):
        raise HTTPException(status_code=400, detail="Invalid file type. Please upload a video.")

    job_id = str(uuid.uuid4())
    file_extension = video.filename.split(".")[-1]
    input_filename = f"{job_id}_input.{file_extension}"
    output_filename = f"{job_id}.mp4"
    
    input_path = os.path.join(UPLOAD_DIR, input_filename)
    output_path = os.path.join(PROCESSED_DIR, output_filename)

    try:
        # Save uploaded file
        size_read = 0
        with open(input_path, "wb") as f:
            while chunk := await video.read(1024 * 1024):
                size_read += len(chunk)
                if size_read > MAX_UPLOAD_SIZE:
                    raise HTTPException(status_code=413, detail="File too large. Maximum size is 2.5GB.")
                f.write(chunk)
                
        # Create job object
        options = VideoOptions(
            target_size_mb=target_size_mb,
            mute=mute,
            crop=crop,
            target_resolution=target_resolution,
            start_time=start_time,
            end_time=end_time
        )
        job = Job(
            job_id=job_id,
            input_file=input_path,
            output_file=output_path,
            options=options
        )
        
        jobs_db[job_id] = job
        await job_queue.put(job)
        
        return JSONResponse({"job_id": job_id})

    except HTTPException:
        # cleanup partial file
        if os.path.exists(input_path):
            os.remove(input_path)
        raise
    except Exception as e:
        if os.path.exists(input_path):
            os.remove(input_path)
        logger.exception("Upload failed")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/status/{job_id}")
@limiter.limit("30/minute")
async def get_status(request: Request, job_id: str) -> JSONResponse:
    if job_id not in jobs_db:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = jobs_db[job_id]
    return JSONResponse(job.model_dump())

@app.websocket("/ws/status/{job_id}")
async def websocket_status(websocket: WebSocket, job_id: str):
    await websocket.accept()
    if job_id not in jobs_db:
        await websocket.close(code=1008)  # Policy Violation / Not Found
        return
        
    job = jobs_db[job_id]
    last_status = None
    last_progress = None
    
    try:
        while True:
            # We check the memory db for status changes
            if job.status != last_status or job.progress != last_progress:
                last_status = job.status
                last_progress = job.progress
                await websocket.send_json(job.model_dump())
                
                # If job finished, we can close connection
                if job.status in ["completed", "failed"]:
                    break
            await asyncio.sleep(0.25)
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for job: {job_id}")
    except Exception as e:
        logger.exception(f"Error in WebSocket status stream for job {job_id}: {e}")
    finally:
        try:
            await websocket.close()
        except Exception:
            pass

@app.get("/download/{job_id}")
@limiter.limit("5/minute")
async def download_video(request: Request, job_id: str) -> FileResponse:
    if job_id not in jobs_db:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = jobs_db[job_id]
    if job.status != "completed":
        raise HTTPException(status_code=400, detail="Job not completed")
    
    if not os.path.exists(job.output_file):
        raise HTTPException(status_code=404, detail="Processed file not found")

    return FileResponse(
        job.output_file,
        filename=f"squashed_{job_id[:8]}.mp4",
        media_type="video/mp4"
    )

if __name__ == "__main__":
    import uvicorn
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host=host, port=port, reload=True, log_level=uvicorn_log_level)
