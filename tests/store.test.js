import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlateStore } from '../scripts/store.js';

const STORAGE_KEY = 'passingplates.records.v1';

function buildDetection(overrides = {}) {
  return {
    plate: 'AB12CDE',
    formattedPlate: 'AB12 CDE',
    confidence: 88,
    source: 'camera',
    capturedAt: Date.now(),
    ...overrides,
  };
}

describe('createPlateStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-02T03:04:05Z'));
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists and returns detections', () => {
    const store = createPlateStore();
    const detection = buildDetection();
    store.addDetection(detection);

    const records = store.getRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      plate: 'AB12CDE',
      count: 1,
      firstSeen: detection.capturedAt,
      lastSeen: detection.capturedAt,
      lastConfidence: detection.confidence,
      lastSource: detection.source,
    });

    const persisted = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    expect(persisted).toHaveLength(1);
    expect(persisted[0].plate).toBe('AB12CDE');
  });

  it('updates existing records instead of creating duplicates', () => {
    const store = createPlateStore();
    const first = buildDetection();
    store.addDetection(first);

    vi.setSystemTime(new Date('2024-01-02T05:00:00Z'));
    const second = buildDetection({
      confidence: 70,
      capturedAt: Date.now(),
      source: 'upload',
    });
    store.addDetection(second);

    const records = store.getRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      count: 2,
      lastSeen: second.capturedAt,
      lastConfidence: 70,
      lastSource: 'upload',
    });
  });

  it('computes stats for the stored history', () => {
    const store = createPlateStore();
    const first = buildDetection();
    store.addDetection(first);

    vi.setSystemTime(new Date('2024-01-02T03:30:00Z'));
    store.addDetection(
      buildDetection({
        capturedAt: Date.now(),
        confidence: 60,
      }),
    );

    vi.setSystemTime(new Date('2024-01-02T04:00:00Z'));
    store.addDetection(
      buildDetection({
        capturedAt: Date.now(),
        confidence: 55,
        plate: 'ZZ99ZZZ',
        formattedPlate: 'ZZ99 ZZZ',
      }),
    );

    const stats = store.getStats();
    expect(stats.uniquePlates).toBe(2);
    expect(stats.totalSightings).toBe(3);
    expect(stats.mostSeenPlate.plate).toBe('AB12CDE');
    expect(stats.mostSeenPlate.count).toBe(2);
    expect(stats.recentPlate.plate).toBe('ZZ99ZZZ');
  });

  it('resets the history and clears storage', () => {
    const store = createPlateStore();
    store.addDetection(buildDetection());
    store.reset();

    expect(store.getRecords()).toEqual([]);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY))).toEqual([]);
  });

  it('notifies subscribers with immutable snapshots', () => {
    const store = createPlateStore();
    const listener = vi.fn((records) => {
      if (records.length) {
        records[0].count = 999;
      }
    });
    const unsubscribe = store.subscribe(listener);

    store.addDetection(buildDetection());
    unsubscribe();
    store.addDetection(
      buildDetection({
        plate: 'ZZ99ZZZ',
        formattedPlate: 'ZZ99 ZZZ',
      }),
    );

    expect(listener).toHaveBeenCalledTimes(2);
    const current = store.getRecords();
    expect(current[0].count).toBe(1);
  });
});
