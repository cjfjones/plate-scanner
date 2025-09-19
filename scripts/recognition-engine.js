import { analyzeWithFastAlpr, ensureFastAlpr } from './fastalpr-engine.js';
import { ensureWorker, recognize } from './ocr.js';
import { wordsToDetections } from './detections.js';

const engineState = {
  fallbackActive: false,
};

function notify(reportStatus, state) {
  if (typeof reportStatus === 'function' && state) {
    try {
      reportStatus(state);
    } catch (error) {
      console.error('Status listener failed', error);
    }
  }
}

export async function ensureRecognitionEngine(reportStatus) {
  if (!engineState.fallbackActive) {
    try {
      await ensureFastAlpr(reportStatus);
      return 'fastalpr';
    } catch (error) {
      console.warn('FastALPR initialisation failed. Falling back to OCR.', error);
      engineState.fallbackActive = true;
      notify(reportStatus, {
        status: 'loading',
        message: 'FastALPR unavailable. Falling back to OCR.',
        progress: 0.2,
      });
    }
  }

  await ensureWorker(reportStatus);
  return 'ocr';
}

async function runOcrFallback(canvas, source, reportStatus) {
  const result = await recognize(canvas, reportStatus);
  const words = Array.isArray(result?.data?.words) ? result.data.words : [];
  return wordsToDetections(words, canvas.width, canvas.height, source);
}

export async function analyzeFrame(canvas, source, reportStatus) {
  if (!engineState.fallbackActive) {
    try {
      return await analyzeWithFastAlpr(canvas, source, reportStatus);
    } catch (error) {
      console.error('FastALPR inference failed. Switching to OCR fallback.', error);
      engineState.fallbackActive = true;
      notify(reportStatus, {
        status: 'loading',
        message: 'Switching to OCR fallback',
        progress: 0.2,
      });
    }
  }
  return runOcrFallback(canvas, source, reportStatus);
}

export function resetRecognitionEngineForTests() {
  engineState.fallbackActive = false;
}
