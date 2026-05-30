import { useState, useEffect, useRef } from 'react';

export function useJobWebSocket(jobId, onComplete) {
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [progress, setProgress] = useState(0);
  const onCompleteRef = useRef(onComplete);

  // Keep the ref up to date without triggering the main effect
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (!jobId) return;

    setStatus('queued');
    setErrorMsg('');
    setProgress(0);

    // Construct separate HTTP and WebSocket URLs based on VITE_API_BASE
    let apiBase = import.meta.env.VITE_API_BASE || '/api';
    let wsUrl;
    let statusUrl;
    if (apiBase.startsWith('http')) {
      wsUrl = apiBase.replace(/^http/, 'ws') + `/ws/status/${jobId}`;
      statusUrl = `${apiBase}/status/${jobId}`;
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const httpProtocol = window.location.protocol;
      const formattedApiBase = apiBase.startsWith('/') ? apiBase : '/' + apiBase;
      wsUrl = `${protocol}//${window.location.host}${formattedApiBase}/ws/status/${jobId}`;
      statusUrl = `${httpProtocol}//${window.location.host}${formattedApiBase}/status/${jobId}`;
    }

    console.log('Checking current job status and connecting to WebSocket:', wsUrl);

    let ws = null;
    let cancelled = false;
    let terminalStateReached = false;

    const markStaleJob = () => {
      if (cancelled) return;
      setStatus('error');
      setProgress(0);
      setErrorMsg('This job is no longer available. Please upload a new video.');
      try {
        localStorage.removeItem('videosquash_session');
      } catch (err) {}
    };

    // First fetch current status in case we missed updates (e.g., after reload)
    (async () => {
      try {
        const statusResp = await fetch(statusUrl);
        if (!statusResp.ok) {
          if (statusResp.status === 404) {
            markStaleJob();
            return;
          }
          throw new Error(`Status request failed with ${statusResp.status}`);
        }

        const data = await statusResp.json();
        if (cancelled) return;
        setProgress(typeof data.progress === 'number' ? data.progress : 0);
        if (data.status === 'completed') {
          terminalStateReached = true;
          setStatus('completed');
          setProgress(100);
          if (onCompleteRef.current) onCompleteRef.current(data);
          return;
        } else if (data.status === 'failed') {
          terminalStateReached = true;
          setStatus('error');
          setErrorMsg(data.error || 'Processing failed');
          return;
        } else {
          setStatus(data.status);
        }
      } catch (err) {
        console.warn('Could not fetch initial status:', err);
        if (!cancelled) {
          markStaleJob();
        }
        return;
      }
      if (cancelled) return;

      ws = new WebSocket(wsUrl);

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('WebSocket received:', data);
          if (typeof data.progress === 'number') {
            setProgress(data.progress);
          }
          if (data.status === 'completed') {
            terminalStateReached = true;
            setStatus('completed');
            setProgress(100);
            if (onCompleteRef.current) onCompleteRef.current(data);
            ws.close();
          } else if (data.status === 'failed') {
            terminalStateReached = true;
            setStatus('error');
            setErrorMsg(data.error || 'Processing failed');
            ws.close();
          } else {
            setStatus(data.status);
          }
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        setStatus('error');
        setErrorMsg('Lost connection to status stream.');
      };

      ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        if (!terminalStateReached && event.code === 1008) {
          markStaleJob();
        }
      };
    })();

    return () => {
      cancelled = true;
      if (ws) {
        ws.close();
      }
    };
  }, [jobId]);

  return { status, setStatus, errorMsg, setErrorMsg, progress, setProgress };
}
