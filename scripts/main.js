import { createCameraController } from './camera.js';
import { analyzeFrame, ensureRecognitionEngine } from './recognition-engine.js';
import { createPlateStore } from './store.js';

const store = createPlateStore();

const elements = {
  startButton: document.getElementById('start-scan'),
  stopButton: document.getElementById('stop-scan'),
  cameraStatus: document.getElementById('camera-status'),
  cameraOverlay: document.getElementById('camera-overlay'),
  cameraVideo: document.getElementById('camera-video'),
  scannerLastDetection: document.getElementById('scanner-last-detection'),
  uploadButton: document.getElementById('upload-button'),
  fileInput: document.getElementById('file-input'),
  uploadStatus: document.getElementById('upload-status'),
  encountersGrid: document.getElementById('detections-grid'),
  encountersEmpty: document.getElementById('encounters-empty'),
  statUnique: document.getElementById('stat-unique'),
  statTotal: document.getElementById('stat-total'),
  statMost: document.getElementById('stat-most'),
  statMostCount: document.getElementById('stat-most-count'),
  statRecent: document.getElementById('stat-recent'),
  statRecentTime: document.getElementById('stat-recent-time'),
  exportCsv: document.getElementById('export-csv'),
  resetHistory: document.getElementById('reset-history'),
  debugLog: document.getElementById('debug-log'),
  debugLogEmpty: document.getElementById('debug-log-empty'),
};

function setBadge(element, { text, tone }) {
  if (!element) {
    return;
  }
  const classes = ['status-badge'];
  if (tone) {
    classes.push(tone);
  }
  element.className = classes.join(' ');
  element.textContent = text;
}

function describeRelativeTime(timestamp) {
  if (!timestamp) {
    return '--';
  }
  const diff = Date.now() - Number(timestamp);
  if (!Number.isFinite(diff) || diff < 0) {
    return new Date(timestamp).toLocaleString();
  }
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
  }
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  const days = Math.floor(diff / 86400000);
  if (days < 7) {
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }
  return new Date(timestamp).toLocaleString();
}

function formatConfidence(value) {
  if (!Number.isFinite(value)) {
    return '--';
  }
  return `${value.toFixed(1)}%`;
}

function describeSource(source) {
  if (source === 'upload') {
    return 'still image';
  }
  return 'camera';
}

