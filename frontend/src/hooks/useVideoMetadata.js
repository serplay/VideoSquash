import { useState } from 'react';

export function useVideoMetadata() {
  const [metadata, setMetadata] = useState({ duration: 0, width: 0, height: 0 });
  const [isExtracting, setIsExtracting] = useState(false);
  const [error, setError] = useState(null);

  const extractMetadata = (file) => {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith('video/')) {
        resolve(null);
        return;
      }

      setIsExtracting(true);
      setError(null);

      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        window.URL.revokeObjectURL(video.src);
        const data = {
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight
        };
        setMetadata(data);
        setIsExtracting(false);
        resolve(data);
      };
      video.onerror = () => {
        window.URL.revokeObjectURL(video.src);
        const err = 'Failed to load video metadata.';
        setError(err);
        setIsExtracting(false);
        reject(err);
      };
      video.src = URL.createObjectURL(file);
    });
  };

  const resetMetadata = () => {
    setMetadata({ duration: 0, width: 0, height: 0 });
    setIsExtracting(false);
    setError(null);
  };

  return { metadata, isExtracting, error, extractMetadata, resetMetadata };
}
