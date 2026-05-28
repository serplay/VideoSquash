from pydantic import BaseModel, Field
from typing import Optional, Literal
from datetime import datetime
import uuid

class VideoOptions(BaseModel):
    target_size_mb: float
    mute: bool = False
    crop: str = "none"
    target_resolution: str = "original"
    start_time: float = 0.0
    end_time: float = 0.0

class Job(BaseModel):
    job_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    status: Literal['queued', 'processing', 'pass_1', 'pass_2', 'completed', 'failed'] = 'queued'
    input_file: str
    output_file: str
    options: VideoOptions
    error: Optional[str] = None
    created_at: float = Field(default_factory=lambda: datetime.now().timestamp())
    progress: float = 0.0
