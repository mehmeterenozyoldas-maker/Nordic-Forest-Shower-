import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { EXHIBITION_CHAPTERS } from '../data/chapters';
import { CollabRoomClient } from '../inputs/collabClient';
import { HandTrackerController } from '../inputs/handTracker';
import { HardwareBridge } from '../inputs/hardwareBridge';
import { parseRecordedNatureFile, sampleRecordingAt } from '../inputs/sensorParser';
import { fetchLiveWeather } from '../services/archiveApi';
import {
  AtmosphereSnapshot,
  CameraTarget,
  CollabState,
  ForestPlate,
  HandTrackingState,
  HardwareConnectionState,
  InputSourceType,
  InteractionContext,
  InteractionMode,
  KioskState,
  ModeType,
  PlantSpecies,
  PlaybackStatus,
  RecordingStatus,
  SavedPlantedTree,
  Season,
  SensorRecording,
  SimulationHUDState,
  SimulationParams,
  TerrainConfig,
  WeatherSyncState,
  WebXRState,
} from '../types/simulation';
import {
  computeSolarPosition,
  mapWeatherToAtmosphere,
  NORDIC_WEATHER_STATIONS,
} from '../utils/solar';
import { SoundscapeEngine } from './audio';
import { ContextCursorVisuals } from './cursorVisuals';
import { ParticleEnvironment, terrainHeight } from './environment';
import { FluidWakeSimulation, WakeSplatInput } from './fluidFbo';
import { buildQualityProfile, QualityProfile } from './quality';
import { CanvasRecorder } from './recorder';
import { createForestMaterial } from './shaders';
import { AmbientAtmosphereSystem, AtmospherePostShader, ImpactBurstSystem } from './vfx';
import { WebXRManager } from './webxr';

const MODE_IDS: Record<InteractionMode, number> = {
  'Wind Gust': 0,
  Tornado: 1,
  Parting: 2,
  'Fluid Push/Pull': 3,
  'Seismic Ripple': 4,
  'Aurora Field': 5,
};

const INTERACTION_MODES_ORDER: InteractionMode[] = [
  'Fluid Push/Pull',
  'Wind Gust',
  'Tornado',
  'Parting',
  'Aurora Field',
  'Seismic Ripple',
];

const PLANT_SPECIES_ORDER: PlantSpecies[] = ['Oak', 'Pine', 'Bush'];

const CONTEXT_IDS: Record<InteractionContext, number> = {
  All: 0,
  'Trees Only': 1,
  'Water Only': 2,
  'Ground Only': 3,
};

function seasonToWeights(season: Season, out: THREE.Vector3): void {
  if (season === 'autumn') out.set(1, 0, 0);
  else if (season === 'spring') out.set(0, 1, 0);
  else out.set(0, 0, 1);
}

export class SimulationController {
  private readonly mountEl: HTMLElement;
  private readonly profile: QualityProfile;
  private readonly isSoftwareGl: boolean;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly composer: EffectComposer | null = null;
  private readonly bloomPass: UnrealBloomPass | null = null;
  private readonly atmospherePass: ShaderPass | null = null;

  private readonly fluidFbo: FluidWakeSimulation;
  private readonly environment: ParticleEnvironment;
  private readonly forestMaterial: THREE.ShaderMaterial;
  private readonly points: THREE.Points;
  private readonly cursorVisuals: ContextCursorVisuals;
  private readonly ambientVfx: AmbientAtmosphereSystem;
  private readonly burstVfx: ImpactBurstSystem;
  private readonly webxr: WebXRManager;

  private readonly audio: SoundscapeEngine;
  private readonly recorder: CanvasRecorder;
  private readonly handTracker: HandTrackerController;
  private readonly hardware: HardwareBridge;
  private readonly collab: CollabRoomClient;

  private readonly params: SimulationParams;
  private chapterIndex = 0;
  private plantedCount = 0;
  private activePlateTitle: string | null = null;
  private activePlateAuthor: string | null = null;
  private activePlateAccession: string | null = null;

  // Input state (normalized & damped)
  private activeSource: InputSourceType = 'pointer';
  private pointerActive = false;
  private pointerNdc = { x: 0, y: 0 };

  private handReading = {
    active: false,
    x: 0,
    y: 0,
    force: 1.0,
    pinch: 0,
    active2: false,
    x2: 0,
    y2: 0,
    force2: 1.0,
  };
  private handPlantCooldown = 0;

  private hardwareReading = {
    active: false,
    source: 'ble' as 'ble' | 'websocket',
    x: 0,
    y: 0,
    force: 1.0,
    lastReceivedAt: 0,
  };

  // Recorded Nature File Playback
  private recording: SensorRecording | null = null;
  private playbackState: PlaybackStatus = {
    hasRecording: false,
    fileName: '',
    sampleCount: 0,
    playing: false,
    loop: true,
    speed: 1.0,
    currentTimeMs: 0,
    durationMs: 0,
    lastSample: null,
    error: null,
  };

  // Weather & Solar Sync
  private weatherState: WeatherSyncState = {
    enabled: false,
    loading: false,
    stationId: 'tromso',
    stationName: 'Tromsø',
    solarElevationDeg: 0,
    observation: null,
    error: null,
  };
  private weatherLat = NORDIC_WEATHER_STATIONS[0].latitude;
  private weatherLon = NORDIC_WEATHER_STATIONS[0].longitude;
  private weatherTimer: number | null = null;

  // Collaborative Live Room
  private collabState: CollabState;

  // Kiosk Projection Mode
  private kioskPlates: ForestPlate[] = [];
  private kioskTimer: number | null = null;
  private kioskState: KioskState = {
    enabled: false,
    intervalSec: 45,
    plateIndex: 0,
    plateTotal: 0,
  };

  // Camera Choreography & Navigation
  private readonly keys: Record<string, boolean> = {
    w: false,
    a: false,
    s: false,
    d: false,
    q: false,
    e: false,
  };
  private camTheta = EXHIBITION_CHAPTERS[0].cameraTarget.theta;
  private camPhi = EXHIBITION_CHAPTERS[0].cameraTarget.phi;
  private camRadius = EXHIBITION_CHAPTERS[0].cameraTarget.radius;

  private flythroughActive = false;
  private targetCamTheta = this.camTheta;
  private targetCamPhi = this.camPhi;
  private targetCamRadius = this.camRadius;
  private targetBloom = EXHIBITION_CHAPTERS[0].bloomStrength;
  private targetFog = EXHIBITION_CHAPTERS[0].fogDensity;
  private targetSunElevation = EXHIBITION_CHAPTERS[0].sunElevation;
  private targetSunAzimuth = 0.5;
  private targetWindStrength = EXHIBITION_CHAPTERS[0].windStrength;
  private targetWindDirection = 0.0;

  private attractMode = false;
  private lastInteractionTime = Date.now();
  private readonly attractTimeoutMs = 10_000;

  // Pre-allocated math scratchpads (Zero GC in render loop)
  private readonly raycaster = new THREE.Raycaster();
  private readonly _ndc = new THREE.Vector2(0, 0);
  private readonly _ndc2 = new THREE.Vector2(0, 0);
  private readonly _planeView = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private readonly _planeGround = new THREE.Plane(new THREE.Vector3(0, 1, 0), 2.0);
  private readonly _plantHit = new THREE.Vector3();

  private readonly _targetMouse3D = new THREE.Vector3(999, 999, 999);
  private readonly _currentMouse3D = new THREE.Vector3(999, 999, 999);
  private readonly _lastMouse3D = new THREE.Vector3(999, 999, 999);
  private readonly _mouseVel = new THREE.Vector3(0, 0, 0);

  private readonly _targetMouse2_3D = new THREE.Vector3(999, 999, 999);
  private readonly _currentMouse2_3D = new THREE.Vector3(999, 999, 999);
  private readonly _lastMouse2_3D = new THREE.Vector3(999, 999, 999);
  private readonly _mouseVel2 = new THREE.Vector3(0, 0, 0);

  private readonly _sunColor = new THREE.Color();
  private readonly _sunWorld = new THREE.Vector3();
  private readonly _sunProj = new THREE.Vector3();
  private readonly _seasonWeights = new THREE.Vector3(1, 0, 0);
  private readonly _targetSeasonWeights = new THREE.Vector3(1, 0, 0);
  private readonly _shakeOffset = new THREE.Vector3();

