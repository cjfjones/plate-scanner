const CDN_BASE = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/';
const WORKER_CREATION_TIMEOUT_MS = 8000;

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

function isSameOrigin(url) {
  if (!url || typeof url !== 'string') {
    return true;
  }
  try {
    const base = globalThis.location?.href || 'http://localhost/';
    const resolved = new URL(url, base);
    if (!globalThis.location) {
      return true;
    }
    return resolved.origin === globalThis.location.origin;
  } catch (error) {
    console.warn('Failed to evaluate worker origin', error);
    return false;
  }
}

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
  if (!shouldTryFallback) {
    return Tesseract.createWorker(workerOptions);
  }

  let fallbackTriggered = false;
  const primaryPromise = Tesseract.createWorker(workerOptions);
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

  try {
    return await withTimeout(primaryPromise, WORKER_CREATION_TIMEOUT_MS);
  } catch (error) {
    fallbackTriggered = true;
    const sameOrigin = isSameOrigin(workerOptions.workerPath);
    if (!sameOrigin) {
      throw error;
    }
    console.warn('Retrying OCR worker initialization without blob URL', error);
    sendStatus(reportStatus, {
      status: 'loading',
      message: 'Retrying OCR engine for Safari',
      progress: 0.2,
    });
    const fallbackOptions = { ...workerOptions, workerBlobURL: false };
    return Tesseract.createWorker(fallbackOptions);
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

export async function ensureWorker(reportStatus) {
  if (workerInstance) {
    sendStatus(reportStatus, { status: 'ready' });
    return workerInstance;
  }

  if (!workerPromise) {
    workerPromise = (async () => {
      const Tesseract = getTesseract();
      sendStatus(reportStatus, { status: 'loading', message: 'Preparing OCR engine', progress: 0 });
      const workerOptions = {
        workerPath: `${CDN_BASE}worker.min.js`,
        corePath: `${CDN_BASE}tesseract-core.wasm.js`,
        langPath: `${CDN_BASE}langs/`,
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

      const worker = await createWorkerInstance(Tesseract, workerOptions, reportStatus);

      sendStatus(reportStatus, { status: 'loading', message: 'Loading OCR engine', progress: 0.4 });
      await worker.load();
      sendStatus(reportStatus, { status: 'loading', message: 'Loading English language', progress: 0.6 });
      await worker.loadLanguage('eng');
      sendStatus(reportStatus, { status: 'loading', message: 'Initializing OCR', progress: 0.8 });
      await worker.initialize('eng');
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
