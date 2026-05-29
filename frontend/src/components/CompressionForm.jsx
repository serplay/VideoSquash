import React from 'react';

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const remaining = whole % 60;
  return `${minutes}:${remaining.toString().padStart(2, '0')}`;
}

export function CompressionForm({ 
  file, 
  duration,
  targetSize, 
  setTargetSize, 
  startTime,
  setStartTime,
  endTime,
  setEndTime,
  mute, 
  setMute, 
  crop, 
  setCrop, 
  targetResolution, 
  setTargetResolution, 
  autoDownload,
  setAutoDownload,
  onSubmit, 
  disabled 
}) {
  const minTrimLength = 1;
  const maxDuration = Math.max(duration || 0, 0);
  const showTrimControls = maxDuration >= minTrimLength;

  let safeStartTime = Math.min(Math.max(startTime, 0), Math.max(maxDuration - minTrimLength, 0));
  let safeEndTime = Math.min(Math.max(endTime, minTrimLength), maxDuration);

  if (safeEndTime - safeStartTime < minTrimLength) {
    if (safeStartTime + minTrimLength <= maxDuration) {
      safeEndTime = safeStartTime + minTrimLength;
    } else {
      safeStartTime = Math.max(maxDuration - minTrimLength, 0);
      safeEndTime = maxDuration;
    }
  }

  const startPercent = maxDuration > 0 ? (safeStartTime / maxDuration) * 100 : 0;
  const endPercent = maxDuration > 0 ? (safeEndTime / maxDuration) * 100 : 0;
  const canSubmitTrim = !showTrimControls || safeEndTime - safeStartTime >= minTrimLength;

  return (
    <form onSubmit={onSubmit}>
      <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
        <strong>Selected: {file.name}</strong>
      </div>

      <div className="form-group">
        <label htmlFor="targetSize">Target Size (MB)</label>
        <input 
          type="number" 
          id="targetSize" 
          value={targetSize} 
          onChange={e => setTargetSize(e.target.value)}
          min="1"
          step="0.1"
          disabled={disabled}
        />
      </div>

      <div className="form-group">
        <label htmlFor="resolution">Target Resolution (Height)</label>
        <select 
          id="resolution" 
          value={targetResolution} 
          onChange={e => setTargetResolution(e.target.value)}
          disabled={disabled}
        >
          <option value="original">Original</option>
          <option value="1080">1080p</option>
          <option value="720">720p</option>
          <option value="480">480p</option>
          <option value="360">360p</option>
        </select>
      </div>

      <div className="form-group">
        <label htmlFor="crop">Aspect Ratio Crop</label>
        <select 
          id="crop" 
          value={crop} 
          onChange={e => setCrop(e.target.value)}
          disabled={disabled}
        >
          <option value="none">None (Keep Original)</option>
          <option value="16:9">16:9 (Widescreen)</option>
          <option value="9:16">9:16 (TikTok/Shorts)</option>
          <option value="4:5">4:5 (Instagram Post)</option>
          <option value="1:1">1:1 (Square)</option>
        </select>
      </div>

      {showTrimControls && (
        <div className="form-group trim-group">
          <label>Trim Video</label>
          <div className="trim-summary">
            <span>Start: {formatTime(safeStartTime)}</span>
            <span>End: {formatTime(safeEndTime)}</span>
          </div>
          <div className="range-slider-container" style={{ '--start-percent': `${startPercent}%`, '--end-percent': `${endPercent}%` }}>
            <div className="range-track" />
            <div className="range-selected" />
            <input
              type="range"
              min="0"
              max={maxDuration}
              step="0.1"
              value={safeStartTime}
              onChange={(e) => {
                const nextStart = Math.min(Number(e.target.value), Math.max(safeEndTime - minTrimLength, 0));
                setStartTime(nextStart);
              }}
              disabled={disabled}
              aria-label="Start trim point"
            />
            <input
              type="range"
              min="0"
              max={maxDuration}
              step="0.1"
              value={safeEndTime}
              onChange={(e) => {
                const nextEnd = Math.max(Number(e.target.value), safeStartTime + minTrimLength);
                setEndTime(nextEnd);
              }}
              disabled={disabled}
              aria-label="End trim point"
            />
          </div>
          <div className="trim-helper">
            Trim range: {formatTime(safeStartTime)} to {formatTime(safeEndTime)} of {formatTime(maxDuration)}
            {maxDuration > 0 && safeEndTime - safeStartTime < minTrimLength && (
              <span className="trim-warning"> Minimum clip length is 1 second.</span>
            )}
          </div>
        </div>
      )}

      <div className="form-group checkbox-group">
        <input 
          type="checkbox" 
          id="mute" 
          checked={mute} 
          onChange={e => setMute(e.target.checked)}
          disabled={disabled}
        />
        <label htmlFor="mute" style={{margin: 0}}>Mute Audio</label>
      </div>

      <div className="form-group checkbox-group">
        <input 
          type="checkbox" 
          id="autoDownload" 
          checked={autoDownload} 
          onChange={e => setAutoDownload(e.target.checked)}
          disabled={disabled}
        />
        <label htmlFor="autoDownload" style={{margin: 0}}>Auto Download When Completed</label>
      </div>

      <button type="submit" className="primary-action" disabled={disabled || !file || !canSubmitTrim}>
        Squash Video
      </button>
    </form>
  );
}
