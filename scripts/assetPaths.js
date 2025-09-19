const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

function ensureTrailingSlash(value) {
  if (!value) {
    return '/';
  }
  return value.endsWith('/') ? value : `${value}/`;
}

function normalizePathname(pathname) {
  if (!pathname) {
    return '/';
  }

  let result = pathname;
  if (!result.startsWith('/')) {
    result = `/${result}`;
  }

  if (result === '/') {
    return '/';
  }

  if (result.endsWith('/')) {
    return result;
  }

  const segments = result.split('/');
  const lastSegment = segments.pop() || '';
  const looksLikeFile = lastSegment.includes('.');

  if (!looksLikeFile) {
    segments.push(lastSegment);
    return ensureTrailingSlash(segments.join('/'));
  }

  const directory = segments.join('/');
  if (!directory || directory === '.') {
    return '/';
  }

  return ensureTrailingSlash(directory.startsWith('/') ? directory : `/${directory}`);
}

function normalizeCandidate(candidate) {
  if (!candidate || typeof candidate !== 'string') {
    return '';
  }

  const trimmed = candidate.trim();
  if (!trimmed) {
    return '';
  }

  if (SCHEME_PATTERN.test(trimmed) || trimmed.startsWith('//')) {
    try {
      const base = trimmed.startsWith('//')
        ? `${globalThis.location?.protocol || 'https:'}${trimmed}`
        : trimmed;
      const parsed = new URL(base);
      const normalizedPath = normalizePathname(parsed.pathname);
      if (parsed.origin && parsed.origin !== 'null') {
        return `${parsed.origin}${normalizedPath}`;
      }
      return normalizedPath;
    } catch (error) {
      return '';
    }
  }

  return normalizePathname(trimmed);
}

function getBaseUrl() {
  let envBase = undefined;
  if (typeof import.meta !== 'undefined' && import.meta.env && typeof import.meta.env.BASE_URL === 'string') {
    envBase = import.meta.env.BASE_URL;
    if (envBase && envBase !== '/') {
      return envBase;
    }
  }

  const candidates = [];

  if (typeof document !== 'undefined') {
    const baseElement = typeof document.querySelector === 'function' ? document.querySelector('base[href]') : null;
    if (baseElement && typeof baseElement.href === 'string') {
      candidates.push(baseElement.href);
    }
    if (typeof document.baseURI === 'string') {
      candidates.push(document.baseURI);
    }
  }

  const loc = typeof globalThis !== 'undefined' ? globalThis.location : undefined;
  if (loc) {
    if (typeof loc.href === 'string') {
      candidates.push(loc.href);
    }
    if (typeof loc.pathname === 'string') {
      candidates.push(loc.pathname);
    }
  }

  if (typeof import.meta !== 'undefined' && typeof import.meta.url === 'string') {
    try {
      const parentUrl = new URL('../', import.meta.url);
      candidates.push(parentUrl.href);
    } catch (error) {
      candidates.push(import.meta.url);
    }
  }

  for (const candidate of candidates) {
    const normalized = normalizeCandidate(candidate);
    if (normalized) {
      return normalized;
    }
  }

  if (envBase) {
    return envBase;
  }

  return '/';
}

export function withBase(path) {
  const base = getBaseUrl();
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  return `${normalizedBase}${normalizedPath}`;
}

export function getBasePath() {
  const base = withBase('');
  return base.endsWith('/') ? base : `${base}/`;
}
