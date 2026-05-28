import React from 'react';

export function CompressionForm({ 
  file, 
  targetSize, 
  setTargetSize, 
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

      <button type="submit" disabled={disabled || !file}>
        Squash Video
      </button>
    </form>
  );
}
