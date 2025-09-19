import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { wordsToDetections } from '../scripts/detections.js';

describe('wordsToDetections', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-02T03:04:05Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns an empty array when inputs are missing', () => {
    expect(wordsToDetections(undefined, 0, 0, 'camera')).toEqual([]);
    expect(wordsToDetections([], 0, 0, 'camera')).toEqual([]);
  });

  it('creates detections for matched plates', () => {
    const detections = wordsToDetections(
      [
        {
          text: 'AB12 CDE',
          confidence: 67,
          bbox: { x0: 100, y0: 50, x1: 220, y1: 150 },
        },
        {
          text: 'car',
          confidence: 80,
          bbox: { x0: 0, y0: 0, x1: 1, y1: 1 },
        },
      ],
      400,
      200,
      'camera',
    );

    expect(detections).toHaveLength(1);
    const detection = detections[0];
    expect(detection.plate).toBe('AB12CDE');
    expect(detection.formattedPlate).toBe('AB12 CDE');
    expect(detection.confidence).toBe(82);
    expect(detection.source).toBe('camera');
    expect(detection.capturedAt).toBe(new Date('2024-01-02T03:04:05Z').getTime());
    expect(detection.bbox).toEqual({
      left: 0.25,
      top: 0.25,
      width: 0.3,
      height: 0.5,
    });
  });

  it('keeps the most confident detection per plate and sorts by confidence', () => {
    const results = wordsToDetections(
      [
        {
          text: 'AB12CDE',
          confidence: 50,
          bbox: { x0: 0, y0: 0, x1: 100, y1: 100 },
        },
        {
          text: 'AB12 CDE',
          confidence: 80,
          bbox: { x0: 10, y0: 10, x1: 110, y1: 110 },
        },
        {
          text: 'XYZ1234',
          confidence: 70,
          bbox: { x0: 0, y0: 0, x1: 200, y1: 200 },
        },
      ],
      200,
      200,
      'upload',
    );

    expect(results).toHaveLength(1);
    expect(results[0].plate).toBe('AB12CDE');
    expect(results[0].confidence).toBe(95);
    expect(results[0].bbox.left).toBeCloseTo(0.05);
  });
});
