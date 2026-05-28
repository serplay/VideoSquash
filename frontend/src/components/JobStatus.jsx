import React from 'react';

export function JobStatus({ status, errorMsg, outputUrl, onReset }) {
  const getStatusText = () => {
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
      
      {(status !== 'completed' && status !== 'error') && (
        <div className="progress-bar">
          <div className={`progress-fill ${status === 'processing' || status === 'pass_1' || status === 'pass_2' ? 'indeterminate' : ''}`} 
               style={{width: status === 'queued' ? '10%' : '50%'}}></div>
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
          style={{ marginTop: '1rem', width: '100%', background: 'transparent', border: '1px solid var(--border-color)'}}
        >
          Compress Another Video
        </button>
      )}
    </div>
  );
}