function updateLastDetection(detection) {
  if (!elements.scannerLastDetection) {
    return;
  }
  if (!detection) {
    elements.scannerLastDetection.classList.add('hidden');
    elements.scannerLastDetection.textContent = '';
    return;
  }
  const time = new Date(detection.capturedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  elements.scannerLastDetection.textContent = `Detected ${detection.formattedPlate} via ${describeSource(
    detection.source
  )} (${formatConfidence(detection.confidence)}) at ${time}`;
  elements.scannerLastDetection.classList.remove('hidden');
}

function renderOverlay(detections) {
  if (!elements.cameraOverlay) {
    return;
  }
  elements.cameraOverlay.innerHTML = '';
  if (!Array.isArray(detections) || detections.length === 0) {
    return;
  }
  for (const detection of detections) {
    if (!detection || !detection.bbox) {
      continue;
    }
    const box = document.createElement('div');
    box.className = 'overlay-box';
    box.style.left = `${Math.max(0, detection.bbox.left) * 100}%`;
    box.style.top = `${Math.max(0, detection.bbox.top) * 100}%`;
    box.style.width = `${Math.min(1, Math.max(0, detection.bbox.width)) * 100}%`;
    box.style.height = `${Math.min(1, Math.max(0, detection.bbox.height)) * 100}%`;

    const plateLabel = document.createElement('span');
    plateLabel.textContent = detection.formattedPlate;
    const confidenceLabel = document.createElement('span');
    confidenceLabel.textContent = formatConfidence(detection.confidence);
    box.appendChild(plateLabel);
    box.appendChild(confidenceLabel);
    elements.cameraOverlay.appendChild(box);
  }
}

function renderRecords(records) {
  if (!elements.encountersGrid || !elements.encountersEmpty) {
    return;
  }
  elements.encountersGrid.innerHTML = '';
  if (!records || records.length === 0) {
    elements.encountersEmpty.classList.remove('hidden');
    return;
  }
  elements.encountersEmpty.classList.add('hidden');
  for (const record of records) {
    const card = document.createElement('div');
    card.className = 'detection-card';
    const title = document.createElement('strong');
    title.textContent = record.formattedPlate || record.plate;
    card.appendChild(title);

    const countLine = document.createElement('span');
    countLine.className = 'detection-meta';
    countLine.textContent = `${record.count} sighting${record.count === 1 ? '' : 's'}`;
    card.appendChild(countLine);

    const sourceLine = document.createElement('span');
    sourceLine.className = 'detection-meta';
    sourceLine.textContent = `Last via ${describeSource(record.lastSource)} · ${describeRelativeTime(record.lastSeen)}`;
    card.appendChild(sourceLine);

    const confidenceLine = document.createElement('span');
    confidenceLine.className = 'detection-meta';
    confidenceLine.textContent = `Confidence ${formatConfidence(record.lastConfidence)}`;
    card.appendChild(confidenceLine);

    elements.encountersGrid.appendChild(card);
  }
}

function renderStats(stats) {
  if (!stats) {
    return;
  }
  if (elements.statUnique) {
    elements.statUnique.textContent = String(stats.uniquePlates ?? 0);
  }
  if (elements.statTotal) {
    elements.statTotal.textContent = String(stats.totalSightings ?? 0);
  }
  if (elements.statMost) {
    if (stats.mostSeenPlate) {
      elements.statMost.textContent = stats.mostSeenPlate.formattedPlate || stats.mostSeenPlate.plate;
      if (elements.statMostCount) {
        elements.statMostCount.textContent = `${stats.mostSeenPlate.count} sighting${
          stats.mostSeenPlate.count === 1 ? '' : 's'
        }`;
      }
    } else {
      elements.statMost.textContent = '--';
      if (elements.statMostCount) {
        elements.statMostCount.textContent = '';
      }
    }
  }
  if (elements.statRecent) {
    if (stats.recentPlate) {
      elements.statRecent.textContent = stats.recentPlate.formattedPlate || stats.recentPlate.plate;
      if (elements.statRecentTime) {
        elements.statRecentTime.textContent = `${describeRelativeTime(stats.recentPlate.lastSeen)} · ${describeSource(
          stats.recentPlate.lastSource
        )}`;
      }
    } else {
      elements.statRecent.textContent = '--';
      if (elements.statRecentTime) {
        elements.statRecentTime.textContent = '';
      }
    }
  }
}

function updateHistoryButtons(hasRecords) {
  const enable = Boolean(hasRecords);
  if (elements.exportCsv) {
    elements.exportCsv.disabled = !enable;
  }
  if (elements.resetHistory) {
    elements.resetHistory.disabled = !enable;
  }
}

function describeLoadingStatus(state) {
  const message = typeof state?.message === 'string' ? state.message.trim() : '';
  const baseLabel = 'Loading ALPR engine';
  const label = message ? `${baseLabel} — ${message}` : baseLabel;
  const rawProgress = Number(state?.progress);
  if (!Number.isFinite(rawProgress)) {
    return label;
  }
  const normalized = rawProgress > 1 ? rawProgress / 100 : rawProgress;
  const clamped = Math.min(Math.max(normalized, 0), 1);
  const percent = Math.round(clamped * 100);
  return `${label} ${percent}%`;
}

const debugState = {
  lastMessages: new Map(),
};

function describeWorkerDebug(state) {
  if (!state) {
    return '';
  }
  if (state.status === 'loading') {
    return describeLoadingStatus(state);
  }
  if (state.status === 'processing') {
    return 'Processing input';
  }
  if (state.status === 'ready') {
    return 'Worker ready';
  }
  if (state.status === 'error') {
    return state.message ? `Error: ${state.message}` : 'Worker error';
  }
  if (state.message) {
    return state.message;
  }
  if (state.status) {
    return `Status: ${state.status}`;
  }
  return '';
}

function logWorkerState(source, state) {
  const message = describeWorkerDebug(state);
  if (!source || !message) {
    return;
  }

  const fingerprint = `${state?.status ?? 'unknown'}|${message}`;
  if (debugState.lastMessages.get(source) === fingerprint) {
    return;
  }
  debugState.lastMessages.set(source, fingerprint);

  if (elements.debugLogEmpty) {
    elements.debugLogEmpty.classList.add('hidden');
  }
  if (!elements.debugLog) {
    return;
  }

  const item = document.createElement('li');
  item.className = 'debug-log__item';

  const meta = document.createElement('div');
  meta.className = 'debug-log__meta';

  const sourceSpan = document.createElement('span');
  sourceSpan.className = 'debug-log__source';
  sourceSpan.textContent = source;
  meta.appendChild(sourceSpan);

  const timeSpan = document.createElement('span');
  timeSpan.className = 'debug-log__timestamp';
  timeSpan.textContent = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  meta.appendChild(timeSpan);

  const messageLine = document.createElement('div');
  messageLine.className = 'debug-log__message';
  messageLine.textContent = message;

  item.appendChild(meta);
  item.appendChild(messageLine);

  elements.debugLog.prepend(item);

  const MAX_DEBUG_ENTRIES = 20;
  while (elements.debugLog.children.length > MAX_DEBUG_ENTRIES) {
    elements.debugLog.removeChild(elements.debugLog.lastElementChild);
  }
}

function mapCameraStatus(state) {
  if (!state || !state.state) {
    return { text: 'Idle', tone: 'idle' };
  }
  switch (state.state) {
    case 'idle':
      return { text: 'Idle', tone: 'idle' };
    case 'requesting-permission':
      return { text: 'Requesting camera…' };
    case 'initializing': {
      return { text: describeLoadingStatus(state) };
    }
    case 'ready':
      return { text: 'Ready', tone: 'ready' };
    case 'scanning':
      return { text: 'Scanning…', tone: 'ready' };
    case 'processing':
      return { text: 'Processing frame…' };
    case 'error':
      return { text: state.message ? `Error: ${state.message}` : 'Error', tone: 'error' };
    default:
      return { text: 'Idle', tone: 'idle' };
  }
}

let cameraController;

function handleCameraStatus(state) {
  const { text, tone } = mapCameraStatus(state);
  setBadge(elements.cameraStatus, { text, tone });
  const active = cameraController?.isActive?.() ?? false;
  if (state?.state === 'idle' || state?.state === 'error') {
    renderOverlay([]);
  }
  if (elements.startButton) {
    elements.startButton.disabled = !(state?.state === 'idle' || state?.state === 'error');
  }
  if (elements.stopButton) {
    elements.stopButton.disabled = !active;
  }
}

function handleDetections(detections) {
  renderOverlay(detections);
  if (!Array.isArray(detections) || detections.length === 0) {
    return;
  }
  for (const detection of detections) {
    store.addDetection(detection);
  }
  updateLastDetection(detections[0]);
}

function setUploadStatus(text, tone) {
  setBadge(elements.uploadStatus, { text, tone });
}

async function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Unable to load image'));
    };
    image.src = url;
  });
}

