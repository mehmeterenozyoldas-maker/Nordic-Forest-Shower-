import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { EXHIBITION_CHAPTERS } from '../data/chapters';
import {
  HandTrackingState,
  HardwareConnectionState,
  InputSourceType,
  InteractionContext,
  InteractionMode,
  PlaybackStatus,
  RecordingStatus,
  SensorRecording,
  SimulationHUDState,
  SimulationParams,
} from '../types/simulation';
import { SoundscapeEngine } from './audio';
import { ContextCursorVisuals } from './cursorVisuals';
import { ParticleEnvironment, terrainHeight } from './environment';
import { FluidWakeSimulation } from './fluidFbo';
import { CanvasRecorder } from './recorder';
import { createForestMaterial } from './shaders';
import { HandTrackerController } from '../inputs/handTracker';
import { HardwareBridge } from '../inputs/hardwareBridge';
import { parseRecordedNatureFile, sampleRecordingAt } from '../inputs/sensorParser';

function detectSoftwareWebGL(): boolean {
  try {
    const probeCanvas = document.createElement('canvas');
    const gl = probeCanvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

const MODE_IDS: Record<InteractionMode, number> = {
  'Wind Gust': 0,
  Tornado: 1,
  Parting: 2,
  'Fluid Push/Pull': 3,
  'Seismic Ripple': 4,
  'Aurora Field': 5,
};

const CONTEXT_IDS: Record<InteractionContext, number> = {
  All: 0,
  'Trees Only': 1,
  'Water Only': 2,
  'Ground Only': 3,
};

export class SimulationController {
  private readonly mountEl: HTMLElement;
  private readonly isSoftwareGl: boolean;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;

  private readonly fluidFbo: FluidWakeSimulation;
  private readonly environment: ParticleEnvironment;
  private readonly forestMaterial: THREE.ShaderMaterial;
  private readonly points: THREE.Points;
  private readonly cursorVisuals: ContextCursorVisuals;

  private readonly audio = new SoundscapeEngine();
  private readonly recorder: CanvasRecorder;
  private readonly handTracker: HandTrackerController;
  private readonly hardware: HardwareBridge;

  private readonly params: SimulationParams;
  private chapterIndex = 0;

  // Input state (normalized & damped)
  private activeSource: InputSourceType = 'pointer';
  private pointerActive = false;
  private pointerNdc = { x: 0, y: 0 };
  private handReading = { active: false, x: 0, y: 0, force: 1.0 };
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

  // Camera & Interaction Timing
  private readonly keys: Record<string, boolean> = {
    w: false,
    a: false,
    s: false,
    d: false,
    q: false,
    e: false,
  };
  private camTheta = Math.PI / 2;
  private camPhi = Math.PI / 3;
  private camRadius = 37;
  private attractMode = false;
  private lastInteractionTime = Date.now();
  private readonly attractTimeoutMs = 10_000;

  // Pre-allocated math scratchpads (Zero GC in render loop)
  private readonly raycaster = new THREE.Raycaster();
  private readonly _ndc = new THREE.Vector2(0, 0);
  private readonly _planeView = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private readonly _planeGround = new THREE.Plane(new THREE.Vector3(0, 1, 0), 2.0);
  private readonly _targetMouse3D = new THREE.Vector3(999, 999, 999);
  private readonly _currentMouse3D = new THREE.Vector3(999, 999, 999);
  private readonly _lastMouse3D = new THREE.Vector3(999, 999, 999);
  private readonly _mouseVel = new THREE.Vector3(0, 0, 0);
  private readonly _sunColor = new THREE.Color();
  private smoothedNdcX = 0;
  private smoothedNdcY = 0;
  private smoothedForce = 1.0;
  private lastCursorSpeed = 0;

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
    pinchStrength: 0,
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
    this.isSoftwareGl = detectSoftwareWebGL();

    const ch0 = EXHIBITION_CHAPTERS[0];
    this.params = {
      season: ch0.season,
      riverWidth: 4.0,
      terrainRoughness: 2.0,
      treeScale: 0.7,
      treeDensity: 35,
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

    const width = mountEl.clientWidth || window.innerWidth;
    const height = mountEl.clientHeight || window.innerHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.scene.fog = new THREE.FogExp2(0x000000, this.params.fogDensity);

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    this.camera.position.set(0, 12, 35);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.mountEl.appendChild(this.renderer.domElement);

    // GPU Ping-Pong Fluid Wake FBO
    this.fluidFbo = new FluidWakeSimulation(this.renderer, this.isSoftwareGl);

    // 1.5M Particle Environment
    this.environment = new ParticleEnvironment(this.params);
    this.forestMaterial = createForestMaterial(this.fluidFbo.texture);
    this.points = new THREE.Points(this.environment.geometry, this.forestMaterial);
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    // Context-Aware 3D Cursor & Trail
    this.cursorVisuals = new ContextCursorVisuals();
    this.scene.add(this.cursorVisuals.group);

    // Post-Processing Composer (Bloom + ACES/sRGB OutputPass)
    this.composer = new EffectComposer(this.renderer);
    this.composer.setSize(width, height);
    const renderPass = new RenderPass(this.scene, this.camera);
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      this.params.bloomStrength,
      0.65,
      0.22,
    );
    const outputPass = new OutputPass();
    this.composer.addPass(renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(outputPass);

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
        this.handReading.active = reading.detected;
        if (reading.detected) {
          this.handReading.x = reading.ndcX;
          this.handReading.y = reading.ndcY;
          this.handReading.force = reading.force;
          this.registerActivity();
        }
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
        }
        this.registerActivity();
      },
      (state) => {
        this.hardwareState = state;
        this.emitHud(true);
      },
    );
    this.hardwareState = this.hardware.status;

    this.bindEvents();
    this.emitHud(true);
    this.tick();
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
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.emitHud(true);
  };

  private handleContextRestored = (): void => {
    this.webglLost = false;
    this.fluidFbo.clear(this.renderer);
    this.emitHud(true);
    this.tick();
  };

  private handleResize = (): void => {
    const width = this.mountEl.clientWidth || window.innerWidth;
    const height = this.mountEl.clientHeight || window.innerHeight;
    const pixelRatio = this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2);

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height);

    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    this.bloomPass.resolution.set(width, height);
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const k = e.key.toLowerCase();
    if (k in this.keys) {
      this.keys[k] = true;
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

  private handlePointerDown = (): void => {
    this.registerActivity();
    void this.initAudioIfNeeded();
  };

  private handleWheel = (e: WheelEvent): void => {
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

  // --- Public Controls for UI ---

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

  public setChapter(index: number): void {
    const ch = EXHIBITION_CHAPTERS[index];
    if (!ch) return;
    this.chapterIndex = index;
    this.params.interactionMode = ch.interactionMode;
    this.params.interactionContext = ch.interactionContext;
    this.params.season = ch.season;
    this.params.windStrength = ch.windStrength;
    this.params.fogDensity = ch.fogDensity;
    this.params.sunElevation = ch.sunElevation;
    this.params.bloomStrength = ch.bloomStrength;

    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.density = ch.fogDensity;
    }
    this.bloomPass.strength = ch.bloomStrength;

    this.environment.generate(this.params, true);
    this.fluidFbo.clear(this.renderer);
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
    this.registerActivity();
    this.emitHud(true);
  }

  public setInteractionRadius(radius: number): void {
    this.params.interactionRadius = THREE.MathUtils.clamp(radius, 1.5, 14.0);
    this.emitHud(true);
  }

  public setWindStrength(wind: number): void {
    this.params.windStrength = THREE.MathUtils.clamp(wind, 0, 5.0);
    this.emitHud(true);
  }

  public clearFluidWakes(): void {
    this.fluidFbo.clear(this.renderer);
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

  private tick = (): void => {
    if (this.disposed || this.webglLost) return;

    const deltaTime = Math.min(this.clock.getDelta(), 0.05);
    const elapsedTime = this.clock.getElapsedTime();

    // Attract Mode Check
    const now = Date.now();
    if (now - this.lastInteractionTime > this.attractTimeoutMs && !this.attractMode) {
      this.attractMode = true;
      this.emitHud(true);
    }

    // Expire stale live hardware stream after 2.5s silence
    if (this.hardwareReading.active && now - this.hardwareReading.lastReceivedAt > 2500) {
      this.hardwareReading.active = false;
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
        this.params.windStrength = THREE.MathUtils.damp(
          this.params.windStrength,
          sample.windStrength,
          6.0,
          deltaTime,
        );
      }
      this.registerActivity();
    }

    // Resolve Active Input Source via Unified Router
    let targetNdcX = 0;
    let targetNdcY = 0;
    let targetInputForce = 1.0;
    let hasActiveInput = false;

    if (playbackActive) {
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
    } else if (this.hardwareReading.active) {
      this.activeSource = this.hardwareReading.source;
      targetNdcX = this.hardwareReading.x;
      targetNdcY = this.hardwareReading.y;
      targetInputForce = this.hardwareReading.force;
      hasActiveInput = true;
    } else if (this.pointerActive) {
      this.activeSource = 'pointer';
      targetNdcX = this.pointerNdc.x;
      targetNdcY = this.pointerNdc.y;
      targetInputForce = this.params.interactionForce;
      hasActiveInput = true;
    }

    // Smooth input coordinates with exponential damping
    if (hasActiveInput) {
      const dampRate = this.activeSource === 'pointer' ? 18.0 : 10.0;
      this.smoothedNdcX = THREE.MathUtils.damp(this.smoothedNdcX, targetNdcX, dampRate, deltaTime);
      this.smoothedNdcY = THREE.MathUtils.damp(this.smoothedNdcY, targetNdcY, dampRate, deltaTime);
      this.smoothedForce = THREE.MathUtils.damp(this.smoothedForce, targetInputForce, 8.0, deltaTime);

      this._ndc.set(this.smoothedNdcX, this.smoothedNdcY);
      this.raycaster.setFromCamera(this._ndc, this.camera);

      if (
        this.params.interactionContext === 'Ground Only' ||
        this.params.interactionContext === 'Water Only' ||
        this.params.interactionMode === 'Seismic Ripple'
      ) {
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

      if (this._currentMouse3D.x > 900) {
        this._currentMouse3D.copy(this._targetMouse3D);
        this._lastMouse3D.copy(this._targetMouse3D);
      } else {
        this._currentMouse3D.lerp(this._targetMouse3D, 1 - Math.exp(-14.0 * deltaTime));
      }
    } else {
      this._targetMouse3D.set(999, 999, 999);
      this._currentMouse3D.set(999, 999, 999);
    }

    // Mouse / Sensor Velocity
    const safeDelta = Math.max(deltaTime, 0.001);
    let speed = 0;
    if (hasActiveInput && this._lastMouse3D.x < 900 && this._currentMouse3D.x < 900) {
      const dist = this._currentMouse3D.distanceTo(this._lastMouse3D);
      speed = dist / safeDelta;
      this._mouseVel.subVectors(this._currentMouse3D, this._lastMouse3D).divideScalar(safeDelta);
      if (this._mouseVel.length() > 50.0) {
        this._mouseVel.normalize().multiplyScalar(50.0);
      }
      this.forestMaterial.uniforms.uMouseVelocity.value.lerp(this._mouseVel, 0.14);
      this._lastMouse3D.copy(this._currentMouse3D);
    } else {
      this.forestMaterial.uniforms.uMouseVelocity.value.multiplyScalar(Math.exp(-6.0 * deltaTime));
      if (hasActiveInput) this._lastMouse3D.copy(this._currentMouse3D);
    }
    this.lastCursorSpeed = speed;

    // Effective Interaction Force
    let targetForce = 0.0;
    if (hasActiveInput) {
      if (speed > 8.0) targetForce = 3.2 * this.smoothedForce;
      else if (speed < 1.5) targetForce = 0.85 * this.smoothedForce;
      else targetForce = 1.6 * this.smoothedForce;
    }

    const modeId = MODE_IDS[this.params.interactionMode];
    const contextId = CONTEXT_IDS[this.params.interactionContext];

    // Step Persistent GPU Fluid Wake FBO
    this.fluidFbo.step(
      this.renderer,
      deltaTime,
      this._currentMouse3D,
      this.forestMaterial.uniforms.uMouseVelocity.value,
      this.params.interactionRadius,
      targetForce,
      modeId,
      hasActiveInput,
    );

    // Update Forest Shader Uniforms
    const uniforms = this.forestMaterial.uniforms;
    uniforms.uTime.value = this.attractMode ? elapsedTime * 1.35 : elapsedTime;
    uniforms.uMouse.value.copy(this._currentMouse3D);
    uniforms.uRadius.value = this.params.interactionRadius;
    uniforms.uInteractionType.value = modeId;
    uniforms.uInteractionContext.value = contextId;
    uniforms.uForce.value = THREE.MathUtils.damp(uniforms.uForce.value as number, targetForce, 8.0, deltaTime);

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

    // Update Context-Aware 3D Cursor & Trail
    this.cursorVisuals.update(
      deltaTime,
      elapsedTime,
      this._currentMouse3D,
      this.camera,
      this.params.interactionRadius,
      speed,
      this.params.interactionContext,
      this.params.interactionMode,
      hasActiveInput,
    );

    // Camera Orbit & Keyboard Navigation
    const camSpeed = 1.5 * deltaTime;
    const zoomSpeed = 20.0 * deltaTime;
    if (this.keys.w) this.camPhi -= camSpeed;
    if (this.keys.s) this.camPhi += camSpeed;
    if (this.keys.a) this.camTheta -= camSpeed;
    if (this.keys.d) this.camTheta += camSpeed;
    if (this.keys.q) this.camRadius += zoomSpeed;
    if (this.keys.e) this.camRadius -= zoomSpeed;

    if (this.attractMode) {
      this.camTheta += 0.1 * deltaTime;
    } else if (!this.keys.a && !this.keys.d) {
      this.camTheta += 0.025 * deltaTime;
    }

    this.camPhi = THREE.MathUtils.clamp(this.camPhi, 0.14, Math.PI / 2 - 0.06);
    this.camRadius = THREE.MathUtils.clamp(this.camRadius, 12, 72);

    this.camera.position.x = this.camRadius * Math.sin(this.camPhi) * Math.cos(this.camTheta);
    this.camera.position.y = this.camRadius * Math.cos(this.camPhi);
    this.camera.position.z = this.camRadius * Math.sin(this.camPhi) * Math.sin(this.camTheta);
    this.camera.lookAt(0, 0, 0);

    // Generative Audio Modulation
    this.audio.modulate(this.params.windStrength, speed, this.params.interactionMode);

    // Render Scene
    if (this.isSoftwareGl) {
      this.renderer.render(this.scene, this.camera);
    } else {
      this.composer.render();
    }

    // Throttle HUD state pushes (~12 Hz)
    if (now - this.lastHudEmit > 85) {
      this.emitHud(false);
    }

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private emitHud(force: boolean): void {
    const now = Date.now();
    if (!force && now - this.lastHudEmit < 80) return;
    this.lastHudEmit = now;

    this.onHudUpdate({
      chapterIndex: this.chapterIndex,
      interactionMode: this.params.interactionMode,
      interactionContext: this.params.interactionContext,
      activeSource: this.activeSource,
      attractMode: this.attractMode,
      audioEnabled: this.audio.isInitialized,
      audioMuted: this.audio.isMuted,
      cursorNdc: {
        x: Number(((this.smoothedNdcX + 1) * 0.5).toFixed(2)),
        y: Number(((this.smoothedNdcY + 1) * 0.5).toFixed(2)),
      },
      cursorSpeed: Number(this.lastCursorSpeed.toFixed(1)),
      windStrength: Number(this.params.windStrength.toFixed(2)),
      interactionRadius: Number(this.params.interactionRadius.toFixed(1)),
      handTracking: { ...this.handState },
      hardware: { ...this.hardwareState },
      playback: { ...this.playbackState },
      recording: { ...this.recordingState },
      webglLost: this.webglLost,
      isSoftwareGl: this.isSoftwareGl,
    });
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.unbindEvents();

    this.handTracker.dispose();
    this.hardware.dispose();
    this.recorder.dispose();
    this.audio.dispose();

    this.cursorVisuals.dispose();
    this.environment.dispose();
    this.forestMaterial.dispose();
    this.fluidFbo.dispose();
    this.composer.dispose();
    this.renderer.dispose();

    if (this.renderer.domElement.parentNode === this.mountEl) {
      this.mountEl.removeChild(this.renderer.domElement);
    }
  }
}
