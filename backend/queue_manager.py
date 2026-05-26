import asyncio
import uuid
import os
from video_processor import process_video

# The global queue for video processing tasks
job_queue = asyncio.Queue()

# Store job info and status. Format: {job_id: {'status': '...', 'progress': '...', 'output_file': '...', 'error': '...'}}
jobs_db = {}

MAX_WORKERS = 4

async def worker(worker_id: int):
    print(f"Worker {worker_id} started.")
    while True:
        try:
            job = await job_queue.get()
            job_id = job['job_id']
            jobs_db[job_id]['status'] = 'processing'
            print(f"Worker {worker_id} picked up job {job_id}")
            
            # Process video
            await process_video(
                input_file=job['input_file'],
                output_file=job['output_file'],
                target_size_mb=job['target_size_mb'],
                mute=job['mute'],
                crop=job['crop'],
                start_time=job['start_time'],
                end_time=job['end_time'],
                job_info=jobs_db[job_id]
            )
            
            jobs_db[job_id]['status'] = 'completed'
            print(f"Worker {worker_id} completed job {job_id}")
            
        except Exception as e:
            print(f"Worker {worker_id} failed on job {job_id}: {e}")
            if job_id in jobs_db:
                jobs_db[job_id]['status'] = 'failed'
                jobs_db[job_id]['error'] = str(e)
        finally:
            # Mark the queue task as done
            job_queue.task_done()
            
            # Optionally, clean up the input file if processing is done
            if 'job' in locals() and os.path.exists(job['input_file']):
                try:
                    os.remove(job['input_file'])
                except Exception as e:
                    print(f"Failed to delete input file {job['input_file']}: {e}")

async def start_workers():
    workers = []
    for i in range(MAX_WORKERS):
        task = asyncio.create_task(worker(i))
        workers.append(task)
    return workers
