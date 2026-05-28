import os
import asyncio
import json
import logging

# Configure logging
logger = logging.getLogger(__name__)

# Constants
BITS_PER_MB = 8 * 1024 * 1024
BITRATE_SAFETY_FACTOR = 0.95
DEFAULT_AUDIO_BITRATE_BPS = 128000

from models import Job, VideoOptions

async def get_video_duration(input_file: str) -> float:
    """Uses ffprobe to extract the exact duration of the video in seconds."""
    cmd = [
        'ffprobe', '-v', 'error', '-show_entries',
        'format=duration', '-of',
        'default=noprint_wrappers=1:nokey=1', input_file
    ]
    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    stdout, stderr = await process.communicate()
    
    if process.returncode != 0:
        raise Exception(f"ffprobe error: {stderr.decode()}")
    return float(stdout.decode().strip())

async def get_video_resolution(input_file: str) -> tuple[int, int]:
    """Uses ffprobe to extract the width and height of the video."""
    cmd = [
        'ffprobe', '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height', '-of',
        'json', input_file
    ]
    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    stdout, stderr = await process.communicate()
    
    if process.returncode != 0:
        raise Exception(f"ffprobe error: {stderr.decode()}")
    
    data = json.loads(stdout.decode())
    streams = data.get('streams', [])
    if not streams:
        raise Exception("No video streams found in the input file.")
    
    return int(streams[0].get('width', 0)), int(streams[0].get('height', 0))

def _calculate_bitrate(input_file: str, duration: float, target_size_mb: float, mute: bool) -> int:
    """Internal helper to calculate the target video bitrate in kbps."""
    input_size_bytes = os.path.getsize(input_file)
    input_size_mb = input_size_bytes / (1024 * 1024)
    
    effective_target_mb = min(target_size_mb, input_size_mb)
    target_size_bits = effective_target_mb * BITS_PER_MB
    
    safe_total_bitrate = (target_size_bits / duration) * BITRATE_SAFETY_FACTOR
    audio_bitrate_bps = 0 if mute else DEFAULT_AUDIO_BITRATE_BPS
    video_bitrate_bps = safe_total_bitrate - audio_bitrate_bps
    
    if video_bitrate_bps <= 0:
        raise Exception("Target size is too small to compress this video even at minimum quality.")
        
    return int(video_bitrate_bps / 1000)

async def _build_video_filters(input_file: str, options: VideoOptions) -> list:
    """Internal helper to construct the ffmpeg video filters."""
    vf_filters = []
    if options.crop and options.crop != 'none':
        try:
            w, h = options.crop.split(':')
            ratio = f"({w}/{h})"
            vf_filters.append(f"crop=if(lt(a,{ratio}),iw,ih*{ratio}):if(lt(a,{ratio}),iw/{ratio},ih)")
        except ValueError:
            logger.error(f"Invalid crop format: {options.crop}")
        
    if options.target_resolution and options.target_resolution != 'original':
        try:
            target_h = int(options.target_resolution)
            _, input_h = await get_video_resolution(input_file)
            if target_h < input_h:
                vf_filters.append(f"scale=-2:{target_h}")
        except Exception:
            logger.exception("Failed to check resolution or scale")
            
    return ['-vf', ','.join(vf_filters)] if vf_filters else []

async def _run_ffmpeg_pass(cmd: list, pass_num: int):
    """Internal helper to execute an ffmpeg pass."""
    logger.info(f"Starting ffmpeg pass {pass_num}")
    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    stdout, stderr = await process.communicate()
    if process.returncode != 0:
        logger.error(f"ffmpeg pass {pass_num} failed: {stderr.decode()}")
        raise Exception(f"ffmpeg pass {pass_num} error")

async def process_video(job: Job):
    """
    Compresses video to target size, optionally muting, cropping, and scaling resolution.
    Uses information from the provided Job object and updates its status.
    """
    input_file = job.input_file
    output_file = job.output_file
    options = job.options
    job_id = job.job_id
    
    pass_log_prefix = os.path.join(os.path.dirname(output_file), f"ffmpeg2pass_{job_id}")

    total_duration = await get_video_duration(input_file)
    if options.end_time > 0 and options.end_time > options.start_time:
        duration = min(options.end_time - options.start_time, total_duration - options.start_time)
    else:
        duration = total_duration

    video_bitrate_kbps = _calculate_bitrate(input_file, duration, options.target_size_mb, options.mute)
    vf_args = await _build_video_filters(input_file, options)
    
    input_args = []
    if options.end_time > 0 and options.end_time > options.start_time:
        input_args.extend(['-ss', str(options.start_time), '-to', str(options.end_time)])

    # Determine encoder and profile options
    use_nvenc = os.getenv("USE_NVENC", "true").lower() == "true"
    video_codec = "h264_nvenc" if use_nvenc else "libx264"
    logger.info(f"Attempting to use video codec: {video_codec} (USE_NVENC={use_nvenc})")

    # Extra parameters for maximum compatibility
    compatibility_args = ['-pix_fmt', 'yuv420p', '-profile:v', 'high']
        
    # --- Pass 1 ---
    job.status = 'pass_1'
        
    pass1_cmd = ['ffmpeg', '-y'] + input_args + ['-i', input_file,
        '-c:v', video_codec, '-b:v', f'{video_bitrate_kbps}k',
        '-pass', '1', '-passlogfile', pass_log_prefix, '-an'
    ] + compatibility_args + vf_args + ['-f', 'mp4', os.devnull]
    
    try:
        await _run_ffmpeg_pass(pass1_cmd, 1)
    except Exception as e:
        if use_nvenc and video_codec == "h264_nvenc":
            logger.warning("ffmpeg pass 1 failed with h264_nvenc. Falling back to CPU (libx264)...")
            video_codec = "libx264"
            pass1_cmd = ['ffmpeg', '-y'] + input_args + ['-i', input_file,
                '-c:v', video_codec, '-b:v', f'{video_bitrate_kbps}k',
                '-pass', '1', '-passlogfile', pass_log_prefix, '-an'
            ] + compatibility_args + vf_args + ['-f', 'mp4', os.devnull]
            await _run_ffmpeg_pass(pass1_cmd, 1)
        else:
            raise
    
    # --- Pass 2 ---
    job.status = 'pass_2'
        
    pass2_cmd = ['ffmpeg', '-y'] + input_args + ['-i', input_file,
        '-c:v', video_codec, '-b:v', f'{video_bitrate_kbps}k',
        '-pass', '2', '-passlogfile', pass_log_prefix
    ] + compatibility_args
    if options.mute:
        pass2_cmd.append('-an')
    else:
        pass2_cmd.extend(['-c:a', 'aac', '-b:a', '128k'])
        
    pass2_cmd.extend(vf_args)
    pass2_cmd.append(output_file)
    
    await _run_ffmpeg_pass(pass2_cmd, 2)
    
    # Cleanup log files
    for suffix in ['-0.log', '-0.log.mbtree']:
        log_file = f"{pass_log_prefix}{suffix}"
        if os.path.exists(log_file):
            os.remove(log_file)



