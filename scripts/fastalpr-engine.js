import { withBase } from './assetPaths.js';
import { ensureOrtRuntime } from './fastalpr-loader.js';
import { wordsToDetections } from './detections.js';

const DETECTOR_MODEL_FILENAME = 'yolo-v9-t-384-license-plates-end2end.onnx';
const OCR_MODEL_FILENAME = 'global_mobile_vit_v2_ocr.onnx';
const OCR_CONFIG_FILENAME = 'global_mobile_vit_v2_ocr_config.yaml';

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

function dedupeStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const trimmed = trimValue(value);
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function buildCandidateList(overrides, baseUrls, filename) {
  const candidates = [];
  for (const override of overrides) {
    const trimmed = trimValue(override);
    if (trimmed) {
      candidates.push(trimmed);
    }
  }
  for (const base of baseUrls) {
    const normalizedBase = ensureTrailingSlash(trimValue(base));
    if (normalizedBase) {
      candidates.push(`${normalizedBase}${filename}`);
    }
  }
  return dedupeStrings(candidates);
}

function getAssetConfig() {
  const config = globalThis.fastAlprAssetConfig || {};

  const baseOverrides = toArray(config.modelBaseUrls ?? config.modelBaseUrl);
  baseOverrides.push(withBase('vendor/fastalpr/'));
  const normalizedBases = dedupeStrings(baseOverrides.map((base) => ensureTrailingSlash(trimValue(base))).filter(Boolean));

  const detectorOverrides = toArray(config.detectorModelUrls ?? config.detectorModelUrl);
  const ocrOverrides = toArray(config.ocrModelUrls ?? config.ocrModelUrl);
  const configOverrides = toArray(config.ocrConfigUrls ?? config.ocrConfigUrl);

  const detectorModelUrls = buildCandidateList(detectorOverrides, normalizedBases, DETECTOR_MODEL_FILENAME);
  const ocrModelUrls = buildCandidateList(ocrOverrides, normalizedBases, OCR_MODEL_FILENAME);

  const configCandidates = [
    ...configOverrides,
    ...normalizedBases.map((base) => `${ensureTrailingSlash(base)}${OCR_CONFIG_FILENAME}`),
    withBase(`vendor/fastalpr/${OCR_CONFIG_FILENAME}`),
  ];
  const ocrConfigUrls = dedupeStrings(configCandidates);

  return {
    detectorModelUrls,
    ocrModelUrls,
    ocrConfigUrls,
  };
}

const DETECTION_CONFIDENCE_THRESHOLD = 0.4;
const RECOGNITION_CONFIDENCE_THRESHOLD = 0.35;
const DETECTION_WEIGHT = 0.6;
const RECOGNITION_WEIGHT = 0.4;
const BOX_EXPANSION_X = 0.1;
const BOX_EXPANSION_Y = 0.2;

let enginePromise = null;

function notify(reportStatus, state) {
  if (typeof reportStatus === 'function' && state) {
    try {
      reportStatus(state);
    } catch (error) {
      console.error('Status listener failed', error);
    }
  }
}

async function fetchArrayBufferFromUrl(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.arrayBuffer();
}

async function fetchTextFromUrl(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function fetchWithFallback(urls, loader, description) {
  const candidates = toArray(urls);
  const errors = [];
  for (const candidate of candidates) {
    const url = trimValue(candidate);
    if (!url) {
      continue;
    }
    try {
      return await loader(url);
    } catch (error) {
      console.warn(`Failed to load ${description} from ${url}`, error);
      errors.push({ url, error });
    }
  }

  const detail = errors.length
    ? errors.map((entry) => `${entry.url}: ${entry.error?.message || entry.error}`).join('; ')
    : 'No candidate URLs were provided.';

  throw new Error(`Unable to load ${description}. ${detail}`);
}

function parseYamlConfig(text) {
  const result = {};
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }
    if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    } else if (value === 'true' || value === 'false') {
      value = value === 'true';
    } else if (!Number.isNaN(Number(value))) {
      value = Number(value);
    }
    result[key] = value;
  }
  return result;
}

function createCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    throw new Error('Canvas is not supported in this environment.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function get2dContext(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Failed to acquire 2D canvas context.');
  }
  return ctx;
}

