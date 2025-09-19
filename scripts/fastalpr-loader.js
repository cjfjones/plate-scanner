import { withBase } from './assetPaths.js';

const DEFAULT_ORT_VERSION = '1.22.0';

let ortLoadPromise = null;

function hasDom() {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

function toArray(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function trimValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function ensureTrailingSlash(value) {
  if (!value) {
    return '';
  }
  return value.endsWith('/') ? value : `${value}/`;
}

function getOrtSources() {
  const config = globalThis.fastAlprAssetConfig || {};
  const sources = [];
  const seen = new Set();

  const addSource = ({ scriptUrl, wasmBaseUrl, label }) => {
    const cleanedScriptUrl = trimValue(scriptUrl);
    if (!cleanedScriptUrl || seen.has(cleanedScriptUrl)) {
      return;
    }
    seen.add(cleanedScriptUrl);
    let resolvedWasmBase = trimValue(wasmBaseUrl);
    if (!resolvedWasmBase) {
      const lastSlash = cleanedScriptUrl.lastIndexOf('/');
      if (lastSlash !== -1) {
        resolvedWasmBase = cleanedScriptUrl.slice(0, lastSlash + 1);
      }
    }
    sources.push({
      scriptUrl: cleanedScriptUrl,
      wasmBaseUrl: resolvedWasmBase ? ensureTrailingSlash(resolvedWasmBase) : undefined,
      label,
    });
  };

  const addFromBase = (baseUrl, label) => {
    const cleanedBase = ensureTrailingSlash(trimValue(baseUrl));
    if (!cleanedBase) {
      return;
    }
    addSource({
      scriptUrl: `${cleanedBase}ort.all.min.js`,
      wasmBaseUrl: cleanedBase,
      label,
    });
  };

  const customSources = toArray(config.onnxRuntimeSources);
  for (const source of customSources) {
    if (!source) {
      continue;
    }
    if (typeof source === 'string') {
      addFromBase(source, 'custom base');
    } else if (typeof source === 'object') {
      addSource({
        scriptUrl: source.scriptUrl || source.url || source.src,
        wasmBaseUrl: source.wasmBaseUrl || source.baseUrl,
        label: source.label || 'custom source',
      });
    }
  }

  toArray(config.onnxRuntimeBaseUrls ?? config.onnxRuntimeBaseUrl).forEach((base) => {
    addFromBase(base, 'custom base');
  });

  toArray(config.onnxRuntimeScriptUrls ?? config.onnxRuntimeScriptUrl).forEach((script) => {
    addSource({
      scriptUrl: script,
      label: 'custom script',
    });
  });

  addFromBase(withBase('vendor/onnxruntime/'), 'local vendor');
  addFromBase(`https://cdn.jsdelivr.net/npm/onnxruntime-web@${DEFAULT_ORT_VERSION}/dist/`, 'jsDelivr CDN');
  addFromBase(`https://unpkg.com/onnxruntime-web@${DEFAULT_ORT_VERSION}/dist/`, 'unpkg CDN');

  return sources;
}

function appendScriptFromSource(source) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = source.scriptUrl;
    script.async = true;
    script.onload = () => resolve(script);
    script.onerror = (event) => {
      script.remove();
      const error = new Error(`Failed to load ONNX Runtime script: ${source.scriptUrl}`);
      error.event = event;
      reject(error);
    };
    document.head.appendChild(script);
  });
}

export async function ensureOrtRuntime(reportStatus) {
  if (globalThis.ort && typeof globalThis.ort.InferenceSession === 'function') {
    return globalThis.ort;
  }

  if (!hasDom()) {
    throw new Error('ONNX Runtime requires a DOM environment.');
  }

  if (!ortLoadPromise) {
    ortLoadPromise = (async () => {
      const sources = getOrtSources();
      const errors = [];

      for (const source of sources) {
        try {
          if (typeof reportStatus === 'function') {
            const label = source.label ? ` (${source.label})` : '';
            reportStatus({ status: 'loading', message: `Loading ONNX Runtime${label}`, progress: 0.05 });
          }
          const scriptElement = await appendScriptFromSource(source);
          const ort = globalThis.ort;
          if (!ort || typeof ort.InferenceSession !== 'function') {
            scriptElement.remove();
            throw new Error('ONNX Runtime failed to expose a global `ort` namespace.');
          }
          ort.env.wasm = ort.env.wasm || {};
          if (source.wasmBaseUrl) {
            ort.env.wasm.wasmPaths = source.wasmBaseUrl;
          }
          if (typeof navigator !== 'undefined' && Number.isFinite(navigator.hardwareConcurrency)) {
            const maxThreads = Math.max(1, Math.min(4, navigator.hardwareConcurrency));
            ort.env.wasm.numThreads = maxThreads;
          }
          if (typeof reportStatus === 'function') {
            reportStatus({ status: 'loading', message: 'ONNX Runtime ready', progress: 0.1 });
          }
          return ort;
        } catch (error) {
          console.warn(`Failed to load ONNX Runtime from ${source.scriptUrl}`, error);
          errors.push({ source, error });
        }
      }

      const details = errors
        .map((entry) => `${entry.source.scriptUrl}: ${entry.error?.message || entry.error}`)
        .join('; ');
      throw new Error(`Unable to load ONNX Runtime from any configured source. ${details}`);
    })().catch((error) => {
      ortLoadPromise = null;
      throw error;
    });
  }

  return ortLoadPromise;
}

export function resetOrtLoaderForTests() {
  ortLoadPromise = null;
}
