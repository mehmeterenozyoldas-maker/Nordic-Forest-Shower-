import { SensorRecording, SensorSample } from '../types/simulation';

export interface ParsedLivePacket {
  x?: number;
  y?: number;
  force?: number;
  windStrength?: number;
}

/**
 * Parses live hardware payloads from ESP32 / Arduino over BLE or WebSocket.
 * Supports:
 * - "0.52,0.48,1.3" (x, y, optional force, optional wind)
 * - "WIND:2.4"
 * - '{"x":0.52,"y":0.48,"force":1.3,"wind":2.1}'
 */
export function parseLiveSensorPacket(raw: string): ParsedLivePacket | null {
  const str = raw.trim();
  if (!str) return null;

  if (str.startsWith('{')) {
    try {
      const obj = JSON.parse(str) as Record<string, unknown>;
      const packet: ParsedLivePacket = {};
      if (typeof obj.x === 'number' && Number.isFinite(obj.x)) packet.x = normalizeUnit(obj.x);
      if (typeof obj.y === 'number' && Number.isFinite(obj.y)) packet.y = normalizeUnit(obj.y);
      if (typeof obj.force === 'number' && Number.isFinite(obj.force)) {
        packet.force = clamp(obj.force, 0.1, 3.0);
      }
      const windVal = obj.wind ?? obj.windStrength;
      if (typeof windVal === 'number' && Number.isFinite(windVal)) {
        packet.windStrength = clamp(windVal, 0, 5.0);
      }
      return packet;
    } catch {
      return null;
    }
  }

  if (str.toUpperCase().startsWith('WIND:')) {
    const val = parseFloat(str.slice(5));
    if (Number.isFinite(val)) {
      return { windStrength: clamp(val, 0, 5.0) };
    }
    return null;
  }

  if (str.includes(',')) {
    const parts = str.split(',').map((p) => parseFloat(p.trim()));
    if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
      const packet: ParsedLivePacket = {
        x: normalizeUnit(parts[0]),
        y: normalizeUnit(parts[1]),
      };
      if (parts.length >= 3 && Number.isFinite(parts[2])) {
        packet.force = clamp(parts[2], 0.1, 3.0);
      }
      if (parts.length >= 4 && Number.isFinite(parts[3])) {
        packet.windStrength = clamp(parts[3], 0, 5.0);
      }
      return packet;
    }
  }

  return null;
}

