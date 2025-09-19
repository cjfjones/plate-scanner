import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ensureWorker, terminateWorker } from '../scripts/ocr.js';

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
});
