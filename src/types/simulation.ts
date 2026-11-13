export type Season = 'autumn' | 'spring' | 'winter';

export type InteractionMode =
  | 'Wind Gust'
  | 'Tornado'
  | 'Parting'
  | 'Fluid Push/Pull'
  | 'Seismic Ripple'
  | 'Aurora Field';

export type InteractionContext = 'All' | 'Trees Only' | 'Water Only' | 'Ground Only';

export type InputSourceType = 'pointer' | 'hands' | 'ble' | 'websocket' | 'playback';

export interface SimulationParams {
  season: Season;
  riverWidth: number;
  terrainRoughness: number;
  treeScale: number;
  treeDensity: number;
  plantType: 'Oak' | 'Pine' | 'Bush';
  interactionMode: InteractionMode;
  interactionContext: InteractionContext;
  interactionRadius: number;
  interactionForce: number;
  windStrength: number;
  windDirection: number;
  sunElevation: number;
  sunAzimuth: number;
  fogDensity: number;
  bloomStrength: number;
}

export interface ChapterDefinition {
  id: number;
  shortLabel: string;
  accessionCode: string;
  title: string;
  desc: string;
  interactionMode: InteractionMode;
  interactionContext: InteractionContext;
  season: Season;
  windStrength: number;
  fogDensity: number;
  sunElevation: number;
  bloomStrength: number;
}

export interface InputFrame {
  source: InputSourceType;
  /** Normalized device coordinates in [-1, 1] */
  ndcX: number;
  ndcY: number;
  /** Force multiplier in [0.1, 3.0] */
  force: number;
  /** Optional wind override from sensor stream */
  windStrength?: number;
  active: boolean;
  timestamp: number;
}

export interface SensorSample {
  tMs: number;
  x: number;
  y: number;
  force: number;
  windStrength?: number;
}

export interface SensorRecording {
  name: string;
  samples: SensorSample[];
  durationMs: number;
}

export interface PlaybackStatus {
  hasRecording: boolean;
  fileName: string;
  sampleCount: number;
  playing: boolean;
  loop: boolean;
  speed: number;
  currentTimeMs: number;
  durationMs: number;
  lastSample: SensorSample | null;
  error: string | null;
}

export type HandTrackingStatus = 'idle' | 'starting' | 'active' | 'error';

export interface HandTrackingState {
  status: HandTrackingStatus;
  handDetected: boolean;
  pinchStrength: number;
  error: string | null;
}

export type HardwareStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface HardwareConnectionState {
  bleStatus: HardwareStatus;
  bleDeviceName: string | null;
  bleError: string | null;
  wsStatus: HardwareStatus;
  wsUrl: string;
  wsError: string | null;
  packetCount: number;
  lastPacket: string | null;
}

export interface RecordingStatus {
  isRecording: boolean;
  elapsedSec: number;
  error: string | null;
}

export interface SimulationHUDState {
  chapterIndex: number;
  interactionMode: InteractionMode;
  interactionContext: InteractionContext;
  activeSource: InputSourceType;
  attractMode: boolean;
  audioEnabled: boolean;
  audioMuted: boolean;
  cursorNdc: { x: number; y: number };
  cursorSpeed: number;
  windStrength: number;
  interactionRadius: number;
  handTracking: HandTrackingState;
  hardware: HardwareConnectionState;
  playback: PlaybackStatus;
  recording: RecordingStatus;
  webglLost: boolean;
  isSoftwareGl: boolean;
}
