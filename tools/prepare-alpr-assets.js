import fs from 'fs/promises';
import path from 'path';

const ROOT_DIR = process.cwd();
const ORT_SOURCE_DIR = path.join(ROOT_DIR, 'node_modules', 'onnxruntime-web', 'dist');
const ORT_TARGET_DIR = path.join(ROOT_DIR, 'public', 'vendor', 'onnxruntime');
const FASTALPR_TARGET_DIR = path.join(ROOT_DIR, 'public', 'vendor', 'fastalpr');

const ORT_FILES = [
  'ort.all.min.js',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.jsep.mjs',
];

const FASTALPR_MODELS = [
  {
    filename: 'yolo-v9-t-384-license-plates-end2end.onnx',
    envVar: 'FASTALPR_DETECTOR_URL',
    description: 'FastALPR detector ONNX model',
  },
  {
    filename: 'global_mobile_vit_v2_ocr.onnx',
    envVar: 'FASTALPR_OCR_URL',
    description: 'FastALPR OCR ONNX model',
  },
];

function getBaseUrl() {
  const base = process.env.FASTALPR_ASSET_BASE_URL;
  if (typeof base !== 'string' || !base.trim()) {
    return null;
  }
  return base.endsWith('/') ? base : `${base}/`;
}

async function ensureDirectory(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function copyFile(source, target) {
  await fs.copyFile(source, target);
  console.log(`Copied ${path.relative(ROOT_DIR, target)}`);
}

async function copyOnnxRuntimeAssets() {
  await ensureDirectory(ORT_TARGET_DIR);
  await Promise.all(
    ORT_FILES.map(async (file) => {
      const source = path.join(ORT_SOURCE_DIR, file);
      const target = path.join(ORT_TARGET_DIR, file);
      await copyFile(source, target);
    }),
  );
}

async function downloadFile(url, destination) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(destination, buffer);
  console.log(`Downloaded ${path.relative(ROOT_DIR, destination)} from ${url}`);
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    return false;
  }
}

function resolveModelUrl({ filename, envVar }) {
  const explicitUrl = process.env[envVar];
  if (explicitUrl && explicitUrl.trim()) {
    return explicitUrl.trim();
  }
  const baseUrl = getBaseUrl();
  if (baseUrl) {
    return `${baseUrl}${filename}`;
  }
  return null;
}

async function prepareFastAlprModels() {
  await ensureDirectory(FASTALPR_TARGET_DIR);

  const baseUrl = getBaseUrl();
  if (baseUrl) {
    console.log(`Using FASTALPR_ASSET_BASE_URL=${baseUrl} for model downloads.`);
  }

  for (const model of FASTALPR_MODELS) {
    const target = path.join(FASTALPR_TARGET_DIR, model.filename);
    if (await fileExists(target)) {
      console.log(`Found existing ${path.relative(ROOT_DIR, target)}, skipping download.`);
      continue;
    }
    const url = resolveModelUrl(model);
    if (!url) {
      console.warn(
        `Missing ${model.description}. Set ${model.envVar} or FASTALPR_ASSET_BASE_URL to download it automatically.`,
      );
      continue;
    }
    await downloadFile(url, target);
  }
}

async function main() {
  await copyOnnxRuntimeAssets();
  await prepareFastAlprModels();
}

main().catch((error) => {
  console.error('Failed to prepare ALPR assets:', error);
  process.exitCode = 1;
});
