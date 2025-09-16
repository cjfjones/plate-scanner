import { scorePlateConfidence, tryMatchPlate } from './plateMatcher.js';

let detectionCounter = 0;

function safeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function wordsToDetections(words, imageWidth, imageHeight, source) {
  if (!Array.isArray(words) || !imageWidth || !imageHeight) {
    return [];
  }

  const latestTimestamp = Date.now();
  const matches = new Map();

  for (const word of words) {
    if (!word || typeof word.text !== 'string') {
      continue;
    }
    const match = tryMatchPlate(word.text, word.confidence);
    if (!match) {
      continue;
    }

    const confidence = scorePlateConfidence(match.normalized, word.confidence);
    const bbox = word.bbox || {};
    const left = Math.max(0, safeNumber(bbox.x0)) / imageWidth;
    const top = Math.max(0, safeNumber(bbox.y0)) / imageHeight;
    const width = Math.max(0, safeNumber(bbox.x1) - safeNumber(bbox.x0)) / imageWidth;
    const height = Math.max(0, safeNumber(bbox.y1) - safeNumber(bbox.y0)) / imageHeight;

    const candidate = {
      id: `${match.normalized}-${latestTimestamp}-${detectionCounter++}`,
      plate: match.normalized,
      formattedPlate: match.formatted,
      confidence,
      source,
      capturedAt: latestTimestamp,
      bbox: {
        left,
        top,
        width,
        height,
      },
    };

    const existing = matches.get(match.normalized);
    if (!existing || candidate.confidence > existing.confidence) {
      matches.set(match.normalized, candidate);
    }
  }

  return Array.from(matches.values()).sort((a, b) => b.confidence - a.confidence);
}
