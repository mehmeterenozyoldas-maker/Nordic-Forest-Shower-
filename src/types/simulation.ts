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
  terrainSeed: number;
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

export interface CameraTarget {
  theta: number;
  phi: number;
  radius: number;
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
  cameraTarget: CameraTarget;
}

export interface SavedPlantedTree {
  id: string;
  x: number;
  z: number;
  species: PlantSpecies;
  scale: number;
  plantedAt: number;
}

export interface TerrainConfig {
  seed: number;
  riverWidth: number;
  terrainRoughness: number;
  treeDensity: number;
  treeScale: number;
  baseSpecies: PlantSpecies;
}

export interface AtmosphereSnapshot {
  season: Season;
  sunElevation: number;
  sunAzimuth: number;
  fogDensity: number;
  bloomStrength: number;
  windStrength: number;
  windDirection: number;
  interactionMode: InteractionMode;
  interactionContext: InteractionContext;
}

export interface ForestPlate {
  id: string;
  accessionCode: string;
  curatorId: string;
  authorName: string;
  title: string;
  notes: string;
  visibility: 'public' | 'unlisted';
  terrainConfig: TerrainConfig;
  atmosphere: AtmosphereSnapshot;
  cameraTarget: CameraTarget;
  plantedTrees: SavedPlantedTree[];
  thumbnailDataUrl: string | null;
  likesCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AtmospherePreset {
  id: string;
  curatorId: string;
  authorName: string;
  name: string;
  isPublic: boolean;
  atmosphere: AtmosphereSnapshot;
  cameraTarget: CameraTarget;
  createdAt: string;
}

export interface CuratorProfile {
  id: string;
  handle: string;
  displayName: string;
  createdAt: string;
}

export interface WeatherStation {
  id: string;
  name: string;
  region: string;
  latitude: number;
  longitude: number;
}

export interface WeatherObservation {
  latitude: number;
  longitude: number;
  temperatureC: number;
  windSpeedKmh: number;
  windDirectionDeg: number;
  cloudCoverPct: number;
  precipitationMm: number;
  weatherCode: number;
  conditionLabel: string;
  observedAt: string;
  fallback: boolean;
}

export interface WeatherSyncState {
  enabled: boolean;
  loading: boolean;
  stationId: string;
  stationName: string;
  solarElevationDeg: number;
  observation: WeatherObservation | null;
  error: string | null;
}

export interface CollabVisitor {
  clientId: string;
  name: string;
  color: string;
}

export interface CollabState {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  roomId: string;
  selfId: string;
  selfName: string;
  selfColor: string;
  visitors: CollabVisitor[];
  error: string | null;
}

export interface KioskState {
  enabled: boolean;
  intervalSec: number;
  plateIndex: number;
  plateTotal: number;
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
  activePlateTitle: string | null;
  activePlateAuthor: string | null;
  activePlateAccession: string | null;
  season: Season;
  sunElevation: number;
  sunAzimuth: number;
  fogDensity: number;
  bloomStrength: number;
  windStrength: number;
  windDirection: number;
  interactionMode: InteractionMode;
  interactionContext: InteractionContext;
  interactionRadius: number;
  activeSource: InputSourceType;
  secondaryCursorActive: boolean;
  attractMode: boolean;
  audioEnabled: boolean;
  audioMuted: boolean;
  cursorNdc: { x: number; y: number };
  cursorSpeed: number;
  handTracking: HandTrackingState;
  hardware: HardwareConnectionState;
  playback: PlaybackStatus;
  recording: RecordingStatus;
  webxr: WebXRState;
  weather: WeatherSyncState;
  collab: CollabState;
  kiosk: KioskState;
  webglLost: boolean;
  isSoftwareGl: boolean;
}
