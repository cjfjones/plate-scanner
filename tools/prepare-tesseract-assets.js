import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const vendorRoot = path.join(projectRoot, 'public', 'vendor', 'tesseract');
const langRoot = path.join(vendorRoot, 'langs');

async function pathExists(filePath) {
  try {
    await fs.access(filePath, fsConstants.R_OK);
    return true;
  } catch (error) {
    return false;
  }
}

async function resolveLanguageSource() {
  const langPackageRoot = path.join(projectRoot, 'node_modules', '@tesseract.js-data', 'eng');
  const candidates = ['4.0.0_best_int', '4.0.0'];

  for (const candidate of candidates) {
    const candidatePath = path.join(langPackageRoot, candidate, 'eng.traineddata.gz');
    if (await pathExists(candidatePath)) {
      return {
        source: candidatePath,
        description: `English traineddata (${candidate})`,
      };
    }
  }

  throw new Error(
    'Unable to locate eng.traineddata.gz in @tesseract.js-data/eng. Ensure the package is installed.',
  );
}

async function copyAsset({ source, destination, description }) {
  if (!(await pathExists(source))) {
    throw new Error(`Missing ${description} at ${source}. Did npm install finish successfully?`);
  }

  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
  return destination;
}

async function main() {
  const assets = [
    {
      source: path.join(projectRoot, 'node_modules', 'tesseract.js', 'dist', 'tesseract.min.js'),
      destination: path.join(vendorRoot, 'tesseract.min.js'),
      description: 'Tesseract.js browser bundle',
    },
    {
      source: path.join(projectRoot, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js'),
      destination: path.join(vendorRoot, 'worker.min.js'),
      description: 'Tesseract.js web worker',
    },
    {
      source: path.join(projectRoot, 'node_modules', 'tesseract.js-core', 'tesseract-core.wasm.js'),
      destination: path.join(vendorRoot, 'tesseract-core.wasm.js'),
      description: 'Tesseract core loader',
    },
    {
      source: path.join(projectRoot, 'node_modules', 'tesseract.js-core', 'tesseract-core.wasm'),
      destination: path.join(vendorRoot, 'tesseract-core.wasm'),
      description: 'Tesseract core WASM binary',
    },
  ];

  const languageSource = await resolveLanguageSource();
  assets.push({
    source: languageSource.source,
    destination: path.join(langRoot, 'eng.traineddata.gz'),
    description: languageSource.description,
  });

  const copied = [];
  for (const asset of assets) {
    const destination = await copyAsset(asset);
    copied.push(destination);
  }

  const relativePaths = copied.map((item) => path.relative(projectRoot, item));
  console.log(`Prepared ${relativePaths.length} Tesseract asset${relativePaths.length === 1 ? '' : 's'}:\n - ${relativePaths.join('\n - ')}`);
}

main().catch((error) => {
  console.error('\nFailed to prepare local Tesseract assets.');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
