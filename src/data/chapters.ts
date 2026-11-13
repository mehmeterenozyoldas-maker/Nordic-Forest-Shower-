import { ChapterDefinition, SensorRecording, SensorSample } from '../types/simulation';

export const EXHIBITION_CHAPTERS: ChapterDefinition[] = [
  {
    id: 0,
    shortLabel: '01 Wind',
    accessionCode: 'Plate I · Atmospheric Turbulence',
    title: 'The Living Forest',
    desc: 'Simplex noise gusts propagate across 1.5 million botanical particles, translating unseen atmospheric pressure gradients into organic canopy sway and directional wakes.',
    interactionMode: 'Wind Gust',
    interactionContext: 'All',
    season: 'autumn',
    windStrength: 2.0,
    fogDensity: 0.018,
    sunElevation: 0.3,
    bloomStrength: 0.9,
  },
  {
    id: 1,
    shortLabel: '02 Fluid',
    accessionCode: 'Plate II · Persistent Advection',
    title: 'The Invisible Flow',
    desc: 'Pointer, hand, or sensor motion injects momentum into a GPU velocity field. Vortices persist, curl, and drift across foliage and river water before gradually dissipating.',
    interactionMode: 'Fluid Push/Pull',
    interactionContext: 'All',
    season: 'spring',
    windStrength: 0.5,
    fogDensity: 0.012,
    sunElevation: 0.8,
    bloomStrength: 1.15,
  },
  {
    id: 2,
    shortLabel: '03 Aurora',
    accessionCode: 'Plate III · Geomagnetic Lift',
    title: 'Magnetic Skies',
    desc: 'High-altitude particles respond to localized electromagnetic lift and azimuthal curl, illuminating winter birch silhouettes with luminous aurora ribbons.',
    interactionMode: 'Aurora Field',
    interactionContext: 'All',
    season: 'winter',
    windStrength: 0.25,
    fogDensity: 0.024,
    sunElevation: -0.2,
    bloomStrength: 1.35,
  },
  {
    id: 3,
    shortLabel: '04 Seismic',
    accessionCode: 'Plate IV · Lithic Resonance',
    title: 'Seismic Earth',
    desc: 'Context filtering isolates kinetic energy exclusively to the terrain floor, propagating damped radial shockwaves through moss, slate, and bedrock strata.',
    interactionMode: 'Seismic Ripple',
    interactionContext: 'Ground Only',
    season: 'autumn',
    windStrength: 0.0,
    fogDensity: 0.015,
    sunElevation: 0.12,
    bloomStrength: 1.0,
  },
];

/**
 * Generates an authentic 18-second recorded Nordic birch-sway sensor log
 * simulating an ESP32 + MPU6050 accelerometer attached to a wind-blown branch.
 */
export function createSampleNatureRecording(): SensorRecording {
  const samples: SensorSample[] = [];
  const durationMs = 18000;
  const stepMs = 50; // 20 Hz sensor log

  for (let t = 0; t <= durationMs; t += stepMs) {
    const sec = t / 1000;
    // Coupled harmonic sway + turbulent wind burst envelope
    const gustEnvelope =
      0.5 + 0.5 * Math.sin(sec * 0.55 - 0.8) * Math.cos(sec * 0.23);
    const rawX =
      0.5 +
      0.28 * Math.sin(sec * 1.15) +
      0.11 * Math.sin(sec * 2.7 + 0.6) * gustEnvelope;
    const rawY =
      0.5 +
      0.22 * Math.cos(sec * 0.85 + 0.4) +
      0.09 * Math.sin(sec * 3.1) * gustEnvelope;

    const x = Math.max(0.05, Math.min(0.95, rawX));
    const y = Math.max(0.08, Math.min(0.92, rawY));
    const force = Number((0.7 + gustEnvelope * 1.4).toFixed(3));
    const windStrength = Number((0.6 + gustEnvelope * 2.4).toFixed(3));

    samples.push({
      tMs: t,
      x: Number(x.toFixed(4)),
      y: Number(y.toFixed(4)),
      force,
      windStrength,
    });
  }

  return {
    name: 'birch_canopy_gust_log.csv',
    samples,
    durationMs,
  };
}

export function recordingToCsvText(recording: SensorRecording): string {
  const header = 'time_ms,x,y,force,wind_strength';
  const rows = recording.samples.map(
    (s) =>
      `${s.tMs},${s.x.toFixed(4)},${s.y.toFixed(4)},${s.force.toFixed(3)},${(s.windStrength ?? 1.0).toFixed(3)}`,
  );
  return [header, ...rows].join('\n');
}
