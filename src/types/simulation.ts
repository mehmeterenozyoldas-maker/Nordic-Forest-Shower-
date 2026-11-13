export type Season = 'autumn' | 'spring' | 'winter';

export type ModeType = 'explore' | 'plant';

export type PlantSpecies = 'Oak' | 'Pine' | 'Bush';

export type InteractionMode =
  | 'Wind Gust'
  | 'Tornado'
  | 'Parting'
  | 'Fluid Push/Pull'
  | 'Seismic Ripple'
  | 'Aurora Field';

export type InteractionContext = 'All' | 'Trees Only' | 'Water Only' | 'Ground Only';

export type InputSourceType = 'pointer' | 'hands' | 'ble' | 'websocket' | 'playback' | 'webxr';

export interface SimulationParams {
  mode: ModeType;
  season: Season;
  riverWidth: number;
  terrainRoughness: number;
  treeScale: number;
  treeDensity: number;
  plantType: PlantSpecies;
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
  cameraTarget: {
    theta: number;
    phi: number;
    radius: number;
  };
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
  handsCount: number;
  pinchStrength: number;
  secondaryPinchStrength: number;
  twoHandZoomActive: boolean;
  chapterGestureProgress: number;
  gestureHint: string | null;
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

export interface WebXRState {
  supported: boolean;
  active: boolean;
  controllersConnected: number;
  error: string | null;
}

export interface SimulationHUDState {
  mode: ModeType;
  plantType: PlantSpecies;
  plantedCount: number;
  chapterIndex: number;
  interactionMode: InteractionMode;
  interactionContext: InteractionContext;
  activeSource: InputSourceType;
  secondaryCursorActive: boolean;
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
  webxr: WebXRState;
  webglLost: boolean;
  isSoftwareGl: boolean;
}
