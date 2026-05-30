import React, { useState, useCallback } from 'react';
import './index.css';
import { FluidBackground } from './components/FluidBackground';
import { useVideoMetadata } from './hooks/useVideoMetadata';
import { useJobWebSocket } from './hooks/useJobWebSocket';
import { UploadZone } from './components/UploadZone';
import { CompressionForm } from './components/CompressionForm';
import { JobStatus } from './components/JobStatus';
import { saveSessionFile, loadSessionFile, clearSessionFile } from './utils/sessionPersistence';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

function App() {
  // File and metadata state
  const [file, setFile] = useState(null);
  const { metadata, extractMetadata, resetMetadata } = useVideoMetadata();
  
  // Compression options
  const [targetSize, setTargetSize] = useState('25');
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [mute, setMute] = useState(false);
  const [crop, setCrop] = useState('none');
  const [targetResolution, setTargetResolution] = useState('original');
  const [autoDownload, setAutoDownload] = useState(true);
  
  // Job and UI status
  const [jobId, setJobId] = useState(null);
  const [outputUrl, setOutputUrl] = useState(null);
  const [localError, setLocalError] = useState('');
  const [uploadStatus, setUploadStatus] = useState({
    active: false,
    progress: 0,
    speedBps: 0,
    etaSeconds: null,
    label: ''
  });

  // Restore session from localStorage on mount
  React.useEffect(() => {
    let cancelled = false;

    try {
      const raw = localStorage.getItem('videosquash_session');
      if (raw) {
        const sess = JSON.parse(raw);
        if (typeof sess.autoDownload === 'boolean') setAutoDownload(sess.autoDownload);
        if (sess.targetSize) setTargetSize(sess.targetSize);
        if (typeof sess.startTime === 'number') setStartTime(sess.startTime);
        if (typeof sess.endTime === 'number') setEndTime(sess.endTime);
        if (sess.mute) setMute(sess.mute);
        if (sess.crop) setCrop(sess.crop);
        if (sess.targetResolution) setTargetResolution(sess.targetResolution);

        if (sess.jobId) {
          setJobId(sess.jobId);
        }

        (async () => {
          try {
            const restoredFile = await loadSessionFile();
            if (!cancelled && restoredFile) {
              setFile(restoredFile);
            }
          } catch (err) {
            console.warn('Failed to restore uploaded file:', err);
          }
        })();
      }
    } catch (err) {
      console.warn('Failed to restore session:', err);
    }

    return () => {
      cancelled = true;
    };
  }, []);

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

  const { status, setStatus, errorMsg, setErrorMsg, progress, setProgress } = useJobWebSocket(jobId, onJobComplete);

  // Persist session whenever jobId or options change
  React.useEffect(() => {
    if (jobId) {
      const sess = { jobId, autoDownload, targetSize, startTime, endTime, mute, crop, targetResolution, savedAt: Date.now() };
      try { localStorage.setItem('videosquash_session', JSON.stringify(sess)); } catch (err) { console.warn('Failed to save session', err); }
    } else {
      try { localStorage.removeItem('videosquash_session'); } catch (err) {}
    }
  }, [jobId, autoDownload, targetSize, startTime, endTime, mute, crop, targetResolution]);

  const handleFileSelected = async (selectedFile) => {
    if (!selectedFile.type.startsWith('video/')) {
      setLocalError('Please upload a valid video file.');
      return;
    }
    
    setLocalError('');
    setFile(selectedFile);

    try {
      await saveSessionFile(selectedFile);
    } catch (err) {
      console.warn('Failed to cache selected file:', err);
    }
    
    try {
      const meta = await extractMetadata(selectedFile);
      if (meta) {
        // Suggest target size as 50% of original
        const originalSizeMB = selectedFile.size / (1024 * 1024);
        setTargetSize((originalSizeMB * 0.5).toFixed(1));
        setStartTime(0);
        setEndTime(meta.duration || 0);
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
    setUploadStatus({
      active: true,
      progress: 0,
      speedBps: 0,
      etaSeconds: null,
      label: 'Preparing upload...'
    });

    const formData = new FormData();
    formData.append('video', file);
    formData.append('target_size_mb', targetSize);
    formData.append('mute', mute);
    formData.append('crop', crop);
    formData.append('start_time', startTime);
    formData.append('end_time', Number.isFinite(endTime) && endTime > 0 ? endTime : (metadata.duration || 0));
    formData.append('target_resolution', targetResolution);

    try {
      const data = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_BASE}/upload`);

        const startedAt = performance.now();

        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) {
            setUploadStatus((current) => ({
              ...current,
              active: true,
              label: 'Uploading video...'
            }));
            return;
          }

          const loaded = event.loaded;
          const total = event.total || file.size || 1;
          const progress = Math.min(100, (loaded / total) * 100);
          const elapsedSeconds = Math.max((performance.now() - startedAt) / 1000, 0.001);
          const speedBps = loaded / elapsedSeconds;
          const etaSeconds = speedBps > 0 ? Math.max((total - loaded) / speedBps, 0) : null;

          setUploadStatus({
            active: true,
            progress,
            speedBps,
            etaSeconds,
            label: 'Uploading video...'
          });
        };

        xhr.onload = () => {
          try {
            const responseText = xhr.responseText || '{}';
            const parsed = JSON.parse(responseText);
            if (xhr.status < 200 || xhr.status >= 300) {
              reject(new Error(parsed.detail || 'Upload failed'));
              return;
            }
            resolve(parsed);
          } catch (error) {
            reject(new Error('Upload response was invalid'));
          }
        };

        xhr.onerror = () => reject(new Error('Upload failed'));
        xhr.onabort = () => reject(new Error('Upload cancelled'));

        xhr.send(formData);
      });

      setUploadStatus({
        active: false,
        progress: 100,
        speedBps: 0,
        etaSeconds: 0,
        label: 'Upload complete'
      });

      setJobId(data.job_id);
      // persist immediately
      try { localStorage.setItem('videosquash_session', JSON.stringify({ jobId: data.job_id, autoDownload, targetSize, startTime, endTime, mute, crop, targetResolution, savedAt: Date.now() })); } catch (err) {}
    } catch (err) {
      setUploadStatus({
        active: false,
        progress: 0,
        speedBps: 0,
        etaSeconds: null,
        label: ''
      });
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
    setProgress(0);
    setUploadStatus({ active: false, progress: 0, speedBps: 0, etaSeconds: null, label: '' });
    setLocalError('');
    setErrorMsg('');
    clearSessionFile();
    try { localStorage.removeItem('videosquash_session'); } catch (err) {}
  };

  const isIdle = status === 'idle' || status === 'error';
  const displayError = localError || (status === 'error' ? errorMsg : '');

  return (
    <>
      <FluidBackground />
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
            duration={metadata.duration}
            targetSize={targetSize}
            setTargetSize={setTargetSize}
            startTime={startTime}
            setStartTime={setStartTime}
            endTime={endTime}
            setEndTime={setEndTime}
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
            progress={progress}
            uploadStatus={uploadStatus}
            onReset={handleReset}
          />
        )}

        {displayError && isIdle && (
          <div className="error-message" style={{ marginBottom: '1rem' }}>{displayError}</div>
        )}
      </main>
      </div>
    </>
  );
}

export default App;