  private readonly _splatA: WakeSplatInput = {
    worldPos: new THREE.Vector3(999, 999, 999),
    velocity: new THREE.Vector3(),
    radiusWorld: 5.5,
    force: 0,
    active: false,
  };
  private readonly _splatB: WakeSplatInput = {
    worldPos: new THREE.Vector3(999, 999, 999),
    velocity: new THREE.Vector3(),
    radiusWorld: 5.5,
    force: 0,
    active: false,
  };
  private readonly _remoteSplats: WakeSplatInput[] = [
    {
      worldPos: new THREE.Vector3(999, 999, 999),
      velocity: new THREE.Vector3(),
      radiusWorld: 5.0,
      force: 0,
      active: false,
    },
    {
      worldPos: new THREE.Vector3(999, 999, 999),
      velocity: new THREE.Vector3(),
      radiusWorld: 5.0,
      force: 0,
      active: false,
    },
  ];

  private smoothedNdcX = 0;
  private smoothedNdcY = 0;
  private smoothedForce = 1.0;
  private smoothedNdc2X = 0;
  private smoothedNdc2Y = 0;
  private smoothedForce2 = 1.0;
  private lastCursorSpeed = 0;
  private lastBurstAt = 0;

  // Loop & Lifecycle
  private readonly clock = new THREE.Clock();
  private frameId = 0;
  private disposed = false;
  private webglLost = false;
  private lastHudEmit = 0;
  private onHudUpdate: (state: SimulationHUDState) => void;

  // Stored state mirrors
  private handState: HandTrackingState = {
    status: 'idle',
    handDetected: false,
    handsCount: 0,
    pinchStrength: 0,
    secondaryPinchStrength: 0,
    twoHandZoomActive: false,
    chapterGestureProgress: 0,
    gestureHint: null,
    error: null,
  };
  private webxrState: WebXRState = {
    supported: false,
    active: false,
    controllersConnected: 0,
    error: null,
  };
  private hardwareState: HardwareConnectionState;
  private recordingState: RecordingStatus = {
    isRecording: false,
    elapsedSec: 0,
    error: null,
  };

