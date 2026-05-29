import React from 'react';

function formatSpeed(bytesPerSecond) {
  if (!bytesPerSecond || bytesPerSecond <= 0) return '0 B/s';
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let value = bytesPerSecond;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatEta(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return 'Calculating...';
  const clamped = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(clamped / 60);
  const remaining = clamped % 60;
  if (minutes <= 0) return `${remaining}s`;
  return `${minutes}m ${remaining.toString().padStart(2, '0')}s`;
}

export function JobStatus({ status, errorMsg, outputUrl, progress = 0, uploadStatus, onReset }) {
  const getStatusText = () => {
    if (uploadStatus?.active) return uploadStatus.label || 'Uploading video...';
    switch(status) {
      case 'queued': return 'Waiting in queue...';
      case 'pass_1': return 'Analyzing video (Pass 1/2)...';
      case 'pass_2': return 'Compressing video (Pass 2/2)...';
      case 'processing': return 'Processing...';
      case 'completed': return 'Video Squashed!';
      case 'error': return 'Error!';
      default: return 'Starting...';
    }
  };

  return (
    <div className="status-container">
      <h3>{getStatusText()}</h3>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>
        <span>{uploadStatus?.active ? 'Uploading' : (status === 'completed' ? 'Done' : 'In progress')}</span>
        <span>{Math.max(0, Math.min(100, Math.round(uploadStatus?.active ? uploadStatus.progress : progress)))}%</span>
      </div>
      {uploadStatus?.active && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.75rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          <span>{formatSpeed(uploadStatus.speedBps)}</span>
          <span>ETA {formatEta(uploadStatus.etaSeconds)}</span>
        </div>
      )}
      
      {(status !== 'completed' && status !== 'error') && (
        <div className="progress-bar" aria-label="Compression progress">
          <div 
            className="progress-fill" 
            style={{width: `${Math.max(0, Math.min(100, uploadStatus?.active ? uploadStatus.progress : progress))}%`}}
          ></div>
        </div>
      )}

      {status === 'error' && (
        <div className="error-message">{errorMsg}</div>
      )}

      {status === 'completed' && outputUrl && (
        <div style={{ marginTop: '1.5rem' }}>
          <a href={outputUrl} download="squashed_video.mp4" style={{ textDecoration: 'none' }}>
            <button style={{ width: '100%' }}>Download Squashed Video</button>
          </a>
        </div>
      )}

      {(status === 'completed' || status === 'error') && (
        <button 
          onClick={onReset}
          style={{ marginTop: '1rem', width: '100%', background: '#3a3a3a', color: 'var(--text-color)', border: '1px solid #555' }}
        >
          Compress Another Video
        </button>
      )}
    </div>
  );
}
