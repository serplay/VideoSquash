import os
import uuid
import asyncio
import time
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request, BackgroundTasks
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from queue_manager import job_queue, jobs_db, start_workers

limiter = Limiter(key_func=get_remote_address)
app = FastAPI()
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

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
MAX_UPLOAD_SIZE = 1024 * 1024 * 1024  # 1 GB

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(PROCESSED_DIR, exist_ok=True)

# Startup event to start queue workers and cleanup task
@app.on_event("startup")
async def startup_event():
    app.state.workers = await start_workers()
    asyncio.create_task(cleanup_old_files())

async def cleanup_old_files():
    """Background task to clean up processed files older than 1 hour."""
    while True:
        now = time.time()
        for filename in os.listdir(PROCESSED_DIR):
            file_path = os.path.join(PROCESSED_DIR, filename)
            if os.path.isfile(file_path):
                if os.stat(file_path).st_mtime < now - 3600:
                    try:
                        os.remove(file_path)
                    except Exception as e:
                        print(f"Failed to delete {file_path}: {e}")
        await asyncio.sleep(600) # Check every 10 minutes

@app.post("/upload")
@limiter.limit("5/minute")
async def upload_video(
    request: Request,
    video: UploadFile = File(...),
    target_size_mb: float = Form(...),
    mute: bool = Form(False),
    crop: str = Form("none"),
    start_time: float = Form(0.0),
    end_time: float = Form(0.0)
):
    job_id = str(uuid.uuid4())
    input_filename = f"{job_id}_{video.filename}"
    input_filepath = os.path.join(UPLOAD_DIR, input_filename)
    
    # Read and enforce size limit
    size_read = 0
    try:
        with open(input_filepath, "wb") as f:
            while chunk := await video.read(8192):
                size_read += len(chunk)
                if size_read > MAX_UPLOAD_SIZE:
                    raise HTTPException(status_code=413, detail="File too large. Maximum size is 1GB.")
                f.write(chunk)
    except HTTPException:
        # cleanup partial file
        if os.path.exists(input_filepath):
            os.remove(input_filepath)
        raise
    except Exception as e:
        if os.path.exists(input_filepath):
            os.remove(input_filepath)
        raise HTTPException(status_code=500, detail=str(e))
        
    output_filepath = os.path.join(PROCESSED_DIR, f"{job_id}_output.mp4")
    
    jobs_db[job_id] = {
        "status": "queued",
        "output_file": output_filepath,
        "input_file": input_filepath,
        "target_size_mb": target_size_mb,
        "mute": mute,
        "crop": crop,
        "start_time": start_time,
        "end_time": end_time
    }
    
    await job_queue.put({
        "job_id": job_id,
        "input_file": input_filepath,
        "output_file": output_filepath,
        "target_size_mb": target_size_mb,
        "mute": mute,
        "crop": crop,
        "start_time": start_time,
        "end_time": end_time
    })
    
    return {"job_id": job_id, "status": "queued"}

@app.get("/status/{job_id}")
@limiter.limit("30/minute")
async def get_status(request: Request, job_id: str):
    if job_id not in jobs_db:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"job_id": job_id, "status": jobs_db[job_id]["status"], "error": jobs_db[job_id].get("error")}

@app.get("/download/{job_id}")
@limiter.limit("5/minute")
async def download_video(request: Request, job_id: str):
    if job_id not in jobs_db:
        raise HTTPException(status_code=404, detail="Job not found")
        
    job = jobs_db[job_id]
    if job["status"] != "completed":
        raise HTTPException(status_code=400, detail="Job not completed yet")
        
    if not os.path.exists(job["output_file"]):
        raise HTTPException(status_code=404, detail="Processed file not found")
        
    return FileResponse(
        path=job["output_file"],
        filename=f"squashed_{job_id[:8]}.mp4",
        media_type="video/mp4"
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
