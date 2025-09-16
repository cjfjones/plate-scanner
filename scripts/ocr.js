const CDN_BASE = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/';

let workerInstance = null;
let workerPromise = null;

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
      const worker = await Tesseract.createWorker({
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
      });

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
