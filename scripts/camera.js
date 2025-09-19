import { analyzeFrame, ensureRecognitionEngine } from './recognition-engine.js';

const CAPTURE_INTERVAL_MS = 3500;

function normalizeProgress(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  if (numeric >= 0 && numeric <= 1) {
    return numeric;
  }
  if (numeric >= 0 && numeric <= 100) {
    return numeric / 100;
  }
  if (numeric < 0) {
    return 0;
  }
  return 1;
}

export function createCameraController({
  videoElement,
  onDetections,
  onStatus,
  onWorkerState,
}) {
  let stream = null;
  let intervalId = null;
  let processing = false;
  let active = false;
  let latestWorkerProgress = 0;
  const canvas = document.createElement('canvas');

  const emitWorkerState = (state) => {
    if (typeof onWorkerState === 'function' && state) {
      onWorkerState(state);
    }
  };

  const updateStatus = (state) => {
    if (typeof onStatus === 'function') {
      onStatus(state);
    }
  };

  const stop = async ({ silent } = {}) => {
    if (intervalId) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
    processing = false;
    active = false;
    if (stream) {
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (error) {
          console.warn('Failed to stop track', error);
        }
      });
      stream = null;
    }
    if (videoElement) {
      try {
        videoElement.pause?.();
      } catch (error) {
        // ignore pause errors
      }
      videoElement.srcObject = null;
    }
    if (!silent) {
      updateStatus({ state: 'idle' });
    }
  };

  const captureFrame = async () => {
    if (!stream || processing) {
      return;
    }
    const video = videoElement;
    if (!video || video.readyState < 2) {
      return;
    }
    processing = true;
    try {
      const width = video.videoWidth || 1280;
      const height = video.videoHeight || 720;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return;
      }
      ctx.drawImage(video, 0, 0, width, height);
      const detections = await analyzeFrame(canvas, 'camera', (workerState) => {
        if (!workerState) {
          return;
        }
        emitWorkerState(workerState);
        if (workerState.status === 'processing') {
          updateStatus({ state: 'processing' });
        } else if (workerState.status === 'ready') {
          updateStatus({ state: 'scanning' });
        } else if (workerState.status === 'loading') {
          const normalizedProgress = normalizeProgress(workerState.progress);
          if (normalizedProgress !== null) {
            latestWorkerProgress = Math.max(latestWorkerProgress, normalizedProgress);
          }
          updateStatus({
            state: 'initializing',
            progress: latestWorkerProgress,
            message: workerState.message,
          });
        }
      });
      if (!detections) {
        return;
      }
      if (typeof onDetections === 'function') {
        onDetections(detections);
      }
    } catch (error) {
      console.error('Failed to process frame', error);
      emitWorkerState({ status: 'error', message: error?.message || 'Failed to process camera frame' });
    } finally {
      processing = false;
    }
  };

  const start = async () => {
    if (active) {
      return;
    }
    if (!videoElement) {
      updateStatus({ state: 'error', message: 'Video element missing' });
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      updateStatus({ state: 'error', message: 'Camera access is not supported in this browser.' });
      return;
    }
    active = true;
    updateStatus({ state: 'requesting-permission' });
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      stream = mediaStream;
      videoElement.srcObject = mediaStream;
      videoElement.setAttribute('playsinline', 'true');
      videoElement.muted = true;
      await videoElement.play();

      latestWorkerProgress = 0.1;
      updateStatus({ state: 'initializing', progress: latestWorkerProgress });
      await ensureRecognitionEngine((workerState) => {
        if (!workerState) {
          return;
        }
        emitWorkerState(workerState);
        if (workerState.status === 'loading') {
          const normalizedProgress = normalizeProgress(workerState.progress);
          if (normalizedProgress !== null) {
            latestWorkerProgress = Math.max(latestWorkerProgress, normalizedProgress);
          }
          updateStatus({
            state: 'initializing',
            progress: latestWorkerProgress,
            message: workerState.message,
          });
        } else if (workerState.status === 'ready') {
          latestWorkerProgress = 1;
          updateStatus({ state: 'ready' });
        }
      });

      updateStatus({ state: 'scanning' });
      intervalId = window.setInterval(captureFrame, CAPTURE_INTERVAL_MS);
      await captureFrame();
    } catch (error) {
      console.error('Failed to start camera', error);
      emitWorkerState({ status: 'error', message: error?.message || 'Unable to access camera' });
      updateStatus({ state: 'error', message: error?.message || 'Unable to access camera' });
      await stop({ silent: true });
    }
  };

  return {
    start,
    stop,
    isActive: () => active && !!stream,
  };
}
