import fs from 'fs/promises';
import path from 'path';

const ROOT_DIR = process.cwd();
const ORT_SOURCE_DIR = path.join(ROOT_DIR, 'node_modules', 'onnxruntime-web', 'dist');
const ORT_TARGET_DIR = path.join(ROOT_DIR, 'public', 'vendor', 'onnxruntime');
const ORT_MANIFEST_PATH = path.join(ORT_TARGET_DIR, 'manifest.json');
const ORT_RELATIVE_BASE = 'vendor/onnxruntime/';

const FASTALPR_TARGET_DIR = path.join(ROOT_DIR, 'public', 'vendor', 'fastalpr');
const FASTALPR_MANIFEST_PATH = path.join(FASTALPR_TARGET_DIR, 'manifest.json');
const FASTALPR_RELATIVE_BASE = 'vendor/fastalpr/';
const OCR_CONFIG_FILENAME = 'global_mobile_vit_v2_ocr_config.yaml';
const FASTALPR_CONFIG_PATH = path.join(FASTALPR_TARGET_DIR, OCR_CONFIG_FILENAME);

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

function trimValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function ensureTrailingSlash(value) {
  if (!value) {
    return '';
  }
  return value.endsWith('/') ? value : `${value}/`;
}

function buildRelativeUrl(base, filename) {
  const cleanBase = trimValue(base);
  const cleanFilename = trimValue(filename);
  if (!cleanFilename) {
    return '';
  }
  if (!cleanBase) {
    return cleanFilename;
  }
  const normalizedBase = ensureTrailingSlash(cleanBase);
  const normalizedFile = cleanFilename.startsWith('/') ? cleanFilename.slice(1) : cleanFilename;
  return `${normalizedBase}${normalizedFile}`;
}

function getBaseUrl() {
  const base = trimValue(process.env.FASTALPR_ASSET_BASE_URL);
  if (!base) {
    return null;
  }
  return ensureTrailingSlash(base);
}

async function ensureDirectory(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function copyFile(source, target) {
  await fs.copyFile(source, target);
  console.log(`Copied ${path.relative(ROOT_DIR, target)}`);
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

async function buildFileMetadata(filePath) {
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      return null;
    }
    return {
      filename: path.basename(filePath),
      bytes: stats.size,
      modified: stats.mtime.toISOString(),
    };
  } catch (error) {
    return null;
  }
}

async function readPackageVersion(packagePath) {
  try {
    const raw = await fs.readFile(packagePath, 'utf8');
    const pkg = JSON.parse(raw);
    if (pkg && typeof pkg.version === 'string') {
      return pkg.version;
    }
  } catch (error) {
    // Ignore JSON parse or file access failures.
  }
  return null;
}

function pushUnique(target, value) {
  const trimmed = trimValue(value);
  if (!trimmed || target.includes(trimmed)) {
    return;
  }
  target.push(trimmed);
}

async function updateOrtManifest(metadataEntries) {
  const filtered = metadataEntries.filter(Boolean);
  const manifest = {
    generatedAt: new Date().toISOString(),
    bundled: filtered.length === ORT_FILES.length,
    files: filtered,
    sources: [],
    baseUrls: [],
  };

  const packageJsonPath = path.join(ROOT_DIR, 'node_modules', 'onnxruntime-web', 'package.json');
  const version = await readPackageVersion(packageJsonPath);
  if (version) {
    manifest.version = version;
  }

  if (manifest.bundled) {
    pushUnique(manifest.baseUrls, ORT_RELATIVE_BASE);
  }

  await writeJson(ORT_MANIFEST_PATH, manifest);
}

async function updateFastAlprManifest({ baseUrl, downloadSources } = {}) {
  const manifest = {
    generatedAt: new Date().toISOString(),
    models: [],
    modelBaseUrls: [],
    detectorModelUrls: [],
    ocrModelUrls: [],
    ocrConfigUrls: [],
    configAvailable: false,
  };

  const downloadMap = downloadSources instanceof Map ? downloadSources : new Map();

  let completeCount = 0;
  for (const model of FASTALPR_MODELS) {
    const filePath = path.join(FASTALPR_TARGET_DIR, model.filename);
    const metadata = await buildFileMetadata(filePath);
    if (metadata) {
      metadata.path = buildRelativeUrl(FASTALPR_RELATIVE_BASE, model.filename);
      const sourceUrl = downloadMap.get(model.filename);
      if (sourceUrl) {
        metadata.sourceUrl = sourceUrl;
      }
      manifest.models.push(metadata);
      completeCount += 1;
      const targetArray = model.envVar === 'FASTALPR_DETECTOR_URL'
        ? manifest.detectorModelUrls
        : manifest.ocrModelUrls;
      pushUnique(targetArray, buildRelativeUrl(FASTALPR_RELATIVE_BASE, model.filename));
      if (sourceUrl) {
        pushUnique(targetArray, sourceUrl);
      }
    }
  }

  manifest.modelsAvailable = completeCount === FASTALPR_MODELS.length;

  if (manifest.modelsAvailable) {
    pushUnique(manifest.modelBaseUrls, FASTALPR_RELATIVE_BASE);
  }

  if (baseUrl) {
    pushUnique(manifest.modelBaseUrls, baseUrl);
    pushUnique(manifest.detectorModelUrls, buildRelativeUrl(baseUrl, FASTALPR_MODELS[0].filename));
    pushUnique(manifest.ocrModelUrls, buildRelativeUrl(baseUrl, FASTALPR_MODELS[1].filename));
    pushUnique(manifest.ocrConfigUrls, buildRelativeUrl(baseUrl, OCR_CONFIG_FILENAME));
  }

  const configMetadata = await buildFileMetadata(FASTALPR_CONFIG_PATH);
  if (configMetadata) {
    manifest.configAvailable = true;
    manifest.config = {
      ...configMetadata,
      path: buildRelativeUrl(FASTALPR_RELATIVE_BASE, OCR_CONFIG_FILENAME),
    };
    pushUnique(manifest.ocrConfigUrls, buildRelativeUrl(FASTALPR_RELATIVE_BASE, OCR_CONFIG_FILENAME));
  }

  await writeJson(FASTALPR_MANIFEST_PATH, manifest);
}

async function copyOnnxRuntimeAssets() {
  await ensureDirectory(ORT_TARGET_DIR);
  const metadataEntries = [];
  for (const file of ORT_FILES) {
    const source = path.join(ORT_SOURCE_DIR, file);
    const target = path.join(ORT_TARGET_DIR, file);
    await copyFile(source, target);
    const metadata = await buildFileMetadata(target);
    if (metadata) {
      metadata.path = buildRelativeUrl(ORT_RELATIVE_BASE, file);
    }
    metadataEntries.push(metadata);
  }
  await updateOrtManifest(metadataEntries);
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
  const explicitUrl = trimValue(process.env[envVar]);
  if (explicitUrl) {
    return explicitUrl;
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

  const downloadSources = new Map();

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
    downloadSources.set(model.filename, url);
  }

  await updateFastAlprManifest({ baseUrl, downloadSources });
}

async function main() {
  await copyOnnxRuntimeAssets();
  await prepareFastAlprModels();
}

main().catch((error) => {
  console.error('Failed to prepare ALPR assets:', error);
  process.exitCode = 1;
});
