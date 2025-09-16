const STORAGE_KEY = 'passingplates.records.v1';

function cloneRecord(record) {
  return {
    plate: record.plate,
    formattedPlate: record.formattedPlate,
    count: Number(record.count) || 0,
    firstSeen: Number(record.firstSeen) || 0,
    lastSeen: Number(record.lastSeen) || 0,
    lastConfidence: Number(record.lastConfidence) || 0,
    lastSource: record.lastSource || 'camera',
  };
}

function loadFromStorage() {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map(cloneRecord);
  } catch (error) {
    console.warn('Failed to load plate history from storage', error);
    return [];
  }
}

function persist(records) {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch (error) {
    console.warn('Unable to persist plate history', error);
  }
}

function computeStats(records) {
  if (records.length === 0) {
    return {
      uniquePlates: 0,
      totalSightings: 0,
      mostSeenPlate: undefined,
      recentPlate: undefined,
    };
  }
  const totalSightings = records.reduce((sum, record) => sum + record.count, 0);
  const mostSeenPlate = records.reduce((prev, current) => {
    if (!prev || current.count > prev.count) {
      return current;
    }
    return prev;
  }, undefined);
  const recentPlate = [...records].sort((a, b) => b.lastSeen - a.lastSeen)[0];
  return {
    uniquePlates: records.length,
    totalSightings,
    mostSeenPlate,
    recentPlate,
  };
}

export function createPlateStore() {
  let records = loadFromStorage();
  const listeners = new Set();

  const notify = () => {
    const snapshot = records.map(cloneRecord);
    const stats = computeStats(snapshot);
    for (const listener of listeners) {
      try {
        listener(snapshot, stats);
      } catch (error) {
        console.error('Plate store listener failed', error);
      }
    }
  };

  const addDetection = (detection) => {
    if (!detection) {
      return;
    }
    const next = records.map(cloneRecord);
    const index = next.findIndex((record) => record.plate === detection.plate);
    if (index >= 0) {
      const existing = next[index];
      next[index] = {
        ...existing,
        count: existing.count + 1,
        lastSeen: detection.capturedAt,
        lastConfidence: detection.confidence,
        lastSource: detection.source,
        formattedPlate: detection.formattedPlate,
      };
    } else {
      next.push({
        plate: detection.plate,
        formattedPlate: detection.formattedPlate,
        count: 1,
        firstSeen: detection.capturedAt,
        lastSeen: detection.capturedAt,
        lastConfidence: detection.confidence,
        lastSource: detection.source,
      });
    }
    next.sort((a, b) => b.lastSeen - a.lastSeen);
    records = next;
    persist(records);
    notify();
  };

  const reset = () => {
    records = [];
    persist(records);
    notify();
  };

  const exportCsv = () => {
    if (records.length === 0 || typeof document === 'undefined') {
      return;
    }
    const rows = [
      ['plate', 'formatted_plate', 'count', 'first_seen_iso', 'last_seen_iso', 'last_confidence', 'last_source'],
      ...records.map((record) => [
        record.plate,
        record.formattedPlate,
        String(record.count),
        new Date(record.firstSeen).toISOString(),
        new Date(record.lastSeen).toISOString(),
        record.lastConfidence.toFixed(1),
        record.lastSource,
      ]),
    ];
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `passingplates-export-${new Date().toISOString()}.csv`;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const subscribe = (listener) => {
    if (typeof listener !== 'function') {
      return () => {};
    }
    listeners.add(listener);
    listener(records.map(cloneRecord), computeStats(records));
    return () => {
      listeners.delete(listener);
    };
  };

  const getRecords = () => records.map(cloneRecord);
  const getStats = () => computeStats(records.map(cloneRecord));

  return {
    addDetection,
    reset,
    exportCsv,
    subscribe,
    getRecords,
    getStats,
  };
}