function clamp(value, min, max) {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function combineConfidence(detectionScore, recognitionScore) {
  const detectionPercent = Number.isFinite(detectionScore) ? detectionScore * 100 : 0;
  const recognitionPercent = Number.isFinite(recognitionScore) ? recognitionScore * 100 : 0;
  const combined = detectionPercent * DETECTION_WEIGHT + recognitionPercent * RECOGNITION_WEIGHT;
  return clamp(combined, 0, 100);
}

function decodeOcrOutput(tensor, config) {
  const data = tensor.data;
  const dims = tensor.dims || [];
  const batchSize = dims[0] && dims[0] > 0 ? dims[0] : 1;
  const maxSlots = Number(config.max_plate_slots) || 0;
  const alphabet = typeof config.alphabet === 'string' ? config.alphabet.split('') : [];
  const vocabSize = alphabet.length;
  if (!maxSlots || !vocabSize) {
    return [];
  }
  const stride = maxSlots * vocabSize;
  const results = [];
  for (let batch = 0; batch < batchSize; batch += 1) {
    const start = batch * stride;
    const characters = [];
    const confidences = [];
    for (let slot = 0; slot < maxSlots; slot += 1) {
      const slotStart = start + slot * vocabSize;
      let bestIdx = 0;
      let bestValue = Number.NEGATIVE_INFINITY;
      for (let charIdx = 0; charIdx < vocabSize; charIdx += 1) {
        const value = data[slotStart + charIdx];
        if (value > bestValue) {
          bestValue = value;
          bestIdx = charIdx;
        }
      }
      characters.push(alphabet[bestIdx] ?? '');
      confidences.push(bestValue);
    }
    results.push({ text: characters.join(''), confidences });
  }
  return results;
}

class FastAlprEngine {
  constructor(ort, detectionSession, recognitionSession, config) {
    this.ort = ort;
    this.detectionSession = detectionSession;
    this.recognitionSession = recognitionSession;
    this.config = config;

    const detectionInputName = detectionSession.inputNames?.[0] || detectionSession.session?.inputNames?.[0];
    this.detectionInputName = detectionInputName;
    const detectionOutputName = detectionSession.outputNames?.[0] || detectionSession.session?.outputNames?.[0];
    this.detectionOutputName = detectionOutputName;
    const detectionMetadata = detectionSession.inputMetadata?.[detectionInputName];
    this.detectionDims = detectionMetadata?.dimensions || detectionMetadata?.dims || detectionSession.input?.dims;

    const recognitionInputName = recognitionSession.inputNames?.[0];
    this.recognitionInputName = recognitionInputName;
    const recognitionOutputName = recognitionSession.outputNames?.[0];
    this.recognitionOutputName = recognitionOutputName;
    const recognitionMetadata = recognitionSession.inputMetadata?.[recognitionInputName];
    this.recognitionDims = recognitionMetadata?.dimensions || recognitionMetadata?.dims;

    const targetHeight = this.detectionDims?.[2] || 384;
    const targetWidth = this.detectionDims?.[3] || 384;
    this.letterboxCanvas = createCanvas(targetWidth, targetHeight);
    this.letterboxCtx = get2dContext(this.letterboxCanvas);

    this.cropCanvas = createCanvas(1, 1);
    this.cropCtx = get2dContext(this.cropCanvas);

    const recognitionWidth = Number(config.img_width) || 140;
    const recognitionHeight = Number(config.img_height) || 70;
    this.recognitionCanvas = createCanvas(recognitionWidth, recognitionHeight);
    this.recognitionCtx = get2dContext(this.recognitionCanvas);

    this.padChar = typeof config.pad_char === 'string' ? config.pad_char : '_';
    this.alphabet = typeof config.alphabet === 'string' ? config.alphabet.split('') : [];
    this.channels = config.image_color_mode === 'rgb' ? 3 : 1;
  }

  preprocessDetection(canvas) {
    const width = canvas.width;
    const height = canvas.height;
    if (!width || !height) {
      return null;
    }

    const targetHeight = this.letterboxCanvas.height;
    const targetWidth = this.letterboxCanvas.width;
    const ctx = this.letterboxCtx;

    ctx.save();
    ctx.fillStyle = '#727272';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    const scale = Math.min(targetWidth / width, targetHeight / height);
    const newWidth = Math.round(width * scale);
    const newHeight = Math.round(height * scale);
    const dx = (targetWidth - newWidth) / 2;
    const dy = (targetHeight - newHeight) / 2;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(canvas, 0, 0, width, height, dx, dy, newWidth, newHeight);
    ctx.restore();

    const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
    const { data } = imageData;
    const planeSize = targetWidth * targetHeight;
    const tensorData = new Float32Array(planeSize * 3);
    for (let i = 0; i < planeSize; i += 1) {
      const offset = i * 4;
      const r = data[offset] / 255;
      const g = data[offset + 1] / 255;
      const b = data[offset + 2] / 255;
      tensorData[i] = r;
      tensorData[i + planeSize] = g;
      tensorData[i + 2 * planeSize] = b;
    }
    const inputTensor = new this.ort.Tensor('float32', tensorData, [1, 3, targetHeight, targetWidth]);
    return {
      tensor: inputTensor,
      ratio: [scale, scale],
      padding: [dx, dy],
    };
  }

  decodeDetections(outputTensor, ratio, padding, frameWidth, frameHeight) {
    if (!outputTensor) {
      return [];
    }
    const data = outputTensor.data;
    const dims = outputTensor.dims || [];
    const rowSize = dims[1] && dims[1] > 0 ? dims[1] : 7;
    const totalRows = dims[0] && dims[0] > 0 ? dims[0] : data.length / rowSize;
    const [scaleX, scaleY] = ratio;
    const [padX, padY] = padding;
    const detections = [];
    for (let row = 0; row < totalRows; row += 1) {
      const offset = row * rowSize;
      const score = data[offset + 6];
      if (!Number.isFinite(score) || score < DETECTION_CONFIDENCE_THRESHOLD) {
        continue;
      }
      const x1 = (data[offset + 1] - padX) / scaleX;
      const y1 = (data[offset + 2] - padY) / scaleY;
      const x2 = (data[offset + 3] - padX) / scaleX;
      const y2 = (data[offset + 4] - padY) / scaleY;

      let left = clamp(Math.min(x1, x2), 0, frameWidth);
      let right = clamp(Math.max(x1, x2), 0, frameWidth);
      let top = clamp(Math.min(y1, y2), 0, frameHeight);
      let bottom = clamp(Math.max(y1, y2), 0, frameHeight);

      const width = right - left;
      const height = bottom - top;
      if (width <= 1 || height <= 1) {
        continue;
      }

      const expandX = width * BOX_EXPANSION_X;
      const expandY = height * BOX_EXPANSION_Y;
      left = clamp(left - expandX / 2, 0, frameWidth);
      right = clamp(right + expandX / 2, 0, frameWidth);
      top = clamp(top - expandY / 2, 0, frameHeight);
      bottom = clamp(bottom + expandY / 2, 0, frameHeight);

      detections.push({
        x0: left,
        y0: top,
        x1: right,
        y1: bottom,
        score,
      });
    }
    return detections;
  }

  buildRecognitionTensor(canvas, box) {
    const width = Math.max(1, Math.round(box.x1 - box.x0));
    const height = Math.max(1, Math.round(box.y1 - box.y0));
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
      return null;
    }

    this.cropCanvas.width = width;
    this.cropCanvas.height = height;
    const cropCtx = this.cropCtx;
    cropCtx.clearRect(0, 0, width, height);
    cropCtx.drawImage(canvas, box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0, 0, 0, width, height);

    const targetWidth = this.recognitionCanvas.width;
    const targetHeight = this.recognitionCanvas.height;
    const recognitionCtx = this.recognitionCtx;
    recognitionCtx.clearRect(0, 0, targetWidth, targetHeight);
    recognitionCtx.imageSmoothingEnabled = true;
    recognitionCtx.drawImage(this.cropCanvas, 0, 0, width, height, 0, 0, targetWidth, targetHeight);

    const imageData = recognitionCtx.getImageData(0, 0, targetWidth, targetHeight);
    const { data } = imageData;
    const planeSize = targetWidth * targetHeight;
    if (this.channels === 1) {
      const grayscale = new Uint8Array(planeSize);
      for (let i = 0; i < planeSize; i += 1) {
        const offset = i * 4;
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        grayscale[i] = gray;
      }
      return new this.ort.Tensor('uint8', grayscale, [1, targetHeight, targetWidth, 1]);
    }

    const tensorData = new Uint8Array(planeSize * 3);
    for (let i = 0; i < planeSize; i += 1) {
      const offset = i * 4;
      tensorData[i] = data[offset];
      tensorData[i + planeSize] = data[offset + 1];
      tensorData[i + planeSize * 2] = data[offset + 2];
    }
    return new this.ort.Tensor('uint8', tensorData, [1, targetHeight, targetWidth, 3]);
  }

  async recogniseCandidate(canvas, box) {
    const inputTensor = this.buildRecognitionTensor(canvas, box);
    if (!inputTensor) {
      return null;
    }
    const feeds = { [this.recognitionInputName]: inputTensor };
    const outputMap = await this.recognitionSession.run(feeds);
    const outputTensor = outputMap[this.recognitionOutputName];
    const [result] = decodeOcrOutput(outputTensor, this.config);
    if (!result || !result.text) {
      return null;
    }
    const rawText = result.text.replace(/\0/g, '');
    const cleaned = rawText.split(this.padChar).join('').trim();
    if (!cleaned) {
      return null;
    }
    const confidences = Array.isArray(result.confidences) ? result.confidences : [];
    const meaningful = [];
    for (let i = 0; i < confidences.length; i += 1) {
      if (result.text[i] && result.text[i] !== this.padChar) {
        meaningful.push(confidences[i]);
      }
    }
    const averageConfidence = meaningful.length
      ? meaningful.reduce((sum, value) => sum + value, 0) / meaningful.length
      : 0;
    if (!Number.isFinite(averageConfidence) || averageConfidence < RECOGNITION_CONFIDENCE_THRESHOLD) {
      return null;
    }
    return {
      text: cleaned,
      averageConfidence,
    };
  }

  async process(canvas, source, reportStatus) {
    const width = canvas?.width;
    const height = canvas?.height;
    if (!width || !height) {
      return [];
    }

    notify(reportStatus, { status: 'processing' });

    const detectionInput = this.preprocessDetection(canvas);
    if (!detectionInput) {
      notify(reportStatus, { status: 'ready' });
      return [];
    }

    const feeds = { [this.detectionInputName]: detectionInput.tensor };
    const outputMap = await this.detectionSession.run(feeds);
    const outputTensor = outputMap[this.detectionOutputName];
    const candidates = this.decodeDetections(outputTensor, detectionInput.ratio, detectionInput.padding, width, height);
    if (!candidates.length) {
      notify(reportStatus, { status: 'ready' });
      return [];
    }

    const words = [];
    for (const candidate of candidates) {
      const recognition = await this.recogniseCandidate(canvas, candidate);
      if (!recognition) {
        continue;
      }
      const baseConfidence = combineConfidence(candidate.score, recognition.averageConfidence);
      words.push({
        text: recognition.text,
        confidence: baseConfidence,
        bbox: {
          x0: candidate.x0,
          y0: candidate.y0,
          x1: candidate.x1,
          y1: candidate.y1,
        },
      });
    }

    const detections = wordsToDetections(words, width, height, source);
    notify(reportStatus, { status: 'ready' });
    return detections;
  }
}