function normalizeUnit(val: number): number {
  // If user sends [-1, 1], map to [0, 1]; otherwise clamp [0, 1]
  if (val < 0 && val >= -1.05) {
    return clamp((val + 1) * 0.5, 0, 1);
  }
  return clamp(val, 0, 1);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Parses uploaded .csv or .json recorded nature sensor logs (e.g., Arduino SD card tree sway logs).
 * Auto-detects column headers and normalizes raw sensor ranges (e.g. MPU6050 [-16384..16384] or [-90..90]) to [0..1].
 */
export function parseRecordedNatureFile(fileName: string, content: string): SensorRecording {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error('The uploaded sensor file is empty.');
  }

  let rawSamples: Array<{ tMs?: number; x: number; y: number; force?: number; windStrength?: number }> = [];

  if (fileName.toLowerCase().endsWith('.json') || trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as unknown;
    const arr = Array.isArray(parsed)
      ? parsed
      : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { samples?: unknown[] }).samples)
        ? (parsed as { samples: unknown[] }).samples
        : null;

    if (!arr || arr.length === 0) {
      throw new Error('JSON file must contain a non-empty array or a { "samples": [...] } object.');
    }

    rawSamples = arr
      .map((item, idx) => {
        if (typeof item !== 'object' || item === null) return null;
        const r = item as Record<string, unknown>;
        const x = pickNumber(r, ['x', 'ax', 'roll', 'tiltX', 'gx']);
        const y = pickNumber(r, ['y', 'ay', 'pitch', 'tiltY', 'gy']);
        if (x === undefined || y === undefined) return null;
        const tMs = pickNumber(r, ['tMs', 'time_ms', 'timeMs', 'timestamp', 't']) ?? idx * 50;
        const force = pickNumber(r, ['force', 'magnitude', 'z', 'az', 'strength']);
        const windStrength = pickNumber(r, ['windStrength', 'wind_strength', 'wind']);
        return { tMs, x, y, force, windStrength };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);
  } else {
    const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0 && !l.trim().startsWith('#'));
    if (lines.length === 0) {
      throw new Error('CSV file contains no readable rows.');
    }

    const firstCols = lines[0].split(',').map((c) => c.trim().toLowerCase());
    const hasHeader = firstCols.some((c) => /[a-z]/.test(c));
    const startRow = hasHeader ? 1 : 0;

    let idxT = -1;
    let idxX = 0;
    let idxY = 1;
    let idxForce = -1;
    let idxWind = -1;

    if (hasHeader) {
      idxT = firstCols.findIndex((c) => ['time_ms', 'timems', 't_ms', 'time', 'timestamp', 't'].includes(c));
      const foundX = firstCols.findIndex((c) => ['x', 'ax', 'roll', 'tiltx', 'gx'].includes(c));
      const foundY = firstCols.findIndex((c) => ['y', 'ay', 'pitch', 'tilty', 'gy'].includes(c));
      idxForce = firstCols.findIndex((c) => ['force', 'magnitude', 'strength', 'z', 'az'].includes(c));
      idxWind = firstCols.findIndex((c) => ['wind_strength', 'windstrength', 'wind'].includes(c));

      if (foundX !== -1) idxX = foundX;
      else idxX = idxT === 0 ? 1 : 0;

      if (foundY !== -1) idxY = foundY;
      else idxY = idxX + 1;
    } else if (firstCols.length >= 3) {
      // Heuristic: col0 = time_ms, col1 = x, col2 = y, col3 = force
      idxT = 0;
      idxX = 1;
      idxY = 2;
      if (firstCols.length >= 4) idxForce = 3;
      if (firstCols.length >= 5) idxWind = 4;
    }

    for (let i = startRow; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => parseFloat(c.trim()));
      const x = cols[idxX];
      const y = cols[idxY];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

      const tRaw = idxT >= 0 && Number.isFinite(cols[idxT]) ? cols[idxT] : (i - startRow) * 50;
      const force = idxForce >= 0 && Number.isFinite(cols[idxForce]) ? cols[idxForce] : undefined;
      const windStrength = idxWind >= 0 && Number.isFinite(cols[idxWind]) ? cols[idxWind] : undefined;
      rawSamples.push({ tMs: tRaw, x, y, force, windStrength });
    }
  }

  if (rawSamples.length < 2) {
    throw new Error('Could not parse at least 2 valid coordinate rows (x, y).');
  }

  // Normalize timestamps to start at 0ms; convert seconds to ms if timestamps appear to be in seconds
  const t0 = rawSamples[0].tMs ?? 0;
  const tLast = rawSamples[rawSamples.length - 1].tMs ?? (rawSamples.length - 1) * 50;
  const isLikelySeconds = tLast - t0 > 0 && tLast - t0 < 300 && rawSamples.length > 25;
  const timeScale = isLikelySeconds ? 1000 : 1;

  // Check coordinate bounds so raw IMU readings (e.g. -90..90 or -16384..16384) auto-scale cleanly
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const s of rawSamples) {
    if (s.x < minX) minX = s.x;
    if (s.x > maxX) maxX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.y > maxY) maxY = s.y;
  }

  const alreadyNormalized = minX >= 0 && maxX <= 1 && minY >= 0 && maxY <= 1;
  const alreadyBipolar = !alreadyNormalized && minX >= -1 && maxX <= 1 && minY >= -1 && maxY <= 1;

  const spanX = Math.max(maxX - minX, 0.0001);
  const spanY = Math.max(maxY - minY, 0.0001);

  const samples: SensorSample[] = rawSamples.map((s, idx) => {
    const nx = alreadyNormalized
      ? s.x
      : alreadyBipolar
        ? (s.x + 1) * 0.5
        : (s.x - minX) / spanX;
    const ny = alreadyNormalized
      ? s.y
      : alreadyBipolar
        ? (s.y + 1) * 0.5
        : (s.y - minY) / spanY;

    const tMs = Math.max(0, ((s.tMs ?? idx * 50) - t0) * timeScale);
    return {
      tMs,
      x: clamp(nx, 0, 1),
      y: clamp(ny, 0, 1),
      force: clamp(s.force ?? 1.0, 0.1, 3.0),
      windStrength: s.windStrength !== undefined ? clamp(s.windStrength, 0, 5.0) : undefined,
    };
  });

  samples.sort((a, b) => a.tMs - b.tMs);
  const durationMs = Math.max(samples[samples.length - 1].tMs, 500);

  return {
    name: fileName,
    samples,
    durationMs,
  };
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const val = obj[k];
    if (typeof val === 'number' && Number.isFinite(val)) return val;
  }
  return undefined;
}

/**
 * Linearly interpolates a recorded sensor stream at `timeMs` for smooth playback at 60+ FPS.
 */
export function sampleRecordingAt(recording: SensorRecording, timeMs: number): SensorSample {
  const { samples } = recording;
  if (samples.length === 0) {
    return { tMs: 0, x: 0.5, y: 0.5, force: 1.0 };
  }
  if (timeMs <= samples[0].tMs) return samples[0];
  const last = samples[samples.length - 1];
  if (timeMs >= last.tMs) return last;

  // Binary search for bracketing interval
  let lo = 0;
  let hi = samples.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].tMs <= timeMs) lo = mid;
    else hi = mid;
  }

  const a = samples[lo];
  const b = samples[hi];
  const span = Math.max(1, b.tMs - a.tMs);
  const t = clamp((timeMs - a.tMs) / span, 0, 1);

  return {
    tMs: timeMs,
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    force: a.force + (b.force - a.force) * t,
    windStrength:
      a.windStrength !== undefined && b.windStrength !== undefined
        ? a.windStrength + (b.windStrength - a.windStrength) * t
        : a.windStrength ?? b.windStrength,
  };
}
