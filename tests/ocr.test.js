import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { LOCAL_ASSET_BASE } = vi.hoisted(() => {
  const baseUrl = import.meta.env?.BASE_URL ?? '/';
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return { LOCAL_ASSET_BASE: `${normalizedBase}vendor/tesseract/` };
});

vi.mock('../scripts/tesseract-loader.js', () => {
  const loadTesseract = vi.fn().mockResolvedValue({
    name: 'local',
    assetBaseUrl: LOCAL_ASSET_BASE,
    failureStatus: {
      status: 'loading',
      message: 'Retrying OCR engine download from an alternate source',
      progress: 0.18,
    },
  });
  const getWorkerSources = vi.fn(() => [
    {
      name: 'local',
      assetBaseUrl: LOCAL_ASSET_BASE,
      failureStatus: {
        status: 'loading',
        message: 'Retrying OCR engine download from an alternate source',
        progress: 0.18,
      },
    },
    {
      name: 'jsdelivr',
      assetBaseUrl: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/',
      corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.0/tesseract-core.wasm.js',
      failureStatus: {
        status: 'loading',
        message: 'Retrying OCR engine download from an alternate CDN',
        progress: 0.18,
      },
    },
    {
      name: 'cdnjs',
      assetBaseUrl: 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.0.0/',
      corePath: 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js-core/5.0.0/tesseract-core.wasm.js',
      failureStatus: {
        status: 'loading',
        message: 'Retrying OCR engine download from an alternate CDN',
        progress: 0.18,
      },
    },
    {
      name: 'unpkg',
      assetBaseUrl: 'https://unpkg.com/tesseract.js@5/dist/',
      corePath: 'https://unpkg.com/tesseract.js-core@5.0.0/tesseract-core.wasm.js',
      failureStatus: {
        status: 'loading',
        message: 'Retrying OCR engine download from an alternate CDN',
        progress: 0.18,
      },
    },
  ]);

  return { loadTesseract, getWorkerSources };
});

import { ensureWorker, terminateWorker } from '../scripts/ocr.js';
import { loadTesseract, getWorkerSources } from '../scripts/tesseract-loader.js';

