const UK_STANDARD_PATTERN = /^[A-Z]{2}[0-9]{2}[A-Z]{3}$/;

export function normalizePlate(text) {
  return text.replace(/[^A-Z0-9]/gi, '').toUpperCase();
}

export function formatPlate(text) {
  const normalized = normalizePlate(text);
  if (UK_STANDARD_PATTERN.test(normalized)) {
    return `${normalized.slice(0, 2)}${normalized.slice(2, 4)} ${normalized.slice(4)}`;
  }
  return normalized;
}

export function isLikelyPlate(text) {
  const normalized = normalizePlate(text);
  return UK_STANDARD_PATTERN.test(normalized);
}

export function scorePlateConfidence(text, baseConfidence) {
  const normalized = normalizePlate(text);
  let confidenceBoost = 0;
  if (UK_STANDARD_PATTERN.test(normalized)) {
    confidenceBoost += 15;
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
    isHighConfidence: UK_STANDARD_PATTERN.test(normalized),
    baseConfidence: Number(baseConfidence || 0),
  };
}
