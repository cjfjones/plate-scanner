const UK_EU_PATTERN = /^[A-Z]{2}[0-9]{2}[A-Z]{3}$/;
const GENERIC_PATTERN = /^[A-Z0-9]{5,8}$/;

export function normalizePlate(text) {
  return text.replace(/[^A-Z0-9]/gi, '').toUpperCase();
}

export function formatPlate(text) {
  const normalized = normalizePlate(text);
  if (normalized.length === 7 && UK_EU_PATTERN.test(normalized)) {
    return `${normalized.slice(0, 2)}${normalized.slice(2, 4)} ${normalized.slice(4)}`;
  }
  if (normalized.length === 7) {
    return `${normalized.slice(0, 4)} ${normalized.slice(4)}`;
  }
  if (normalized.length === 8) {
    return `${normalized.slice(0, 4)} ${normalized.slice(4)}`;
  }
  return normalized;
}

export function isLikelyPlate(text) {
  const normalized = normalizePlate(text);
  if (normalized.length < 5) {
    return false;
  }
  if (UK_EU_PATTERN.test(normalized)) {
    return true;
  }
  if (normalized.length === 7 && GENERIC_PATTERN.test(normalized)) {
    return true;
  }
  return GENERIC_PATTERN.test(normalized);
}

export function scorePlateConfidence(text, baseConfidence) {
  const normalized = normalizePlate(text);
  let confidenceBoost = 0;
  if (UK_EU_PATTERN.test(normalized)) {
    confidenceBoost += 10;
  } else if (GENERIC_PATTERN.test(normalized)) {
    confidenceBoost += 5;
  }
  const adjusted = Math.max(0, Math.min(100, Number(baseConfidence || 0) + confidenceBoost));
  return adjusted;
}

export function tryMatchPlate(text, baseConfidence) {
  if (!text || typeof text !== 'string') {
    return undefined;
  }
  if (!isLikelyPlate(text)) {
    return undefined;
  }
  const normalized = normalizePlate(text);
  return {
    raw: text,
    normalized,
    formatted: formatPlate(normalized),
    isHighConfidence: UK_EU_PATTERN.test(normalized),
    baseConfidence: Number(baseConfidence || 0),
  };
}