async function createFastAlprEngine(reportStatus) {
  const ort = await ensureOrtRuntime((state) => notify(reportStatus, state));
  const assetConfig = getAssetConfig();
  notify(reportStatus, { status: 'loading', message: 'Fetching detector model', progress: 0.15 });
  const [detectorBuffer, ocrBuffer, configText] = await Promise.all([
    fetchWithFallback(assetConfig.detectorModelUrls, fetchArrayBufferFromUrl, 'FastALPR detector model'),
    (async () => {
      notify(reportStatus, { status: 'loading', message: 'Fetching OCR model', progress: 0.25 });
      return fetchWithFallback(assetConfig.ocrModelUrls, fetchArrayBufferFromUrl, 'FastALPR OCR model');
    })(),
    (async () => {
      notify(reportStatus, { status: 'loading', message: 'Loading OCR config', progress: 0.3 });
      return fetchWithFallback(assetConfig.ocrConfigUrls, fetchTextFromUrl, 'FastALPR OCR config');
    })(),
  ]);

  const config = parseYamlConfig(configText);

  notify(reportStatus, { status: 'loading', message: 'Initialising detector', progress: 0.4 });
  const detectionSession = await ort.InferenceSession.create(detectorBuffer, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });

  notify(reportStatus, { status: 'loading', message: 'Initialising recogniser', progress: 0.6 });
  const recognitionSession = await ort.InferenceSession.create(ocrBuffer, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });

  notify(reportStatus, { status: 'ready', message: 'ALPR ready', progress: 1 });
  return new FastAlprEngine(ort, detectionSession, recognitionSession, config);
}

export async function ensureFastAlpr(reportStatus) {
  if (!enginePromise) {
    enginePromise = createFastAlprEngine(reportStatus).catch((error) => {
      enginePromise = null;
      throw error;
    });
  }
  return enginePromise;
}

export async function analyzeWithFastAlpr(canvas, source, reportStatus) {
  const engine = await ensureFastAlpr(reportStatus);
  return engine.process(canvas, source, reportStatus);
}

export function resetFastAlprForTests() {
  enginePromise = null;
}
