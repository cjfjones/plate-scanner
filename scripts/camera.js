import { wordsToDetections } from './detections.js';
import { ensureWorker, recognize } from './ocr.js';

const CAPTURE_INTERVAL_MS = 3500;
const WORKER_PROGRESS_WARNING_MS = 12000;
const WORKER_PROGRESS_TIMEOUT_MS = 45000;

const PROGRESS_MESSAGE_HINTS = [
  { test: /preparing ocr engine/i, progress: 0.1 },
  { test: /loading (english|eng)/i, progress: 0.65 },
  { test: /loading (?:language|traineddata)/i, progress: 0.6 },
  { test: /loading (?:worker|core|wasm)/i, progress: 0.3 },
  { test: /initializing (?:ocr|tesseract|api)/i, progress: 0.9 },
];

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

function inferProgressFromMessage(message) {
  if (typeof message !== 'string') {
    return null;
  }
  const normalized = message.toLowerCase();
  for (const hint of PROGRESS_MESSAGE_HINTS) {
    if (hint.test.test(normalized)) {
      return Math.min(Math.max(hint.progress, 0), 1);
    }
  }
  return null;
}

export function createCameraController({
  videoElement,
  onDetections,
  onStatus,
}) {
  let stream = null;
  let intervalId = null;
  let processing = false;
  let active = false;
  let latestWorkerProgress = 0;
  let workerWarningTimeoutId = null;
  let workerTimeoutId = null;
  const canvas = document.createElement('canvas');

  const updateStatus = (state) => {
    if (typeof onStatus === 'function') {
      onStatus(state);
    }
  };

  const clearWorkerWatchdogs = () => {
    if (workerWarningTimeoutId) {
      window.clearTimeout(workerWarningTimeoutId);
      workerWarningTimeoutId = null;
    }
    if (workerTimeoutId) {
      window.clearTimeout(workerTimeoutId);
      workerTimeoutId = null;
    }
  };

  const scheduleWorkerWarning = () => {
    if (!active) {
      return;
    }
    if (workerWarningTimeoutId) {
      window.clearTimeout(workerWarningTimeoutId);
    }
    workerWarningTimeoutId = window.setTimeout(() => {
      if (!active) {
        return;
      }
      const fallbackProgress = latestWorkerProgress > 0 ? latestWorkerProgress : 0.1;
      updateStatus({
        state: 'initializing',
        progress: fallbackProgress,
        message: 'Still loading the OCR engine… This can take up to 30 seconds on the first run.',
      });
      workerWarningTimeoutId = null;
    }, WORKER_PROGRESS_WARNING_MS);
  };

  const scheduleWorkerTimeout = () => {
    if (!active) {
      return;
    }
    if (workerTimeoutId) {
      window.clearTimeout(workerTimeoutId);
    }
    workerTimeoutId = window.setTimeout(() => {
      if (!active) {
        return;
      }
      console.error('Timed out while initializing OCR worker');
      updateStatus({
        state: 'error',
        message: 'Loading the OCR engine timed out. Check your connection and try again.',
      });
      clearWorkerWatchdogs();
      stop({ silent: true }).catch((error) => {
        console.warn('Failed to stop camera after OCR timeout', error);
      });
    }, WORKER_PROGRESS_TIMEOUT_MS);
  };

  const stop = async ({ silent } = {}) => {
    if (intervalId) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
    processing = false;
    active = false;
    clearWorkerWatchdogs();
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
    latestWorkerProgress = 0;
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
      const result = await recognize(canvas, (workerState) => {
        if (!workerState) {
          return;
        }
        if (workerState.status === 'processing') {
          updateStatus({ state: 'processing' });
        } else if (workerState.status === 'ready') {
          updateStatus({ state: 'scanning' });
        }
      });
      if (!result || !result.data) {
        return;
      }
      const words = Array.isArray(result.data.words) ? result.data.words : [];
      const detections = wordsToDetections(words, width, height, 'camera');
      if (typeof onDetections === 'function') {
        onDetections(detections);
      }
    } catch (error) {
      console.error('Failed to process frame', error);
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
      scheduleWorkerWarning();
      scheduleWorkerTimeout();
      await ensureWorker((workerState) => {
        if (!workerState) {
          return;
        }
        if (!active) {
          return;
        }
        if (workerState.status === 'loading') {
          const normalizedProgress = normalizeProgress(workerState.progress);
          const inferredProgress =
            normalizedProgress !== null ? normalizedProgress : inferProgressFromMessage(workerState.message);
          if (inferredProgress !== null) {
            latestWorkerProgress = Math.max(latestWorkerProgress, inferredProgress);
          }
          scheduleWorkerWarning();
          scheduleWorkerTimeout();
          updateStatus({
            state: 'initializing',
            progress: latestWorkerProgress,
            message: workerState.message,
          });
        } else if (workerState.status === 'ready') {
          latestWorkerProgress = 1;
          clearWorkerWatchdogs();
          updateStatus({ state: 'ready' });
        }
      });

      if (!active) {
        return;
      }

      updateStatus({ state: 'scanning' });
      intervalId = window.setInterval(captureFrame, CAPTURE_INTERVAL_MS);
      await captureFrame();
    } catch (error) {
      console.error('Failed to start camera', error);
      updateStatus({ state: 'error', message: error?.message || 'Unable to access camera' });
      clearWorkerWatchdogs();
      await stop({ silent: true });
    }
  };

  return {
    start,
    stop,
    isActive: () => active && !!stream,
  };
}
