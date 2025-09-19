function getBaseUrl() {
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) {
    return import.meta.env.BASE_URL;
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
