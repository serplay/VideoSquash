import { useState, useEffect, useRef } from 'react';

export function useJobWebSocket(jobId, onComplete) {
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const onCompleteRef = useRef(onComplete);

  // Keep the ref up to date without triggering the main effect
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (!jobId) return;

    setStatus('queued');
    setErrorMsg('');

    // Construct WebSocket URL based on VITE_API_BASE
    let apiBase = import.meta.env.VITE_API_BASE || '/api';
    let wsUrl;
    if (apiBase.startsWith('http')) {
      wsUrl = apiBase.replace(/^http/, 'ws') + `/ws/status/${jobId}`;
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const formattedApiBase = apiBase.startsWith('/') ? apiBase : '/' + apiBase;
      wsUrl = `${protocol}//${window.location.host}${formattedApiBase}/ws/status/${jobId}`;
    }

    console.log('Connecting to WebSocket status stream:', wsUrl);
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('WebSocket received:', data);
        if (data.status === 'completed') {
          setStatus('completed');
          if (onCompleteRef.current) onCompleteRef.current(data);
          ws.close();
        } else if (data.status === 'failed') {
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
    };

    return () => {
      ws.close();
    };
  }, [jobId]);

  return { status, setStatus, errorMsg, setErrorMsg };
}
