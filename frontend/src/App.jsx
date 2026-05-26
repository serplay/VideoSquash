import React, { useState, useRef, useEffect } from 'react';
import './index.css';

const API_BASE = 'http://localhost:8000'; // Make sure this matches FastAPI port

function App() {
  const [file, setFile] = useState(null);
  const [targetSize, setTargetSize] = useState(10);
  const [mute, setMute] = useState(false);
  const [crop, setCrop] = useState('none');
  const [isDragging, setIsDragging] = useState(false);
  
  const [videoDuration, setVideoDuration] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  
  const [jobId, setJobId] = useState(null);
  const [status, setStatus] = useState('idle'); // idle, uploading, queued, processing, completed, error
  const [errorMsg, setErrorMsg] = useState('');
  
  const fileInputRef = useRef(null);
  const pollIntervalRef = useRef(null);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      checkAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      checkAndSetFile(e.target.files[0]);
    }
  };

  const checkAndSetFile = (selectedFile) => {
    if (!selectedFile.type.startsWith('video/')) {
      setErrorMsg('Please upload a valid video file.');
      return;
    }
    if (selectedFile.size > 1024 * 1024 * 1024) {
      setErrorMsg('File too large. Maximum size is 1GB.');
      return;
    }
    setFile(selectedFile);
    setErrorMsg('');
    setStatus('idle');
    setJobId(null);
    
    // Extract duration
    const url = URL.createObjectURL(selectedFile);
    const videoElement = document.createElement('video');
    videoElement.src = url;
    videoElement.onloadedmetadata = () => {
      setVideoDuration(videoElement.duration);
      setStartTime(0);
      setEndTime(videoElement.duration);
      URL.revokeObjectURL(url);
    };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return;

    const formData = new FormData();
    formData.append('video', file);
    formData.append('target_size_mb', targetSize);
    formData.append('mute', mute);
    formData.append('crop', crop);
    formData.append('start_time', startTime);
    formData.append('end_time', endTime);

    try {
      setStatus('uploading');
      setErrorMsg('');
      
      const res = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        body: formData,
      });
      
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Upload failed');
      }
      
      const data = await res.json();
      setJobId(data.job_id);
      setStatus('queued');
      
    } catch (err) {
      setErrorMsg(err.message);
      setStatus('error');
    }
  };

  useEffect(() => {
    if (jobId && (status === 'queued' || status === 'processing')) {
      pollIntervalRef.current = setInterval(async () => {
        try {
          const res = await fetch(`${API_BASE}/status/${jobId}`);
          if (res.status === 429) {
            // Rate limited, just skip this poll
            return;
          }
          const data = await res.json();
          
          if (data.status === 'completed') {
            setStatus('completed');
            clearInterval(pollIntervalRef.current);
          } else if (data.status === 'failed') {
            setStatus('error');
            setErrorMsg(data.error || 'Processing failed');
            clearInterval(pollIntervalRef.current);
          } else {
            // queued or processing (or pass_1, pass_2)
            setStatus('processing');
          }
        } catch (err) {
          console.error("Polling error", err);
        }
      }, 2500); // Poll every 2.5s to respect 30/min rate limit
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [jobId, status]);

  const getStatusText = () => {
    switch (status) {
      case 'uploading': return 'Uploading video...';
      case 'queued': return 'In queue...';
      case 'processing': return 'Squashing video...';
      case 'completed': return 'Video ready!';
      case 'error': return 'An error occurred';
      default: return '';
    }
  };

  return (
    <div className="app-container">
      <header>
        <h1>VideoSquash</h1>
        <p className="subtitle">Strictly minimal video compression</p>
      </header>

      <main>
        <form onSubmit={handleSubmit}>
          <div 
            className={`upload-zone ${isDragging ? 'drag-active' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current.click()}
          >
            <input 
              type="file" 
              ref={fileInputRef} 
              style={{ display: 'none' }} 
              accept="video/*"
              onChange={handleFileChange}
            />
            {file ? (
              <p>Selected: {file.name} ({(file.size / (1024*1024)).toFixed(2)} MB)</p>
            ) : (
              <>
                <p>Drag & Drop a video here</p>
                <span>or click to browse (Max 1GB)</span>
              </>
            )}
          </div>

          <div className="form-group">
            <label>Target Size (MB)</label>
            <input 
              type="number" 
              step="0.1"
              min="0.1"
              value={targetSize} 
              onChange={e => setTargetSize(e.target.value)} 
              required 
              disabled={status !== 'idle' && status !== 'error'}
            />
          </div>

          <div className="form-group">
            <label>Crop Aspect Ratio</label>
            <select 
              value={crop} 
              onChange={e => setCrop(e.target.value)}
              disabled={status !== 'idle' && status !== 'error'}
            >
              <option value="none">No Crop (Original)</option>
              <option value="1:1">1:1 (Square)</option>
              <option value="16:9">16:9 (Landscape)</option>
              <option value="9:16">9:16 (Portrait)</option>
            </select>
          </div>
          
          {videoDuration > 0 && (
            <div className="form-group">
              <label>Trim Video (Start: {startTime.toFixed(1)}s - End: {endTime.toFixed(1)}s)</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.8rem', width: '40px' }}>Start</span>
                  <input 
                    type="range" 
                    min="0" 
                    max={Math.max(0, endTime - 0.1)} 
                    step="0.1" 
                    value={startTime} 
                    onChange={e => setStartTime(parseFloat(e.target.value))}
                    disabled={status !== 'idle' && status !== 'error'}
                    style={{ flex: 1 }}
                  />
                </div>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.8rem', width: '40px' }}>End</span>
                  <input 
                    type="range" 
                    min={Math.min(videoDuration, startTime + 0.1)} 
                    max={videoDuration} 
                    step="0.1" 
                    value={endTime} 
                    onChange={e => setEndTime(parseFloat(e.target.value))}
                    disabled={status !== 'idle' && status !== 'error'}
                    style={{ flex: 1 }}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="form-group checkbox-group">
            <input 
              type="checkbox" 
              id="mute" 
              checked={mute} 
              onChange={e => setMute(e.target.checked)}
              disabled={status !== 'idle' && status !== 'error'}
            />
            <label htmlFor="mute" style={{margin: 0}}>Mute Audio</label>
          </div>

          {(status === 'idle' || status === 'error') && (
            <button type="submit" disabled={!file}>
              Squash Video
            </button>
          )}
        </form>

        {status !== 'idle' && (
          <div className="status-container">
            <h3>{getStatusText()}</h3>
            
            {(status === 'uploading' || status === 'queued' || status === 'processing') && (
              <div className="progress-bar">
                <div className={`progress-fill ${status === 'processing' ? 'indeterminate' : ''}`} 
                     style={{width: status === 'uploading' ? '50%' : status === 'queued' ? '10%' : '100%'}}>
                </div>
              </div>
            )}
            
            {status === 'completed' && (
              <a href={`${API_BASE}/download/${jobId}`} download style={{textDecoration: 'none'}}>
                <button style={{width: '100%'}}>Download Output</button>
              </a>
            )}
            
            {status === 'error' && (
              <div className="error-message">{errorMsg}</div>
            )}
            
            {(status === 'completed' || status === 'error') && (
              <button 
                type="button"
                onClick={() => {
                  setFile(null);
                  setStatus('idle');
                  setJobId(null);
                  setVideoDuration(0);
                  setStartTime(0);
                  setEndTime(0);
                }}
                style={{width: '100%', backgroundColor: 'transparent', border: '1px solid var(--border-color)'}}
              >
                Compress Another Video
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
