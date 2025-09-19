import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const ASSET_MODULE_PATH = '../scripts/assetPaths.js';

describe('assetPaths base resolution', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    document.head.innerHTML = '';
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    document.head.innerHTML = '';
  });

  it('uses import.meta.env.BASE_URL when provided', async () => {
    vi.stubEnv('BASE_URL', '/custom/');
    const { withBase } = await import(ASSET_MODULE_PATH);
    expect(withBase('vendor/model.onnx')).toBe('/custom/vendor/model.onnx');
  });

  it('normalizes document.baseURI that points to a file', async () => {
    vi.stubEnv('BASE_URL', '');
    vi.spyOn(document, 'baseURI', 'get').mockReturnValue('https://example.com/plate-scanner/index.html');
    const { withBase } = await import(ASSET_MODULE_PATH);
    expect(withBase('vendor/model.onnx')).toBe('https://example.com/plate-scanner/vendor/model.onnx');
  });

  it('appends a trailing slash when document.baseURI lacks one', async () => {
    vi.stubEnv('BASE_URL', '');
    vi.spyOn(document, 'baseURI', 'get').mockReturnValue('https://example.com/plate-scanner');
    const { withBase } = await import(ASSET_MODULE_PATH);
    expect(withBase('vendor/model.onnx')).toBe('https://example.com/plate-scanner/vendor/model.onnx');
  });
});
