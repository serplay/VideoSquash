import os
import asyncio
import json

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

async def process_video(
    input_file: str, 
    output_file: str, 
    target_size_mb: float, 
    mute: bool = False, 
    crop: str = None,
    start_time: float = 0.0,
    end_time: float = 0.0,
    job_info: dict = None
):
    """
    Compresses video to target size, optionally muting and cropping.
    `job_info` dict can be updated to track progress (e.g. status='processing').
    """
    input_size_bytes = os.path.getsize(input_file)
    input_size_mb = input_size_bytes / (1024 * 1024)
    
    if target_size_mb > input_size_mb:
        target_size_mb = input_size_mb
        
    target_size_bits = target_size_mb * 8388608
    
    total_duration = await get_video_duration(input_file)
    if end_time > 0 and end_time > start_time:
        duration = min(end_time - start_time, total_duration - start_time)
    else:
        duration = total_duration
        
    safe_total_bitrate = (target_size_bits / duration) * 0.95
    audio_bitrate_bps = 128000 if not mute else 0
    video_bitrate_bps = safe_total_bitrate - audio_bitrate_bps
    
    if video_bitrate_bps <= 0:
        raise Exception("Target size is too small to compress this video even at minimum quality.")
        
    video_bitrate_kbps = int(video_bitrate_bps / 1000)
    
    # Construct base ffmpeg video filter if cropping is needed
    # Crop expects something like 'crop=ih*16/9:ih' for 16:9, etc.
    vf_args = []
    if crop and crop != 'none':
        # E.g., crop could be '1:1', '16:9', '9:16'
        w, h = crop.split(':')
        vf_args = ['-vf', f'crop=ih*{w}/{h}:ih'] # basic center crop depending on orientation
        # Let's use standard ffmpeg crop syntax for center crop of given aspect ratio:
        # crop=iw:iw/ratio if wide, else...
        # A simpler way to force aspect ratio and crop is: 'crop=in_w:in_w/{crop_ratio}' but it depends on original aspect.
        # Actually, let's just use: f'crop=ih*({w}/{h}):ih' if w < h or similar.
        # Let's use a safe robust crop filter that maximizes the area for the target aspect ratio:
        # crop=ih*({w}/{h}):ih (if landscape to portrait) etc.
        # Better yet, FFmpeg has a way to crop exactly to aspect ratio while centering:
        # crop=iw:iw/(16/9) if iw/(16/9) <= ih, else ih*(16/9):ih
        # To avoid complex expressions, let's let FFmpeg evaluate it:
        # 'crop=iw:iw/(W/H)' ... wait, expression parsing in FFmpeg:
        ratio = f"({w}/{h})"
        vf_expr = f"crop=if(lt(a,{ratio}),iw,ih*{ratio}):if(lt(a,{ratio}),iw/{ratio},ih)"
        vf_args = ['-vf', vf_expr]
        
    # --- Pass 1 ---
    if job_info:
        job_info['status'] = 'pass_1'
        
    input_args = []
    if end_time > 0 and end_time > start_time:
        input_args.extend(['-ss', str(start_time), '-to', str(end_time)])
        
    pass1_cmd = ['ffmpeg', '-y'] + input_args + ['-i', input_file,
        '-c:v', 'libx264', '-b:v', f'{video_bitrate_kbps}k',
        '-pass', '1'
    ]
    if mute:
        pass1_cmd.append('-an')
    else:
        pass1_cmd.append('-an') # pass 1 doesn't need audio anyway
        
    pass1_cmd.extend(vf_args)
    pass1_cmd.extend(['-f', 'mp4', os.devnull])
    
    p1 = await asyncio.create_subprocess_exec(
        *pass1_cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    await p1.communicate()
    
    # --- Pass 2 ---
    if job_info:
        job_info['status'] = 'pass_2'
        
    pass2_cmd = ['ffmpeg', '-y'] + input_args + ['-i', input_file,
        '-c:v', 'libx264', '-b:v', f'{video_bitrate_kbps}k',
        '-pass', '2'
    ]
    if mute:
        pass2_cmd.append('-an')
    else:
        pass2_cmd.extend(['-c:a', 'aac', '-b:a', '128k'])
        
    pass2_cmd.extend(vf_args)
    pass2_cmd.append(output_file)
    
    p2 = await asyncio.create_subprocess_exec(
        *pass2_cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    await p2.communicate()
    
    # Cleanup log files
    for log in ['ffmpeg2pass-0.log', 'ffmpeg2pass-0.log.mbtree']:
        if os.path.exists(log):
            os.remove(log)