  constructor(mountEl: HTMLElement, onHudUpdate: (state: SimulationHUDState) => void) {
    this.mountEl = mountEl;
    this.onHudUpdate = onHudUpdate;
    this.profile = buildQualityProfile();
    this.isSoftwareGl = this.profile.isSoftwareGl;
    this.audio = new SoundscapeEngine(this.profile.audioPanningModel);

    const ch0 = EXHIBITION_CHAPTERS[0];
    this.params = {
      terrainSeed: 104729,
      mode: 'explore',
      season: ch0.season,
      riverWidth: 4.0,
      terrainRoughness: 2.0,
      treeScale: 0.7,
      treeDensity: this.profile.treeDensity,
      plantType: 'Oak',
      interactionMode: ch0.interactionMode,
      interactionContext: ch0.interactionContext,
      interactionRadius: 5.5,
      interactionForce: 1.0,
      windStrength: ch0.windStrength,
      windDirection: 0.0,
      sunElevation: ch0.sunElevation,
      sunAzimuth: 0.5,
      fogDensity: ch0.fogDensity,
      bloomStrength: ch0.bloomStrength,
    };
    seasonToWeights(this.params.season, this._seasonWeights);
    seasonToWeights(this.params.season, this._targetSeasonWeights);

    const width = mountEl.clientWidth || window.innerWidth;
    const height = mountEl.clientHeight || window.innerHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.scene.fog = new THREE.FogExp2(0x000000, this.params.fogDensity);

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    this.camera.position.set(0, 12, 35);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl && !this.profile.isQuestOrMobile,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.profile.useComposer ? 1.08 : 1.18;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.profile.maxPixelRatio));
    this.renderer.setSize(width, height);
    this.mountEl.appendChild(this.renderer.domElement);

    // WebXR Manager tuned for Meta Quest 3S
    this.webxr = new WebXRManager(
      this.renderer,
      this.scene,
      this.camera,
      this.profile,
      (state) => {
        this.webxrState = state;
        this.emitHud(true);
      },
      {
        onToggleMode: () => {
          this.setMode(this.params.mode === 'explore' ? 'plant' : 'explore');
        },
        onCycleSecondary: () => {
          if (this.params.mode === 'plant') {
            const idx = PLANT_SPECIES_ORDER.indexOf(this.params.plantType);
            this.setPlantType(PLANT_SPECIES_ORDER[(idx + 1) % PLANT_SPECIES_ORDER.length]);
          } else {
            const idx = INTERACTION_MODES_ORDER.indexOf(this.params.interactionMode);
            this.setInteractionMode(INTERACTION_MODES_ORDER[(idx + 1) % INTERACTION_MODES_ORDER.length]);
          }
        },
        onClearWakes: () => {
          this.clearFluidWakes();
        },
      },
    );

    // GPU Ping-Pong Fluid Wake FBO
    this.fluidFbo = new FluidWakeSimulation(this.renderer, this.profile.fboResolution);

    // Adaptive Particle Environment
    this.environment = new ParticleEnvironment(this.params, this.profile);
    this.forestMaterial = createForestMaterial(
      this.fluidFbo.texture,
      this.profile.pointScale,
      this.profile.maxPointSize,
    );
    this.points = new THREE.Points(this.environment.geometry, this.forestMaterial);
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    // Ambient VFX & Burst Droplets
    this.ambientVfx = new AmbientAtmosphereSystem(
      this.fluidFbo.texture,
      this.profile.ambientVfxCount,
      this.profile.pointScale,
    );
    this.scene.add(this.ambientVfx.points);

    this.burstVfx = new ImpactBurstSystem(this.profile.burstCapacity, this.profile.pointScale);
    this.scene.add(this.burstVfx.points);

    // Context-Aware Dual + Remote 3D Cursors & Trails
    this.cursorVisuals = new ContextCursorVisuals(this.profile.pointScale);
    this.scene.add(this.cursorVisuals.group);

    // Post-Processing Composer (Desktop GPUs only; bypassed on Quest 3S / Mobile / Software WebGL)
    if (this.profile.useComposer) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.setSize(width, height);
      const renderPass = new RenderPass(this.scene, this.camera);
      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(width, height),
        this.params.bloomStrength,
        0.65,
        0.22,
      );
      this.atmospherePass = new ShaderPass(AtmospherePostShader);
      const outputPass = new OutputPass();
      this.composer.addPass(renderPass);
      this.composer.addPass(this.bloomPass);
      this.composer.addPass(this.atmospherePass);
      this.composer.addPass(outputPass);
    }

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    // Subsystems
    this.recorder = new CanvasRecorder((status) => {
      this.recordingState = status;
      this.emitHud(true);
    });

    this.handTracker = new HandTrackerController(
      (reading) => {
        this.handReading.active = reading.primary.detected;
        if (reading.primary.detected) {
          this.handReading.x = reading.primary.ndcX;
          this.handReading.y = reading.primary.ndcY;
          this.handReading.force = reading.primary.force;
          this.handReading.pinch = reading.primary.pinchStrength;
          this.registerActivity();
        }
        this.handReading.active2 = reading.secondary.detected;
        if (reading.secondary.detected) {
          this.handReading.x2 = reading.secondary.ndcX;
          this.handReading.y2 = reading.secondary.ndcY;
          this.handReading.force2 = reading.secondary.force;
        }
        if (reading.twoHandZoomActive && Math.abs(reading.zoomDelta) > 0.001) {
          this.flythroughActive = false;
          this.camRadius = THREE.MathUtils.clamp(this.camRadius + reading.zoomDelta, 12, 72);
        }
      },
      () => {
        const nextIdx = (this.chapterIndex + 1) % EXHIBITION_CHAPTERS.length;
        this.setChapter(nextIdx);
      },
      (state) => {
        this.handState = state;
        this.emitHud(true);
      },
    );

    this.hardware = new HardwareBridge(
      (packet, _raw, via) => {
        this.hardwareReading.active = true;
        this.hardwareReading.source = via;
        this.hardwareReading.lastReceivedAt = Date.now();
        if (packet.x !== undefined) this.hardwareReading.x = packet.x * 2 - 1;
        if (packet.y !== undefined) this.hardwareReading.y = packet.y * 2 - 1;
        if (packet.force !== undefined) this.hardwareReading.force = packet.force;
        if (packet.windStrength !== undefined) {
          this.params.windStrength = packet.windStrength;
          this.targetWindStrength = packet.windStrength;
        }
        this.registerActivity();
      },
      (state) => {
        this.hardwareState = state;
        this.emitHud(true);
      },
    );
    this.hardwareState = this.hardware.status;

    this.collab = new CollabRoomClient(
      (state) => {
        this.collabState = state;
        this.emitHud(true);
      },
      (trees) => {
        const elapsed = this.clock.getElapsedTime();
        const added = this.environment.restorePlantedTrees(
          trees,
          this.params.terrainRoughness,
          this.params.season,
          elapsed,
        );
        if (added > 0) {
          this.plantedCount = this.environment.getPlantedTrees().length;
          const last = trees[trees.length - 1];
          this._plantHit.set(
            last.x,
            terrainHeight(last.x, last.z, this.params.terrainRoughness),
            last.z,
          );
          this.burstVfx.spawnBurst(this._plantHit, 55, 'plant');
          this.emitHud(true);
        }
      },
      () => {
        this.fluidFbo.clear(this.renderer);
      },
    );
    this.collabState = this.collab.status;

    this.bindEvents();
    this.emitHud(true);
    this.startLoop();
  }

  private startLoop(): void {
    if (this.isSoftwareGl) {
      this.softwareTick();
    } else {
      this.renderer.setAnimationLoop(this.tickFrame);
    }
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerleave', this.handlePointerLeave);
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('wheel', this.handleWheel, { passive: true });
    canvas.addEventListener('webglcontextlost', this.handleContextLost);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
  }

  private unbindEvents(): void {
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);

    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointermove', this.handlePointerMove);
    canvas.removeEventListener('pointerleave', this.handlePointerLeave);
    canvas.removeEventListener('pointerdown', this.handlePointerDown);
    canvas.removeEventListener('wheel', this.handleWheel);
    canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
  }

  private handleContextLost = (e: Event): void => {
    e.preventDefault();
    this.webglLost = true;
    this.renderer.setAnimationLoop(null);
    clearTimeout(this.frameId);
    this.emitHud(true);
  };

  private handleContextRestored = (): void => {
    this.webglLost = false;
    this.fluidFbo.clear(this.renderer);
    this.emitHud(true);
    this.startLoop();
  };

  private handleResize = (): void => {
    if (this.renderer.xr.isPresenting) return;
    const width = this.mountEl.clientWidth || window.innerWidth;
    const height = this.mountEl.clientHeight || window.innerHeight;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, this.profile.maxPixelRatio);

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height);

    if (this.composer && this.bloomPass) {
      this.composer.setPixelRatio(pixelRatio);
      this.composer.setSize(width, height);
      this.bloomPass.resolution.set(width, height);
    }
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const k = e.key.toLowerCase();
    if (k in this.keys) {
      this.keys[k] = true;
      this.flythroughActive = false;
      this.registerActivity();
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    if (k in this.keys) {
      this.keys[k] = false;
    }
  };

  private handlePointerMove = (e: PointerEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.pointerActive = true;
    this.registerActivity();
  };

  private handlePointerLeave = (): void => {
    this.pointerActive = false;
  };

  private handlePointerDown = (e: PointerEvent): void => {
    this.registerActivity();
    void this.initAudioIfNeeded();

    const rect = this.renderer.domElement.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.pointerNdc.x = nx;
    this.pointerNdc.y = ny;

    if (this.params.mode === 'plant') {
      this._ndc.set(nx, ny);
      this.raycaster.setFromCamera(this._ndc, this.camera);
      const hit = this.raycaster.ray.intersectPlane(this._planeGround, this._plantHit);
      if (hit && Math.abs(hit.x) < 33 && Math.abs(hit.z) < 33) {
        this.plantAtWorldPos(hit.x, hit.z);
      }
    }
  };

  private handleWheel = (e: WheelEvent): void => {
    this.flythroughActive = false;
    this.camRadius = THREE.MathUtils.clamp(this.camRadius + e.deltaY * 0.015, 12, 72);
    this.registerActivity();
  };

  private registerActivity(): void {
    this.lastInteractionTime = Date.now();
    if (this.attractMode) {
      this.attractMode = false;
      this.emitHud(true);
    }
  }

  private plantAtWorldPos(x: number, z: number): void {
    const elapsed = this.clock.getElapsedTime();
    const res = this.environment.plantTreeAt(
      x,
      z,
      this.params.plantType,
      this.params.treeScale,
      this.params.terrainRoughness,
      this.params.season,
      elapsed,
    );
    if (res.ok && res.tree) {
      this.plantedCount = this.environment.getPlantedTrees().length;
      this._plantHit.set(x, res.y, z);
      this.burstVfx.spawnBurst(this._plantHit, 75, 'plant');
      this.audio.triggerPlantChime();
      this.collab.sendPlantTree(res.tree);
      this.emitHud(true);
    }
  }

  // --- Archive & Snapshot Methods ---

  public captureThumbnailDataUrl(): string | null {
    try {
      if (!this.composer || this.renderer.xr.isPresenting) {
        this.renderer.render(this.scene, this.camera);
      } else {
        this.composer.render();
      }
      const src = this.renderer.domElement;
      const thumb = document.createElement('canvas');
      thumb.width = 480;
      thumb.height = 270;
      const ctx = thumb.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(src, 0, 0, thumb.width, thumb.height);
      return thumb.toDataURL('image/jpeg', 0.72);
    } catch {
      return null;
    }
  }

  public getArchiveExportPayload(): {
    terrainConfig: TerrainConfig;
    atmosphere: AtmosphereSnapshot;
    cameraTarget: CameraTarget;
    plantedTrees: SavedPlantedTree[];
    thumbnailDataUrl: string | null;
  } {
    return {
      terrainConfig: {
        seed: this.params.terrainSeed,
        riverWidth: this.params.riverWidth,
        terrainRoughness: this.params.terrainRoughness,
        treeDensity: this.params.treeDensity,
        treeScale: this.params.treeScale,
        baseSpecies: this.params.plantType,
      },
      atmosphere: {
        season: this.params.season,
        sunElevation: Number(this.params.sunElevation.toFixed(3)),
        sunAzimuth: Number(this.params.sunAzimuth.toFixed(3)),
        fogDensity: Number(this.params.fogDensity.toFixed(4)),
        bloomStrength: Number(this.params.bloomStrength.toFixed(2)),
        windStrength: Number(this.params.windStrength.toFixed(2)),
        windDirection: Number(this.params.windDirection.toFixed(2)),
        interactionMode: this.params.interactionMode,
        interactionContext: this.params.interactionContext,
      },
      cameraTarget: {
        theta: Number(this.camTheta.toFixed(3)),
        phi: Number(this.camPhi.toFixed(3)),
        radius: Number(this.camRadius.toFixed(2)),
      },
      plantedTrees: this.environment.getPlantedTrees(),
      thumbnailDataUrl: this.captureThumbnailDataUrl(),
    };
  }

  public loadForestPlate(plate: ForestPlate): void {
    this.activePlateTitle = plate.title;
    this.activePlateAuthor = plate.authorName;
    this.activePlateAccession = plate.accessionCode;

    this.params.terrainSeed = plate.terrainConfig.seed;
    this.params.riverWidth = plate.terrainConfig.riverWidth;
    this.params.terrainRoughness = plate.terrainConfig.terrainRoughness;
    this.params.treeDensity = plate.terrainConfig.treeDensity;
    this.params.treeScale = plate.terrainConfig.treeScale;
    this.params.plantType = plate.terrainConfig.baseSpecies;

    this.environment.generate(this.params, true);
    const elapsed = this.clock.getElapsedTime();
    this.environment.restorePlantedTrees(
      plate.plantedTrees,
      this.params.terrainRoughness,
      plate.atmosphere.season,
      elapsed,
    );
    this.plantedCount = this.environment.getPlantedTrees().length;

    this.applyAtmospherePreset(plate.atmosphere, plate.cameraTarget);
    this.fluidFbo.clear(this.renderer);
    this.registerActivity();
    this.emitHud(true);
  }

  public applyAtmospherePreset(
    atmo: AtmosphereSnapshot,
    cameraTarget?: CameraTarget,
  ): void {
    this.params.season = atmo.season;
    seasonToWeights(atmo.season, this._targetSeasonWeights);
    this.params.interactionMode = atmo.interactionMode;
    this.params.interactionContext = atmo.interactionContext;

    this.targetWindStrength = atmo.windStrength;
    this.targetWindDirection = atmo.windDirection;
    this.targetFog = atmo.fogDensity;
    this.targetSunElevation = atmo.sunElevation;
    this.targetSunAzimuth = atmo.sunAzimuth;
    this.targetBloom = atmo.bloomStrength;

    if (cameraTarget) {
      this.targetCamTheta = cameraTarget.theta;
      this.targetCamPhi = cameraTarget.phi;
      this.targetCamRadius = cameraTarget.radius;
      this.flythroughActive = true;
    }

    this.syncVrWristHud();
    this.emitHud(true);
  }

  // --- Studio & Atmosphere Direct Controls ---

  public setSeason(season: Season): void {
    this.params.season = season;
    seasonToWeights(season, this._targetSeasonWeights);
    this.emitHud(true);
  }

  public setSunElevation(rad: number): void {
    const val = THREE.MathUtils.clamp(rad, -0.3, 1.3);
    this.params.sunElevation = val;
    this.targetSunElevation = val;
    this.emitHud(true);
  }

  public setSunAzimuth(rad: number): void {
    this.params.sunAzimuth = rad;
    this.targetSunAzimuth = rad;
    this.emitHud(true);
  }

  public setFogDensity(density: number): void {
    const val = THREE.MathUtils.clamp(density, 0.002, 0.045);
    this.params.fogDensity = val;
    this.targetFog = val;
    this.emitHud(true);
  }

  public setBloomStrength(strength: number): void {
    const val = THREE.MathUtils.clamp(strength, 0.2, 2.0);
    this.params.bloomStrength = val;
    this.targetBloom = val;
    this.emitHud(true);
  }

  public setWindDirection(rad: number): void {
    this.params.windDirection = rad;
    this.targetWindDirection = rad;
    this.emitHud(true);
  }

  // --- Real-Time Weather & Solar Sync ---

  public async enableWeatherSync(stationId: string): Promise<void> {
    const station =
      NORDIC_WEATHER_STATIONS.find((s) => s.id === stationId) ?? NORDIC_WEATHER_STATIONS[0];
    this.weatherLat = station.latitude;
    this.weatherLon = station.longitude;
    this.weatherState = {
      ...this.weatherState,
      enabled: true,
      loading: true,
      stationId: station.id,
      stationName: station.name,
      error: null,
    };
    this.emitHud(true);
    await this.pollWeatherNow();
    this.startWeatherTimer();
  }

  public enableGeolocationWeatherSync(): void {
    if (!navigator.geolocation) {
      this.weatherState = {
        ...this.weatherState,
        error: 'Geolocation is not supported in this browser.',
      };
      this.emitHud(true);
      return;
    }
    this.weatherState = { ...this.weatherState, enabled: true, loading: true, error: null };
    this.emitHud(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.weatherLat = pos.coords.latitude;
        this.weatherLon = pos.coords.longitude;
        this.weatherState.stationId = 'custom';
        this.weatherState.stationName = `${this.weatherLat.toFixed(1)}°, ${this.weatherLon.toFixed(1)}°`;
        void this.pollWeatherNow();
        this.startWeatherTimer();
      },
      () => {
        this.weatherState = {
          ...this.weatherState,
          loading: false,
          error: 'Location permission declined. Using Arctic station.',
        };
        void this.enableWeatherSync('tromso');
      },
      { timeout: 6000 },
    );
  }

  public disableWeatherSync(): void {
    if (this.weatherTimer !== null) {
      clearInterval(this.weatherTimer);
      this.weatherTimer = null;
    }
    this.weatherState = { ...this.weatherState, enabled: false, loading: false };
    this.emitHud(true);
  }

  private startWeatherTimer(): void {
    if (this.weatherTimer !== null) clearInterval(this.weatherTimer);
    this.weatherTimer = window.setInterval(() => {
      if (this.weatherState.enabled) void this.pollWeatherNow();
    }, 300_000);
  }

  private async pollWeatherNow(): Promise<void> {
    try {
      const obs = await fetchLiveWeather(this.weatherLat, this.weatherLon);
      const solar = computeSolarPosition(this.weatherLat, this.weatherLon, new Date());
      const mapped = mapWeatherToAtmosphere(obs, solar);

      this.params.season = mapped.season;
      seasonToWeights(mapped.season, this._targetSeasonWeights);
      this.targetWindStrength = mapped.windStrength;
      this.targetWindDirection = mapped.windDirection;
      this.targetFog = mapped.fogDensity;
      this.targetBloom = mapped.bloomStrength;
      this.targetSunElevation = mapped.sunElevation;
      this.targetSunAzimuth = mapped.sunAzimuth;

      this.weatherState = {
        ...this.weatherState,
        loading: false,
        solarElevationDeg: solar.elevationDeg,
        observation: obs,
        error: null,
      };
      this.emitHud(true);
    } catch (err) {
      this.weatherState = {
        ...this.weatherState,
        loading: false,
        error: err instanceof Error ? err.message : 'Unable to fetch weather.',
      };
      this.emitHud(true);
    }
  }

  // --- Collaborative Multi-Visitor Room Methods ---

  public joinCollabRoom(roomId: string, visitorName?: string): void {
    this.collab.join(roomId, visitorName);
  }

  public leaveCollabRoom(): void {
    this.collab.disconnect(true);
  }

  public updateVisitorName(name: string): void {
    this.collab.updateName(name);
  }

  // --- Museum Kiosk Mode ---

  public setKioskPlates(plates: ForestPlate[]): void {
    this.kioskPlates = plates.filter((p) => p.visibility === 'public');
    this.kioskState.plateTotal = this.kioskPlates.length;
    this.emitHud(true);
  }

  public setKioskMode(enabled: boolean, intervalSec = 45): void {
    if (this.kioskTimer !== null) {
      clearInterval(this.kioskTimer);
      this.kioskTimer = null;
    }
    this.kioskState = {
      ...this.kioskState,
      enabled,
      intervalSec,
      plateTotal: this.kioskPlates.length,
    };
    if (enabled && this.kioskPlates.length > 0) {
      this.attractMode = false;
      this.advanceKioskPlate(0);
      this.kioskTimer = window.setInterval(() => {
        if (!this.kioskState.enabled || this.kioskPlates.length === 0) return;
        const next = (this.kioskState.plateIndex + 1) % this.kioskPlates.length;
        this.advanceKioskPlate(next);
      }, intervalSec * 1000);
    }
    this.emitHud(true);
  }

  public advanceKioskPlate(idx?: number): void {
    if (this.kioskPlates.length === 0) return;
    const nextIdx =
      idx !== undefined
        ? idx % this.kioskPlates.length
        : (this.kioskState.plateIndex + 1) % this.kioskPlates.length;
    this.kioskState.plateIndex = nextIdx;
    this.loadForestPlate(this.kioskPlates[nextIdx]);
  }

  // --- Existing Controls ---

  public attachHandTrackingElements(
    video: HTMLVideoElement | null,
    previewCanvas: HTMLCanvasElement | null,
  ): void {
    this.handTracker.attachElements(video, previewCanvas);
  }

  public async toggleHandTracking(): Promise<void> {
    if (this.handState.status === 'active' || this.handState.status === 'starting') {
      this.handTracker.stop();
    } else {
      await this.initAudioIfNeeded();
      await this.handTracker.start();
    }
  }

  public async toggleVR(): Promise<void> {
    this.pointerActive = false;
    await this.initAudioIfNeeded();
    await this.webxr.toggleVR(this.params.terrainRoughness);
  }

  private syncVrWristHud(): void {
    const modeLabel = this.params.mode === 'plant' ? 'PLANT' : 'EXPLORE';
    const detail = this.params.mode === 'plant' ? this.params.plantType : this.params.interactionMode;
    this.webxr.updateWristHud(modeLabel, detail);
  }

  public setMode(mode: ModeType): void {
    this.params.mode = mode;
    this.syncVrWristHud();
    this.registerActivity();
    this.emitHud(true);
  }

  public setPlantType(species: PlantSpecies): void {
    this.params.plantType = species;
    this.syncVrWristHud();
    this.registerActivity();
    this.emitHud(true);
  }

  public setChapter(index: number): void {
    const ch = EXHIBITION_CHAPTERS[index];
    if (!ch) return;
    this.chapterIndex = index;
    this.activePlateTitle = null;
    this.activePlateAuthor = null;
    this.activePlateAccession = null;

    this.params.interactionMode = ch.interactionMode;
    this.params.interactionContext = ch.interactionContext;
    this.params.season = ch.season;
    seasonToWeights(ch.season, this._targetSeasonWeights);

    this.targetWindStrength = ch.windStrength;
    this.targetFog = ch.fogDensity;
    this.targetSunElevation = ch.sunElevation;
    this.targetBloom = ch.bloomStrength;

    this.targetCamTheta = ch.cameraTarget.theta;
    this.targetCamPhi = ch.cameraTarget.phi;
    this.targetCamRadius = ch.cameraTarget.radius;
    this.flythroughActive = true;

    this.fluidFbo.clear(this.renderer);
    this.syncVrWristHud();
    this.registerActivity();
    this.emitHud(true);
  }

  public setInteractionContext(context: InteractionContext): void {
    this.params.interactionContext = context;
    this.registerActivity();
    this.emitHud(true);
  }

  public setInteractionMode(mode: InteractionMode): void {
    this.params.interactionMode = mode;
    this.syncVrWristHud();
    this.registerActivity();
    this.emitHud(true);
  }

  public setInteractionRadius(radius: number): void {
    this.params.interactionRadius = THREE.MathUtils.clamp(radius, 1.5, 14.0);
    this.emitHud(true);
  }

  public setWindStrength(wind: number): void {
    const clamped = THREE.MathUtils.clamp(wind, 0, 5.0);
    this.params.windStrength = clamped;
    this.targetWindStrength = clamped;
    this.emitHud(true);
  }

  public clearFluidWakes(): void {
    this.fluidFbo.clear(this.renderer);
    this.collab.sendClearWake();
  }

  public async initAudioIfNeeded(): Promise<void> {
    const ok = await this.audio.init();
    if (ok) this.emitHud(true);
  }

  public async toggleMuteAudio(): Promise<void> {
    if (!this.audio.isInitialized) {
      await this.audio.init();
      this.audio.setMuted(false);
    } else {
      this.audio.setMuted(!this.audio.isMuted);
    }
    this.emitHud(true);
  }

  public toggleRecording(): void {
    this.recorder.toggle(this.renderer.domElement);
  }

  public async connectBle(): Promise<void> {
    await this.hardware.connectBle();
  }

  public disconnectBle(): void {
    this.hardware.disconnectBle();
  }

  public connectWebSocket(url: string): void {
    this.hardware.connectWebSocket(url);
  }

  public disconnectWebSocket(): void {
    this.hardware.disconnectWebSocket();
  }

  public loadRecordingObject(rec: SensorRecording, autoPlay = true): void {
    this.recording = rec;
    this.playbackState = {
      hasRecording: true,
      fileName: rec.name,
      sampleCount: rec.samples.length,
      playing: autoPlay,
      loop: this.playbackState.loop,
      speed: this.playbackState.speed,
      currentTimeMs: 0,
      durationMs: rec.durationMs,
      lastSample: rec.samples[0] ?? null,
      error: null,
    };
    if (autoPlay) this.registerActivity();
    this.emitHud(true);
  }

  public loadRecordingFile(fileName: string, content: string): void {
    try {
      const parsed = parseRecordedNatureFile(fileName, content);
      this.loadRecordingObject(parsed, true);
    } catch (err) {
      this.playbackState = {
        ...this.playbackState,
        error: err instanceof Error ? err.message : 'Failed to parse sensor file.',
      };
      this.emitHud(true);
    }
  }

  public togglePlayback(): void {
    if (!this.recording) return;
    if (!this.playbackState.playing && this.playbackState.currentTimeMs >= this.playbackState.durationMs) {
      this.playbackState.currentTimeMs = 0;
    }
    this.playbackState.playing = !this.playbackState.playing;
    if (this.playbackState.playing) this.registerActivity();
    this.emitHud(true);
  }

  public setPlaybackLoop(loop: boolean): void {
    this.playbackState.loop = loop;
    this.emitHud(true);
  }

  public setPlaybackSpeed(speed: number): void {
    this.playbackState.speed = speed;
    this.emitHud(true);
  }

  public scrubPlayback(timeMs: number): void {
    if (!this.recording) return;
    this.playbackState.currentTimeMs = THREE.MathUtils.clamp(timeMs, 0, this.recording.durationMs);
    this.playbackState.lastSample = sampleRecordingAt(this.recording, this.playbackState.currentTimeMs);
    this.emitHud(true);
  }

  // --- Render Loop ---

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (typeof gl.fenceSync === 'function') {
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (this.disposed || this.webglLost) return;
        const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (state === gl.UNSIGNALED) {
          this.frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          this.frameId = window.setTimeout(cb, 80);
        }
      };
      this.frameId = window.setTimeout(poll, 5);
    } else {
      this.frameId = window.setTimeout(cb, 80);
    }
  }

  private softwareTick = (): void => {
    if (this.disposed || this.webglLost) return;
    this.tickFrame();
    this.afterDraw(this.softwareTick);
  };

  private tickFrame = (): void => {
    if (this.disposed || this.webglLost) return;

    const deltaTime = Math.min(this.clock.getDelta(), 0.05);
    const elapsedTime = this.clock.getElapsedTime();
    const now = Date.now();
    const isVrPresenting = this.renderer.xr.isPresenting;

    // Attract Mode Check (disabled in Kiosk or VR)
    if (
      now - this.lastInteractionTime > this.attractTimeoutMs &&
      !this.attractMode &&
      !isVrPresenting &&
      !this.kioskState.enabled
    ) {
      this.attractMode = true;
      this.emitHud(true);
    }

    // Expire stale live hardware stream after 2.5s silence
    if (this.hardwareReading.active && now - this.hardwareReading.lastReceivedAt > 2500) {
      this.hardwareReading.active = false;
    }

    // Smooth seasonal + atmospheric transitions
    const envDamp = 3.2;
    const seasonAlpha = 1 - Math.exp(-envDamp * deltaTime);
    this._seasonWeights.lerp(this._targetSeasonWeights, seasonAlpha);
    this.params.windStrength = THREE.MathUtils.damp(this.params.windStrength, this.targetWindStrength, envDamp, deltaTime);
    this.params.windDirection = THREE.MathUtils.damp(this.params.windDirection, this.targetWindDirection, envDamp, deltaTime);
    this.params.fogDensity = THREE.MathUtils.damp(this.params.fogDensity, this.targetFog, envDamp, deltaTime);
    this.params.sunElevation = THREE.MathUtils.damp(this.params.sunElevation, this.targetSunElevation, envDamp, deltaTime);
    this.params.sunAzimuth = THREE.MathUtils.damp(this.params.sunAzimuth, this.targetSunAzimuth, envDamp, deltaTime);
    this.params.bloomStrength = THREE.MathUtils.damp(this.params.bloomStrength, this.targetBloom, envDamp, deltaTime);
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.density = this.params.fogDensity;
    }
    if (this.bloomPass) {
      this.bloomPass.strength = this.params.bloomStrength;
    }

    // Advance Recorded Nature Playback
    let playbackActive = false;
    let playbackX = 0;
    let playbackY = 0;
    let playbackForce = 1.0;

    if (this.recording && this.playbackState.playing) {
      this.playbackState.currentTimeMs += deltaTime * 1000 * this.playbackState.speed;
      if (this.playbackState.currentTimeMs >= this.playbackState.durationMs) {
        if (this.playbackState.loop) {
          this.playbackState.currentTimeMs %= this.playbackState.durationMs;
        } else {
          this.playbackState.currentTimeMs = this.playbackState.durationMs;
          this.playbackState.playing = false;
        }
      }
      const sample = sampleRecordingAt(this.recording, this.playbackState.currentTimeMs);
      this.playbackState.lastSample = sample;
      playbackActive = true;
      playbackX = sample.x * 2 - 1;
      playbackY = sample.y * 2 - 1;
      playbackForce = sample.force;
      if (sample.windStrength !== undefined) {
        this.targetWindStrength = sample.windStrength;
      }
      this.registerActivity();
    }

    // WebXR & Collaborative Smoothing Updates
    const xrReadings = this.webxr.update(deltaTime, this.camera, this.params.terrainRoughness);
    this.collab.stepSmoothing(deltaTime);

    // Resolve Primary & Secondary Input Sources
    let targetNdcX = 0;
    let targetNdcY = 0;
    let targetInputForce = 1.0;
    let hasActiveInput = false;

    let hasSecondaryInput = false;
    let targetNdc2X = 0;
    let targetNdc2Y = 0;
    let targetForce2Input = 1.0;

    if (isVrPresenting && (xrReadings.primary.active || xrReadings.secondary.active)) {
      this.activeSource = 'webxr';
      hasActiveInput = xrReadings.primary.active;
      hasSecondaryInput = xrReadings.secondary.active;
      if (hasActiveInput) {
        this._targetMouse3D.copy(xrReadings.primary.worldPos);
        targetInputForce = xrReadings.primary.selecting ? 2.6 : 0.9;
        if (this.params.mode === 'plant' && xrReadings.primary.justPressed) {
          this.plantAtWorldPos(xrReadings.primary.worldPos.x, xrReadings.primary.worldPos.z);
        }
      }
      if (hasSecondaryInput) {
        this._targetMouse2_3D.copy(xrReadings.secondary.worldPos);
        targetForce2Input = xrReadings.secondary.selecting ? 2.6 : 0.9;
        if (this.params.mode === 'plant' && xrReadings.secondary.justPressed) {
          this.plantAtWorldPos(xrReadings.secondary.worldPos.x, xrReadings.secondary.worldPos.z);
        }
      }
    } else if (playbackActive) {
      this.activeSource = 'playback';
      targetNdcX = playbackX;
      targetNdcY = playbackY;
      targetInputForce = playbackForce;
      hasActiveInput = true;
    } else if (this.handReading.active) {
      this.activeSource = 'hands';
      targetNdcX = this.handReading.x;
      targetNdcY = this.handReading.y;
      targetInputForce = this.handReading.force;
      hasActiveInput = true;
      if (this.handReading.active2) {
        hasSecondaryInput = true;
        targetNdc2X = this.handReading.x2;
        targetNdc2Y = this.handReading.y2;
        targetForce2Input = this.handReading.force2;
      }
    } else if (this.hardwareReading.active) {
      this.activeSource = this.hardwareReading.source;
      targetNdcX = this.hardwareReading.x;
      targetNdcY = this.hardwareReading.y;
      targetInputForce = this.hardwareReading.force;
      hasActiveInput = true;
    } else if (!isVrPresenting && this.pointerActive) {
      this.activeSource = 'pointer';
      targetNdcX = this.pointerNdc.x;
      targetNdcY = this.pointerNdc.y;
      targetInputForce = this.params.interactionForce;
      hasActiveInput = true;
    }

    const groundLocked =
      this.params.mode === 'plant' ||
      this.params.interactionContext === 'Ground Only' ||
      this.params.interactionContext === 'Water Only' ||
      this.params.interactionMode === 'Seismic Ripple';

    if (hasActiveInput) {
      if (this.activeSource !== 'webxr') {
        const dampRate = this.activeSource === 'pointer' ? 18.0 : 10.0;
        this.smoothedNdcX = THREE.MathUtils.damp(this.smoothedNdcX, targetNdcX, dampRate, deltaTime);
        this.smoothedNdcY = THREE.MathUtils.damp(this.smoothedNdcY, targetNdcY, dampRate, deltaTime);
        this.smoothedForce = THREE.MathUtils.damp(this.smoothedForce, targetInputForce, 8.0, deltaTime);

        this._ndc.set(this.smoothedNdcX, this.smoothedNdcY);
        this.raycaster.setFromCamera(this._ndc, this.camera);

        if (groundLocked) {
          const hit = this.raycaster.ray.intersectPlane(this._planeGround, this._targetMouse3D);
          if (hit) {
            this._targetMouse3D.y =
              this.params.interactionContext === 'Water Only'
                ? -2.0
                : terrainHeight(this._targetMouse3D.x, this._targetMouse3D.z, this.params.terrainRoughness);
          }
        } else {
          this._planeView.normal.copy(this.camera.position).normalize();
          this._planeView.constant = 0;
          this.raycaster.ray.intersectPlane(this._planeView, this._targetMouse3D);
        }
      } else {
        this.smoothedForce = THREE.MathUtils.damp(this.smoothedForce, targetInputForce, 10.0, deltaTime);
      }

      if (this._currentMouse3D.x > 900) {
        this._currentMouse3D.copy(this._targetMouse3D);
        this._lastMouse3D.copy(this._targetMouse3D);
      } else {
        this._currentMouse3D.lerp(this._targetMouse3D, 1 - Math.exp(-14.0 * deltaTime));
      }

      if (
        this.activeSource === 'hands' &&
        this.params.mode === 'plant' &&
        this.handReading.pinch > 0.78 &&
        now - this.handPlantCooldown > 750 &&
        Math.abs(this._currentMouse3D.x) < 33 &&
        Math.abs(this._currentMouse3D.z) < 33
      ) {
        this.handPlantCooldown = now;
        this.plantAtWorldPos(this._currentMouse3D.x, this._currentMouse3D.z);
      }
    } else {
      this._targetMouse3D.set(999, 999, 999);
      this._currentMouse3D.set(999, 999, 999);
    }

    if (hasSecondaryInput) {
      if (this.activeSource !== 'webxr') {
        this.smoothedNdc2X = THREE.MathUtils.damp(this.smoothedNdc2X, targetNdc2X, 10.0, deltaTime);
        this.smoothedNdc2Y = THREE.MathUtils.damp(this.smoothedNdc2Y, targetNdc2Y, 10.0, deltaTime);
        this.smoothedForce2 = THREE.MathUtils.damp(this.smoothedForce2, targetForce2Input, 8.0, deltaTime);

        this._ndc2.set(this.smoothedNdc2X, this.smoothedNdc2Y);
        this.raycaster.setFromCamera(this._ndc2, this.camera);

        if (groundLocked) {
          const hit2 = this.raycaster.ray.intersectPlane(this._planeGround, this._targetMouse2_3D);
          if (hit2) {
            this._targetMouse2_3D.y =
              this.params.interactionContext === 'Water Only'
                ? -2.0
                : terrainHeight(this._targetMouse2_3D.x, this._targetMouse2_3D.z, this.params.terrainRoughness);
          }
        } else {
          this._planeView.normal.copy(this.camera.position).normalize();
          this._planeView.constant = 0;
          this.raycaster.ray.intersectPlane(this._planeView, this._targetMouse2_3D);
        }
      } else {
        this.smoothedForce2 = THREE.MathUtils.damp(this.smoothedForce2, targetForce2Input, 10.0, deltaTime);
      }

      if (this._currentMouse2_3D.x > 900) {
        this._currentMouse2_3D.copy(this._targetMouse2_3D);
        this._lastMouse2_3D.copy(this._targetMouse2_3D);
      } else {
        this._currentMouse2_3D.lerp(this._targetMouse2_3D, 1 - Math.exp(-14.0 * deltaTime));
      }
    } else {
      this._targetMouse2_3D.set(999, 999, 999);
      this._currentMouse2_3D.set(999, 999, 999);
    }

    const safeDelta = Math.max(deltaTime, 0.001);
    let speed = 0;
    if (hasActiveInput && this._lastMouse3D.x < 900 && this._currentMouse3D.x < 900) {
      const dist = this._currentMouse3D.distanceTo(this._lastMouse3D);
      speed = dist / safeDelta;
      this._mouseVel.subVectors(this._currentMouse3D, this._lastMouse3D).divideScalar(safeDelta);
      if (this._mouseVel.length() > 50.0) this._mouseVel.normalize().multiplyScalar(50.0);
      this.forestMaterial.uniforms.uMouseVelocity.value.lerp(this._mouseVel, 0.14);
      this._lastMouse3D.copy(this._currentMouse3D);
    } else {
      this.forestMaterial.uniforms.uMouseVelocity.value.multiplyScalar(Math.exp(-6.0 * deltaTime));
      if (hasActiveInput) this._lastMouse3D.copy(this._currentMouse3D);
    }
    this.lastCursorSpeed = speed;

    let speed2 = 0;
    if (hasSecondaryInput && this._lastMouse2_3D.x < 900 && this._currentMouse2_3D.x < 900) {
      const dist2 = this._currentMouse2_3D.distanceTo(this._lastMouse2_3D);
      speed2 = dist2 / safeDelta;
      this._mouseVel2.subVectors(this._currentMouse2_3D, this._lastMouse2_3D).divideScalar(safeDelta);
      if (this._mouseVel2.length() > 50.0) this._mouseVel2.normalize().multiplyScalar(50.0);
      this.forestMaterial.uniforms.uMouseVelocity2.value.lerp(this._mouseVel2, 0.14);
      this._lastMouse2_3D.copy(this._currentMouse2_3D);
    } else {
      this.forestMaterial.uniforms.uMouseVelocity2.value.multiplyScalar(Math.exp(-6.0 * deltaTime));
      if (hasSecondaryInput) this._lastMouse2_3D.copy(this._currentMouse2_3D);
    }

    const exploreActive = this.params.mode === 'explore';
    let targetForce = 0.0;
    if (hasActiveInput && exploreActive) {
      if (speed > 8.0) targetForce = 3.2 * this.smoothedForce;
      else if (speed < 1.5) targetForce = 0.85 * this.smoothedForce;
      else targetForce = 1.6 * this.smoothedForce;
    }

    let targetForce2 = 0.0;
    if (hasSecondaryInput && exploreActive) {
      if (speed2 > 8.0) targetForce2 = 3.2 * this.smoothedForce2;
      else if (speed2 < 1.5) targetForce2 = 0.85 * this.smoothedForce2;
      else targetForce2 = 1.6 * this.smoothedForce2;
    }

    // Stream Primary Cursor to Collaborative WebSocket Room (when connected)
    this.collab.sendCursor(
      this._currentMouse3D,
      this.forestMaterial.uniforms.uMouseVelocity.value as THREE.Vector3,
      targetForce,
      hasActiveInput && exploreActive,
    );

    // Prepare first active remote visitor for secondary vertex shader influence + FBO splats
    let remoteShaderCandidate: {
      worldPos: THREE.Vector3;
      velocity: THREE.Vector3;
      force: number;
    } | null = null;
    let remoteSplatIdx = 0;
    this._remoteSplats[0].active = false;
    this._remoteSplats[1].active = false;

    for (const rc of this.collab.getRemoteCursors()) {
      if (!rc.active || rc.worldPos.x > 900) continue;
      if (!remoteShaderCandidate) {
        remoteShaderCandidate = {
          worldPos: rc.worldPos,
          velocity: rc.velocity,
          force: rc.force,
        };
      }
      if (remoteSplatIdx < 2) {
        const slot = this._remoteSplats[remoteSplatIdx];
        slot.worldPos.copy(rc.worldPos);
        slot.velocity.copy(rc.velocity);
        slot.radiusWorld = this.params.interactionRadius * 0.9;
        slot.force = rc.force;
        slot.active = true;
        remoteSplatIdx++;
      }
    }

    // Kinetic Impact & Water Splash Bursts
    if (exploreActive && hasActiveInput && speed > 7.5 && now - this.lastBurstAt > 95 && this._currentMouse3D.x < 900) {
      this.lastBurstAt = now;
      const riverPathX = Math.sin(this._currentMouse3D.z * 0.1) * 8.0 + Math.cos(this._currentMouse3D.z * 0.05) * 5.0;
      const distToRiver = Math.abs(this._currentMouse3D.x - riverPathX);
      const nearRiver =
        this.params.interactionContext === 'Water Only' ||
        (distToRiver < this.params.riverWidth + 1.0 && this._currentMouse3D.y < -0.8);
      if (nearRiver) {
        this.burstVfx.spawnBurst(this._currentMouse3D, 28, 'splash');
      } else if (this.params.interactionMode === 'Seismic Ripple' || speed > 14.0) {
        this.burstVfx.spawnBurst(this._currentMouse3D, 22, 'spark');
      }
    }

    const modeId = MODE_IDS[this.params.interactionMode];
    const contextId = CONTEXT_IDS[this.params.interactionContext];

    // Step 4-Splat Persistent GPU Fluid Wake FBO (Local Dual + Remote Visitors)
    this._splatA.worldPos.copy(this._currentMouse3D);
    this._splatA.velocity.copy(this.forestMaterial.uniforms.uMouseVelocity.value as THREE.Vector3);
    this._splatA.radiusWorld = this.params.interactionRadius;
    this._splatA.force = targetForce;
    this._splatA.active = hasActiveInput && exploreActive;

    this._splatB.worldPos.copy(this._currentMouse2_3D);
    this._splatB.velocity.copy(this.forestMaterial.uniforms.uMouseVelocity2.value as THREE.Vector3);
    this._splatB.radiusWorld = this.params.interactionRadius * 0.9;
    this._splatB.force = targetForce2;
    this._splatB.active = hasSecondaryInput && exploreActive;

    this.fluidFbo.step(
      this.renderer,
      deltaTime,
      modeId,
      this._splatA,
      this._splatB,
      this._remoteSplats,
    );

    // Update Forest Shader Uniforms
    const uniforms = this.forestMaterial.uniforms;
    uniforms.uTime.value = this.attractMode || this.kioskState.enabled ? elapsedTime * 1.15 : elapsedTime;
    const activePointScale = isVrPresenting ? this.profile.vrPointScale : this.profile.pointScale;
    uniforms.uPointScale.value = activePointScale;
    uniforms.uMouse.value.copy(this._currentMouse3D);
    uniforms.uRadius.value = this.params.interactionRadius;
    uniforms.uInteractionType.value = modeId;
    uniforms.uInteractionContext.value = contextId;
    uniforms.uForce.value = THREE.MathUtils.damp(uniforms.uForce.value as number, targetForce, 8.0, deltaTime);

    if (hasSecondaryInput && exploreActive) {
      uniforms.uMouse2.value.copy(this._currentMouse2_3D);
      uniforms.uForce2.value = THREE.MathUtils.damp(uniforms.uForce2.value as number, targetForce2, 8.0, deltaTime);
      uniforms.uActive2.value = 1.0;
    } else if (remoteShaderCandidate) {
      uniforms.uMouse2.value.copy(remoteShaderCandidate.worldPos);
      (uniforms.uMouseVelocity2.value as THREE.Vector3).copy(remoteShaderCandidate.velocity);
      uniforms.uForce2.value = THREE.MathUtils.damp(
        uniforms.uForce2.value as number,
        remoteShaderCandidate.force,
        8.0,
        deltaTime,
      );
      uniforms.uActive2.value = 1.0;
    } else {
      uniforms.uForce2.value = THREE.MathUtils.damp(uniforms.uForce2.value as number, 0.0, 8.0, deltaTime);
      uniforms.uActive2.value = 0.0;
    }

    (uniforms.uSeasonWeights.value as THREE.Vector3).copy(this._seasonWeights);

    const windX = Math.cos(this.params.windDirection);
    const windZ = Math.sin(this.params.windDirection);
    uniforms.uWindDir.value.set(windX, 0.0, windZ).normalize();
    uniforms.uWindStrength.value = this.params.windStrength;

    const sunY = Math.sin(this.params.sunElevation);
    const sunXZ = Math.cos(this.params.sunElevation);
    uniforms.uSunDirection.value
      .set(Math.cos(this.params.sunAzimuth) * sunXZ, sunY, Math.sin(this.params.sunAzimuth) * sunXZ)
      .normalize();

    if (this.params.sunElevation < 0.2) this._sunColor.setHex(0xff7e40);
    else if (this.params.sunElevation < 0.5) this._sunColor.setHex(0xffb370);
    else this._sunColor.setHex(0xfff5e6);
    uniforms.uSunColor.value.copy(this._sunColor);
    uniforms.uFogDensity.value = this.params.fogDensity;

    // Update Atmospheric VFX & Burst Particles
    this.ambientVfx.setPointScale(activePointScale);
    this.burstVfx.setPointScale(activePointScale);
    this.cursorVisuals.setPointScale(activePointScale);
    this.ambientVfx.update(
      elapsedTime,
      this.params.windStrength,
      uniforms.uWindDir.value as THREE.Vector3,
      this._seasonWeights,
    );
    this.burstVfx.update(deltaTime);

    // Update Dual Local + Remote Visitor Cursors & Trails
    this.cursorVisuals.update(
      deltaTime,
      elapsedTime,
      this._currentMouse3D,
      this.camera,
      this.params.interactionRadius,
      speed,
      this.params.interactionContext,
      this.params.interactionMode,
      this.params.mode,
      hasActiveInput,
      this._currentMouse2_3D,
      speed2,
      hasSecondaryInput,
      this.collab.getRemoteCursors(),
    );

    // Spatial Audio Modulation & Energy Metering
    this.audio.syncSpatial(this.camera, this._currentMouse3D, hasActiveInput);
    this.audio.modulate(this.params.windStrength, speed, this.params.interactionMode);
    const audioEnergy = this.audio.getAudioEnergy();

    // Camera Flythrough, Orbit, Audio Breathing & Seismic Micro-Shake
    if (!isVrPresenting) {
      if (this.flythroughActive) {
        this.camTheta = THREE.MathUtils.damp(this.camTheta, this.targetCamTheta, 3.2, deltaTime);
        this.camPhi = THREE.MathUtils.damp(this.camPhi, this.targetCamPhi, 3.2, deltaTime);
        this.camRadius = THREE.MathUtils.damp(this.camRadius, this.targetCamRadius, 3.2, deltaTime);
        if (
          Math.abs(this.camTheta - this.targetCamTheta) < 0.005 &&
          Math.abs(this.camPhi - this.targetCamPhi) < 0.005 &&
          Math.abs(this.camRadius - this.targetCamRadius) < 0.05
        ) {
          this.flythroughActive = false;
        }
      } else {
        const camSpeed = 1.5 * deltaTime;
        const zoomSpeed = 20.0 * deltaTime;
        if (this.keys.w) this.camPhi -= camSpeed;
        if (this.keys.s) this.camPhi += camSpeed;
        if (this.keys.a) this.camTheta -= camSpeed;
        if (this.keys.d) this.camTheta += camSpeed;
        if (this.keys.q) this.camRadius += zoomSpeed;
        if (this.keys.e) this.camRadius -= zoomSpeed;

        if (this.kioskState.enabled) {
          this.camTheta += 0.075 * deltaTime;
        } else if (this.attractMode) {
          this.camTheta += 0.1 * deltaTime;
        } else if (!this.keys.a && !this.keys.d) {
          this.camTheta += 0.025 * deltaTime;
        }
      }

      this.camPhi = THREE.MathUtils.clamp(this.camPhi, 0.14, Math.PI / 2 - 0.06);
      this.camRadius = THREE.MathUtils.clamp(this.camRadius, 12, 72);

      const breathY = Math.sin(elapsedTime * 1.1) * (0.14 + audioEnergy * 0.45);
      const targetFov = 45 + audioEnergy * 1.6;
      if (Math.abs(this.camera.fov - targetFov) > 0.02) {
        this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 6.0, deltaTime);
        this.camera.updateProjectionMatrix();
      }

      let shakeMag = 0;
      if (this.params.interactionMode === 'Seismic Ripple' && hasActiveInput && speed > 4.0) {
        shakeMag = Math.min(0.28, (speed - 4.0) * 0.015);
      }
      this._shakeOffset.set(
        (Math.random() - 0.5) * shakeMag,
        (Math.random() - 0.5) * shakeMag,
        (Math.random() - 0.5) * shakeMag,
      );

      this.camera.position.x =
        this.camRadius * Math.sin(this.camPhi) * Math.cos(this.camTheta) + this._shakeOffset.x;
      this.camera.position.y = this.camRadius * Math.cos(this.camPhi) + breathY + this._shakeOffset.y;
      this.camera.position.z =
        this.camRadius * Math.sin(this.camPhi) * Math.sin(this.camTheta) + this._shakeOffset.z;
      this.camera.lookAt(0, 0, 0);
    }

    // Atmosphere Post-Processing Uniforms
    if (this.composer && this.atmospherePass && !isVrPresenting) {
      this._sunWorld
        .copy(uniforms.uSunDirection.value as THREE.Vector3)
        .multiplyScalar(120)
        .add(this.camera.position);
      this._sunProj.copy(this._sunWorld).project(this.camera);

      const sunVisible = this._sunProj.z < 1.0 && this.params.sunElevation > -0.05;
      const sunIntensity = sunVisible
        ? THREE.MathUtils.clamp(0.18 + this.params.sunElevation * 0.16, 0.0, 0.28)
        : 0.0;

      (this.atmospherePass.uniforms.uSunScreenPos.value as THREE.Vector2).set(
        this._sunProj.x * 0.5 + 0.5,
        this._sunProj.y * 0.5 + 0.5,
      );
      (this.atmospherePass.uniforms.uSunColor.value as THREE.Color).copy(this._sunColor);
      this.atmospherePass.uniforms.uSunIntensity.value = THREE.MathUtils.damp(
        this.atmospherePass.uniforms.uSunIntensity.value as number,
        sunIntensity,
        5.0,
        deltaTime,
      );

      const caTarget =
        0.0005 +
        THREE.MathUtils.clamp(speed * 0.00009, 0, 0.0022) +
        (this.params.interactionMode === 'Seismic Ripple' && hasActiveInput ? 0.0012 : 0);
      this.atmospherePass.uniforms.uChromaticAmount.value = THREE.MathUtils.damp(
        this.atmospherePass.uniforms.uChromaticAmount.value as number,
        caTarget,
        7.0,
        deltaTime,
      );
    }

    // Render Scene
    if (!this.composer || isVrPresenting) {
      this.renderer.render(this.scene, this.camera);
    } else {
      this.composer.render();
    }

    const hudInterval = isVrPresenting ? 300 : 90;
    if (now - this.lastHudEmit > hudInterval) {
      this.emitHud(false);
    }
  };

  private emitHud(force: boolean): void {
    const now = Date.now();
    if (!force && now - this.lastHudEmit < 80) return;
    this.lastHudEmit = now;

    this.onHudUpdate({
      mode: this.params.mode,
      plantType: this.params.plantType,
      plantedCount: this.plantedCount,
      chapterIndex: this.chapterIndex,
      activePlateTitle: this.activePlateTitle,
      activePlateAuthor: this.activePlateAuthor,
      activePlateAccession: this.activePlateAccession,
      season: this.params.season,
      sunElevation: Number(this.params.sunElevation.toFixed(2)),
      sunAzimuth: Number(this.params.sunAzimuth.toFixed(2)),
      fogDensity: Number(this.params.fogDensity.toFixed(4)),
      bloomStrength: Number(this.params.bloomStrength.toFixed(2)),
      windStrength: Number(this.params.windStrength.toFixed(2)),
      windDirection: Number(this.params.windDirection.toFixed(2)),
      interactionMode: this.params.interactionMode,
      interactionContext: this.params.interactionContext,
      interactionRadius: Number(this.params.interactionRadius.toFixed(1)),
      activeSource: this.activeSource,
      secondaryCursorActive:
        this.handReading.active2 || (this.renderer.xr.isPresenting && this.webxrState.controllersConnected > 1),
      attractMode: this.attractMode,
      audioEnabled: this.audio.isInitialized,
      audioMuted: this.audio.isMuted,
      cursorNdc: {
        x: Number(((this.smoothedNdcX + 1) * 0.5).toFixed(2)),
        y: Number(((this.smoothedNdcY + 1) * 0.5).toFixed(2)),
      },
      cursorSpeed: Number(this.lastCursorSpeed.toFixed(1)),
      handTracking: { ...this.handState },
      hardware: { ...this.hardwareState },
      playback: { ...this.playbackState },
      recording: { ...this.recordingState },
      webxr: { ...this.webxrState },
      weather: { ...this.weatherState },
      collab: { ...this.collabState, visitors: [...this.collabState.visitors] },
      kiosk: { ...this.kioskState },
      webglLost: this.webglLost,
      isSoftwareGl: this.isSoftwareGl,
    });
  }

  public dispose(): void {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    clearTimeout(this.frameId);
    if (this.weatherTimer !== null) clearInterval(this.weatherTimer);
    if (this.kioskTimer !== null) clearInterval(this.kioskTimer);
    this.unbindEvents();

    this.handTracker.dispose();
    this.hardware.dispose();
    this.collab.disconnect(false);
    this.recorder.dispose();
    this.audio.dispose();
    this.webxr.dispose();

    this.ambientVfx.dispose();
    this.burstVfx.dispose();
    this.cursorVisuals.dispose();
    this.environment.dispose();
    this.forestMaterial.dispose();
    this.fluidFbo.dispose();
    this.composer?.dispose();
    this.renderer.dispose();

    if (this.renderer.domElement.parentNode === this.mountEl) {
      this.mountEl.removeChild(this.renderer.domElement);
    }
  }
}