async function processFile(file) {
  if (!file) {
    return;
  }
  setUploadStatus('Loading image…');
  try {
    const image = await loadImageFromFile(file);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas drawing is not supported in this browser');
    }
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    await ensureRecognitionEngine((workerState) => {
      if (!workerState) {
        return;
      }
      logWorkerState('Image upload', workerState);
      if (workerState.status === 'loading') {
        setUploadStatus('Loading ALPR…');
      } else if (workerState.status === 'ready') {
        setUploadStatus('Ready', 'ready');
      }
    });
    setUploadStatus('Running ALPR…');
    const detections = await analyzeFrame(canvas, 'upload', (workerState) => {
      if (!workerState) {
        return;
      }
      logWorkerState('Image upload', workerState);
      if (workerState.status === 'loading') {
        setUploadStatus('Loading ALPR…');
      } else if (workerState.status === 'processing') {
        setUploadStatus('Running ALPR…');
      }
    });
    if (!Array.isArray(detections)) {
      setUploadStatus('No plates found', 'idle');
      updateLastDetection(null);
      return;
    }
    if (detections.length === 0) {
      setUploadStatus('No plates found', 'idle');
      updateLastDetection(null);
      return;
    }
    detections.forEach((detection) => store.addDetection(detection));
    updateLastDetection(detections[0]);
    setUploadStatus(`Detected ${detections[0].formattedPlate}`, 'ready');
  } catch (error) {
    console.error('Failed to process still image', error);
    logWorkerState('Image upload', { status: 'error', message: error?.message || 'Processing failed' });
    setUploadStatus(error?.message ? `Error: ${error.message}` : 'Processing failed', 'error');
  }
}

function setupEventListeners() {
  if (elements.startButton) {
    elements.startButton.addEventListener('click', () => {
      elements.startButton.disabled = true;
      cameraController?.start?.();
    });
  }
  if (elements.stopButton) {
    elements.stopButton.addEventListener('click', () => {
      elements.stopButton.disabled = true;
      cameraController?.stop?.();
    });
  }
  if (elements.uploadButton && elements.fileInput) {
    elements.uploadButton.addEventListener('click', () => {
      elements.fileInput.click();
    });
    elements.fileInput.addEventListener('change', async (event) => {
      const file = event.target.files && event.target.files[0];
      event.target.value = '';
      await processFile(file);
    });
  }
  if (elements.exportCsv) {
    elements.exportCsv.addEventListener('click', () => {
      store.exportCsv();
    });
  }
  if (elements.resetHistory) {
    elements.resetHistory.addEventListener('click', () => {
      if (window.confirm('Remove all stored encounters?')) {
        store.reset();
        updateLastDetection(null);
      }
    });
  }
  window.addEventListener('pagehide', () => {
    cameraController?.stop?.({ silent: true });
  });
}

function init() {
  cameraController = createCameraController({
    videoElement: elements.cameraVideo,
    onDetections: handleDetections,
    onStatus: handleCameraStatus,
    onWorkerState: (state) => logWorkerState('Camera', state),
  });

  setupEventListeners();

  store.subscribe((records, stats) => {
    renderRecords(records);
    renderStats(stats);
    updateHistoryButtons(records.length > 0);
  });

  setBadge(elements.cameraStatus, { text: 'Idle', tone: 'idle' });
  setUploadStatus('Idle', 'idle');
}

init();