function createWorkerStub() {
  return {
    load: vi.fn().mockResolvedValue(),
    loadLanguage: vi.fn().mockResolvedValue(),
    initialize: vi.fn().mockResolvedValue(),
    recognize: vi.fn(),
    terminate: vi.fn().mockResolvedValue(),
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ensureWorker fallback behaviour', () => {
  let originalNavigator;
  let originalTesseract;

  beforeEach(() => {
    originalNavigator = globalThis.navigator;
    originalTesseract = globalThis.Tesseract;
    vi.useFakeTimers();
    loadTesseract.mockClear();
    getWorkerSources.mockClear();
    loadTesseract.mockResolvedValue({
      name: 'local',
      assetBaseUrl: LOCAL_ASSET_BASE,
      failureStatus: {
        status: 'loading',
        message: 'Retrying OCR engine download from an alternate source',
        progress: 0.18,
      },
    });
    getWorkerSources.mockReturnValue([
      {
        name: 'local',
        assetBaseUrl: LOCAL_ASSET_BASE,
        failureStatus: {
          status: 'loading',
          message: 'Retrying OCR engine download from an alternate source',
          progress: 0.18,
        },
      },
      {
        name: 'jsdelivr',
        assetBaseUrl: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.0/tesseract-core.wasm.js',
        failureStatus: {
          status: 'loading',
          message: 'Retrying OCR engine download from an alternate CDN',
          progress: 0.18,
        },
      },
      {
        name: 'cdnjs',
        assetBaseUrl: 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.0.0/',
        corePath: 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js-core/5.0.0/tesseract-core.wasm.js',
        failureStatus: {
          status: 'loading',
          message: 'Retrying OCR engine download from an alternate CDN',
          progress: 0.18,
        },
      },
      {
        name: 'unpkg',
        assetBaseUrl: 'https://unpkg.com/tesseract.js@5/dist/',
        corePath: 'https://unpkg.com/tesseract.js-core@5.0.0/tesseract-core.wasm.js',
        failureStatus: {
          status: 'loading',
          message: 'Retrying OCR engine download from an alternate CDN',
          progress: 0.18,
        },
      },
    ]);
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (originalNavigator === undefined) {
      delete globalThis.navigator;
    } else {
      globalThis.navigator = originalNavigator;
    }
    if (originalTesseract === undefined) {
      delete globalThis.Tesseract;
    } else {
      globalThis.Tesseract = originalTesseract;
    }
    await terminateWorker();
  });

  it('falls back to a non-blob worker when Safari creation stalls', async () => {
    const workerStub = createWorkerStub();
    const createWorker = vi
      .fn()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockImplementationOnce(() => Promise.resolve(workerStub));

    globalThis.Tesseract = { createWorker };
    globalThis.navigator = {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      vendor: 'Apple Computer, Inc.',
    };

    const promise = ensureWorker();
    await vi.advanceTimersByTimeAsync(10000);
    const worker = await promise;

    expect(worker).toBe(workerStub);
    expect(createWorker).toHaveBeenCalledTimes(2);
    expect(createWorker.mock.calls[1][2].workerBlobURL).toBe(false);
  });

  it('allows the Safari fallback worker extra time to initialise', async () => {
    const workerStub = createWorkerStub();
    const fallbackDeferred = createDeferred();
    const createWorker = vi
      .fn()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockImplementationOnce(() => fallbackDeferred.promise);

    globalThis.Tesseract = { createWorker };
    globalThis.navigator = {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      vendor: 'Apple Computer, Inc.',
    };

    const promise = ensureWorker();
    await vi.advanceTimersByTimeAsync(10000);
    await vi.advanceTimersByTimeAsync(50000);
    fallbackDeferred.resolve(workerStub);
    const worker = await promise;

    expect(worker).toBe(workerStub);
    expect(createWorker).toHaveBeenCalledTimes(2);
  });

  it('keeps the default worker attempt alive for slower networks', async () => {
    const workerStub = createWorkerStub();
    const createWorker = vi.fn(
      () =>
        new Promise((resolve) => {
          globalThis.setTimeout(() => resolve(workerStub), 45000);
        }),
    );

    globalThis.Tesseract = { createWorker };
    globalThis.navigator = {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      vendor: 'Google Inc.',
    };

    const workerPromise = ensureWorker();
    await vi.advanceTimersByTimeAsync(45000);
    const worker = await workerPromise;

    expect(worker).toBe(workerStub);
    expect(createWorker).toHaveBeenCalledTimes(1);
  });

  it('falls back to an alternate CDN when the primary worker assets fail', async () => {
    const workerStub = createWorkerStub();
    const createWorker = vi
      .fn()
      .mockRejectedValueOnce(new Error('CDN blocked'))
      .mockResolvedValue(workerStub);

    globalThis.Tesseract = { createWorker };
    globalThis.navigator = {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      vendor: 'Google Inc.',
    };

    const worker = await ensureWorker();

    expect(loadTesseract).toHaveBeenCalled();
    expect(worker).toBe(workerStub);
    expect(createWorker).toHaveBeenCalledTimes(2);
    const primaryOptions = createWorker.mock.calls[0][2];
    const fallbackOptions = createWorker.mock.calls[1][2];
    expect(primaryOptions.workerPath).toBe(`${LOCAL_ASSET_BASE}worker.min.js`);
    expect(primaryOptions.corePath).toBe(`${LOCAL_ASSET_BASE}tesseract-core.wasm.js`);
    expect(primaryOptions.langPath).toBe(`${LOCAL_ASSET_BASE}langs/`);
    expect(fallbackOptions.workerPath).toBe('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js');
    expect(fallbackOptions.corePath).toBe(
      'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.0/tesseract-core.wasm.js',
    );
    expect(fallbackOptions.langPath).toBe('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/langs/');
  });

  it('tries each CDN core path in order when worker initialization fails repeatedly', async () => {
    const workerStub = createWorkerStub();
    const createWorker = vi
      .fn()
      .mockRejectedValueOnce(new Error('local offline'))
      .mockRejectedValueOnce(new Error('jsdelivr blocked'))
      .mockRejectedValueOnce(new Error('cdnjs blocked'))
      .mockResolvedValue(workerStub);

    globalThis.Tesseract = { createWorker };
    globalThis.navigator = {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      vendor: 'Google Inc.',
    };

    const worker = await ensureWorker();

    expect(loadTesseract).toHaveBeenCalled();
    expect(worker).toBe(workerStub);
    expect(createWorker).toHaveBeenCalledTimes(4);

    const jsdelivrOptions = createWorker.mock.calls[1][2];
    expect(jsdelivrOptions.workerPath).toBe('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js');
    expect(jsdelivrOptions.corePath).toBe(
      'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.0/tesseract-core.wasm.js',
    );
    expect(jsdelivrOptions.langPath).toBe('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/langs/');

    const cdnjsOptions = createWorker.mock.calls[2][2];
    expect(cdnjsOptions.workerPath).toBe('https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.0.0/worker.min.js');
    expect(cdnjsOptions.corePath).toBe(
      'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js-core/5.0.0/tesseract-core.wasm.js',
    );
    expect(cdnjsOptions.langPath).toBe('https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.0.0/langs/');

    const unpkgOptions = createWorker.mock.calls[3][2];
    expect(unpkgOptions.workerPath).toBe('https://unpkg.com/tesseract.js@5/dist/worker.min.js');
    expect(unpkgOptions.corePath).toBe('https://unpkg.com/tesseract.js-core@5.0.0/tesseract-core.wasm.js');
    expect(unpkgOptions.langPath).toBe('https://unpkg.com/tesseract.js@5/dist/langs/');
  });
});
