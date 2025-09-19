import { loadTesseract, getWorkerSources } from './tesseract-loader.js';

const DEFAULT_LANGUAGE = 'eng';
const DEFAULT_WORKER_CREATION_TIMEOUT_MS = 120000;
const SAFARI_BLOB_WORKER_TIMEOUT_MS = 8000;
const FALLBACK_WORKER_CREATION_TIMEOUT_MS = 180000;

function shouldDisableBlobWorker() {
  const nav = globalThis.navigator;
  if (!nav) {
    return false;
  }
  const userAgent = nav.userAgent || '';
  if (!userAgent) {
    return false;
  }
  const isAppleVendor = typeof nav.vendor === 'string' && nav.vendor.includes('Apple');
  const isIOS = /\b(iPad|iPhone|iPod)\b/i.test(userAgent);
  const isSafari = /Safari/i.test(userAgent) && !/(Chrome|CriOS|Chromium|Edg|OPiOS|FxiOS)/i.test(userAgent);
  const isMacTouchDevice = userAgent.includes('Macintosh') && 'ontouchend' in globalThis;
  return (isAppleVendor && isSafari) || isIOS || isMacTouchDevice;
}

let workerInstance = null;
let workerPromise = null;

function withTimeout(promise, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      const error = new Error('Worker initialization timed out');
      error.name = 'TimeoutError';
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      globalThis.clearTimeout(timeoutId);
    }
  });
}

async function createWorkerInstance(Tesseract, workerOptions, reportStatus) {
  const shouldTryFallback = shouldDisableBlobWorker();
  const primaryPromise = Tesseract.createWorker(DEFAULT_LANGUAGE, undefined, workerOptions);

  if (!shouldTryFallback) {
    return withTimeout(primaryPromise, DEFAULT_WORKER_CREATION_TIMEOUT_MS);
  }

  let fallbackTriggered = false;
  primaryPromise
    .then(async (worker) => {
      if (fallbackTriggered && worker && typeof worker.terminate === 'function') {
        try {
          await worker.terminate();
        } catch (error) {
          console.warn('Failed to terminate unused OCR worker', error);
        }
      }
    })
    .catch(() => {
      // The error will be handled by the awaiting code.
    });

  let primaryError = null;
  try {
    return await withTimeout(primaryPromise, SAFARI_BLOB_WORKER_TIMEOUT_MS);
  } catch (error) {
    fallbackTriggered = true;
    primaryError = error;
  }

  console.warn('Retrying OCR worker initialization without blob URL', primaryError);
  sendStatus(reportStatus, {
    status: 'loading',
    message: 'Retrying OCR engine for Safari',
    progress: 0.2,
  });

  const fallbackOptions = { ...workerOptions, workerBlobURL: false };
  try {
    return await withTimeout(
      Tesseract.createWorker(DEFAULT_LANGUAGE, undefined, fallbackOptions),
      FALLBACK_WORKER_CREATION_TIMEOUT_MS,
    );
  } catch (fallbackError) {
    if (primaryError) {
      fallbackError.cause = primaryError;
    }
    throw fallbackError;
  }
}

function getTesseract() {
  const tesseract = globalThis.Tesseract;
  if (!tesseract) {
    throw new Error('Tesseract.js failed to load. Check your network connection.');
  }
  return tesseract;
}

function sendStatus(reportStatus, state) {
  if (typeof reportStatus === 'function') {
    try {
      reportStatus(state);
    } catch (error) {
      console.error('Status listener failed', error);
    }
  }
}

function createWorkerOptions(source, reportStatus) {
  const baseUrl = source.assetBaseUrl || source.baseUrl;
  if (!baseUrl) {
    throw new Error(`Invalid OCR worker source configuration for ${source?.name || 'unknown source'}`);
  }
  const langPath = source.langPathBaseUrl || `${baseUrl}langs/`;
  return {
    workerPath: `${baseUrl}worker.min.js`,
    corePath: `${baseUrl}tesseract-core.wasm.js`,
    langPath,
    logger: (message) => {
      if (!message) {
        return;
      }
      const progress = typeof message.progress === 'number' ? message.progress : undefined;
      sendStatus(reportStatus, {
        status: 'loading',
        message: message.status || 'Loading',
        progress,
      });
    },
  };
}

export async function ensureWorker(reportStatus) {
  if (workerInstance) {
    sendStatus(reportStatus, { status: 'ready' });
    return workerInstance;
  }

  if (!workerPromise) {
    workerPromise = (async () => {
      await loadTesseract((state) => sendStatus(reportStatus, state));
      const Tesseract = getTesseract();
      sendStatus(reportStatus, { status: 'loading', message: 'Preparing OCR engine', progress: 0 });
      let worker = null;
      let lastError = null;
      const workerSources = getWorkerSources();
      for (const source of workerSources) {
        const workerOptions = createWorkerOptions(source, reportStatus);
        try {
          worker = await createWorkerInstance(Tesseract, workerOptions, reportStatus);
          break;
        } catch (error) {
          lastError = error;
          console.warn(`Failed to initialize OCR worker from ${source.name}`, error);
          if (source.failureStatus) {
            sendStatus(reportStatus, source.failureStatus);
          }
        }
      }

      if (!worker) {
        const failure = new Error('Failed to load OCR engine. Check your network connection and try again.');
        if (lastError) {
          failure.cause = lastError;
        }
        throw failure;
      }

      sendStatus(reportStatus, { status: 'loading', message: 'Loading OCR engine', progress: 0.4 });
      await worker.load();
      sendStatus(reportStatus, { status: 'loading', message: 'Loading English language', progress: 0.6 });
      await worker.loadLanguage(DEFAULT_LANGUAGE);
      sendStatus(reportStatus, { status: 'loading', message: 'Initializing OCR', progress: 0.8 });
      await worker.initialize(DEFAULT_LANGUAGE);
      workerInstance = worker;
      sendStatus(reportStatus, { status: 'ready' });
      return workerInstance;
    })()
      .catch((error) => {
        workerInstance = null;
        throw error;
      });
  }

  try {
    const worker = await workerPromise;
    if (worker) {
      sendStatus(reportStatus, { status: 'ready' });
    }
    return worker;
  } catch (error) {
    workerPromise = null;
    throw error;
  }
}

export async function recognize(source, reportStatus) {
  const worker = await ensureWorker(reportStatus);
  sendStatus(reportStatus, { status: 'processing' });
  const result = await worker.recognize(source);
  sendStatus(reportStatus, { status: 'ready' });
  return result;
}

export async function terminateWorker() {
  if (workerInstance) {
    try {
      await workerInstance.terminate();
    } catch (error) {
      console.warn('Failed to terminate OCR worker', error);
    }
    workerInstance = null;
  }
  workerPromise = null;
}
