import asyncio
import uuid
import os
import logging
from typing import Dict
from video_processor import process_video
from models import Job

# Configure logging
logger = logging.getLogger(__name__)

# The global queue for video processing tasks
job_queue = asyncio.Queue()

# Store job info and status. Format: {job_id: Job}
jobs_db: Dict[str, Job] = {}

MAX_WORKERS = 4

async def worker(worker_id: int):
    logger.info(f"Worker {worker_id} started.")
    while True:
        job: Job = await job_queue.get()
        job_id = job.job_id
        try:
            job.status = 'processing'
            logger.info(f"Worker {worker_id} picked up job {job_id}")

            # Process video
            await process_video(job)

            job.status = 'completed'
            logger.info(f"Worker {worker_id} completed job {job_id}")

        except Exception as e:
            logger.exception(f"Worker {worker_id} failed on job {job_id}")
            job.status = 'failed'
            job.error = str(e)
        finally:
            # Mark the queue task as done
            job_queue.task_done()

            # Optionally, clean up the input file if processing is done
            if os.path.exists(job.input_file):
                try:
                    os.remove(job.input_file)
                except Exception:
                    logger.exception(f"Failed to delete input file {job.input_file}")

async def start_workers():
    workers = []
    for i in range(MAX_WORKERS):
        task = asyncio.create_task(worker(i))
        workers.append(task)
    return workers

