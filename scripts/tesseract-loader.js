const TESSERACT_SOURCES = [
  {
    name: 'jsdelivr',
    displayName: 'jsDelivr',
    scriptUrl: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
    assetBaseUrl: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/',
    failureStatus: {
      status: 'loading',
      message: 'Retrying OCR engine download from an alternate CDN',
      progress: 0.18,
    },
  },
  {
    name: 'cdnjs',
    displayName: 'cdnjs',
    scriptUrl: 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.0.0/tesseract.min.js',
    assetBaseUrl: 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.0.0/',
    failureStatus: {
      status: 'loading',
      message: 'Retrying OCR engine download from an alternate CDN',
      progress: 0.18,
    },
  },
  {
    name: 'unpkg',
    displayName: 'unpkg',
    scriptUrl: 'https://unpkg.com/tesseract.js@5/dist/tesseract.min.js',
    assetBaseUrl: 'https://unpkg.com/tesseract.js@5/dist/',
    failureStatus: {
      status: 'loading',
      message: 'Retrying OCR engine download from an alternate CDN',
      progress: 0.18,
    },
  },
];

let loadPromise = null;
let selectedSource = null;

function isTesseractReady() {
  return Boolean(globalThis.Tesseract && typeof globalThis.Tesseract.createWorker === 'function');
}

function hasDOM() {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

function notify(reportStatus, state) {
  if (!state || typeof reportStatus !== 'function') {
    return;
  }
  try {
    reportStatus(state);
  } catch (error) {
    console.error('Status listener failed', error);
  }
}

function appendScript(source) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = source.scriptUrl;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = () => resolve(script);
    script.onerror = (event) => {
      script.remove();
      const error = new Error(`Failed to load script: ${source.scriptUrl}`);
      error.event = event;
      reject(error);
    };
    document.head.appendChild(script);
  });
}

async function attemptLoadFromSource(source, reportStatus) {
  notify(reportStatus, {
    status: 'loading',
    message: `Loading OCR engine via ${source.displayName}`,
    progress: 0.05,
  });

  await appendScript(source);

  if (!isTesseractReady()) {
    throw new Error(`Tesseract.js did not expose a global after loading from ${source.displayName}`);
  }

  notify(reportStatus, {
    status: 'loading',
    message: 'OCR engine ready',
    progress: 0.12,
  });

  selectedSource = source;
  return source;
}

export async function loadTesseract(reportStatus) {
  if (isTesseractReady()) {
    if (!selectedSource) {
      selectedSource = TESSERACT_SOURCES[0];
    }
    return selectedSource;
  }

  if (!hasDOM()) {
    throw new Error('Tesseract.js is unavailable and cannot be loaded in this environment.');
  }

  if (!loadPromise) {
    loadPromise = (async () => {
      let lastError = null;
      for (const source of TESSERACT_SOURCES) {
        try {
          return await attemptLoadFromSource(source, reportStatus);
        } catch (error) {
          lastError = error;
          console.warn(`Failed to load Tesseract.js from ${source.displayName}`, error);
          notify(reportStatus, {
            status: 'loading',
            message: `Failed to load OCR engine from ${source.displayName}. Trying another mirror...`,
            progress: 0.05,
          });
        }
      }

      const failure = new Error('Failed to load the OCR engine. Check your connection and try again.');
      if (lastError) {
        failure.cause = lastError;
      }
      throw failure;
    })().catch((error) => {
      loadPromise = null;
      throw error;
    });
  }

  return loadPromise;
}

export function getWorkerSources() {
  if (selectedSource) {
    const remaining = TESSERACT_SOURCES.filter((source) => source !== selectedSource);
    return [selectedSource, ...remaining];
  }
  return [...TESSERACT_SOURCES];
}

export function __resetForTests() {
  loadPromise = null;
  selectedSource = null;
}

export { TESSERACT_SOURCES };
