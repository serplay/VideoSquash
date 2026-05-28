import React, { useState, useCallback } from 'react';
import './index.css';
import { useVideoMetadata } from './hooks/useVideoMetadata';
import { useJobWebSocket } from './hooks/useJobWebSocket';
import { UploadZone } from './components/UploadZone';
import { CompressionForm } from './components/CompressionForm';
import { JobStatus } from './components/JobStatus';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

function App() {
  // File and metadata state
  const [file, setFile] = useState(null);
  const { metadata, extractMetadata, resetMetadata } = useVideoMetadata();
  
  // Compression options
  const [targetSize, setTargetSize] = useState('25');
  const [mute, setMute] = useState(false);
  const [crop, setCrop] = useState('none');
  const [targetResolution, setTargetResolution] = useState('original');
  const [autoDownload, setAutoDownload] = useState(true);
  
  // Job and UI status
  const [jobId, setJobId] = useState(null);
  const [outputUrl, setOutputUrl] = useState(null);
  const [localError, setLocalError] = useState('');

  const onJobComplete = useCallback((data) => {
    const downloadUrl = `${API_BASE}/download/${data.job_id}`;
    setOutputUrl(downloadUrl);
    
    if (autoDownload) {
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.setAttribute('download', `squashed_${data.job_id.substring(0, 8)}.mp4`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }, [autoDownload]);

  const { status, setStatus, errorMsg, setErrorMsg } = useJobWebSocket(jobId, onJobComplete);

  const handleFileSelected = async (selectedFile) => {
    if (!selectedFile.type.startsWith('video/')) {
      setLocalError('Please upload a valid video file.');
      return;
    }
    
    setLocalError('');
    setFile(selectedFile);
    
    try {
      const meta = await extractMetadata(selectedFile);
      if (meta) {
        // Suggest target size as 50% of original
        const originalSizeMB = selectedFile.size / (1024 * 1024);
        setTargetSize((originalSizeMB * 0.5).toFixed(1));
      }
    } catch (err) {
      setLocalError('Error reading video metadata.');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return;

    setStatus('starting');
    setLocalError('');
    setErrorMsg('');

    const formData = new FormData();
    formData.append('video', file);
    formData.append('target_size_mb', targetSize);
    formData.append('mute', mute);
    formData.append('crop', crop);
    formData.append('target_resolution', targetResolution);

    try {
      const response = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Upload failed');
      }

      const data = await response.json();
      setJobId(data.job_id);
    } catch (err) {
      setStatus('error');
      setErrorMsg(err.message);
    }
  };

  const handleReset = () => {
    setFile(null);
    resetMetadata();
    setJobId(null);
    setOutputUrl(null);
    setStatus('idle');
    setLocalError('');
    setErrorMsg('');
  };

  const isIdle = status === 'idle' || status === 'error';
  const displayError = localError || (status === 'error' ? errorMsg : '');

  return (
    <div className="app-container">
      <header>
        <h1>VideoSquash</h1>
        <p className="subtitle">Strictly minimal video compression</p>
      </header>

      <main>
        {status === 'idle' && !file && (
          <UploadZone onFileSelected={handleFileSelected} />
        )}

        {file && isIdle && (
          <CompressionForm 
            file={file}
            targetSize={targetSize}
            setTargetSize={setTargetSize}
            mute={mute}
            setMute={setMute}
            crop={crop}
            setCrop={setCrop}
            targetResolution={targetResolution}
            setTargetResolution={setTargetResolution}
            autoDownload={autoDownload}
            setAutoDownload={setAutoDownload}
            onSubmit={handleSubmit}
            disabled={status !== 'idle' && status !== 'error'}
          />
        )}

        {!isIdle && (
          <JobStatus 
            status={status}
            errorMsg={errorMsg}
            outputUrl={outputUrl}
            onReset={handleReset}
          />
        )}

        {displayError && isIdle && (
          <div className="error-message" style={{ marginBottom: '1rem' }}>{displayError}</div>
        )}
      </main>
    </div>
  );
}

export default App;
