import * as THREE from 'three';
import * as Tone from 'tone';
import { InteractionMode } from '../types/simulation';

export class SoundscapeEngine {
  private initialized = false;
  private muted = false;
  private masterVol: Tone.Volume | null = null;
  private meter: Tone.Meter | null = null;
  private panner: Tone.Panner3D | null = null;

  private windFilter: Tone.Filter | null = null;
  private windNoise: Tone.Noise | null = null;
  private auroraSynth: Tone.PolySynth | null = null;
  private waterSynth: Tone.FMSynth | null = null;
  private plantSynth: Tone.PolySynth | null = null;

  private lastNoteAt = 0;
  private smoothedEnergy = 0;

  private readonly panningModel: 'HRTF' | 'equalpower';

  private readonly _camWorldPos = new THREE.Vector3();
  private readonly _camWorldQuat = new THREE.Quaternion();
  private readonly _forward = new THREE.Vector3();
  private readonly _up = new THREE.Vector3();

  constructor(panningModel: 'HRTF' | 'equalpower' = 'HRTF') {
    this.panningModel = panningModel;
  }

  public get isInitialized(): boolean {
    return this.initialized;
  }

  public get isMuted(): boolean {
    return this.muted;
  }

  public async init(): Promise<boolean> {
    if (this.initialized) {
      if (Tone.getContext().state !== 'running') {
        await Tone.start();
      }
      return true;
    }

    try {
      await Tone.start();

      this.masterVol = new Tone.Volume(-12).toDestination();
      this.masterVol.mute = this.muted;

      this.meter = new Tone.Meter({ smoothing: 0.8 });
      this.masterVol.connect(this.meter);

      this.panner = new Tone.Panner3D({
        panningModel: this.panningModel,
        distanceModel: 'inverse',
        refDistance: 8,
        maxDistance: 120,
        rolloffFactor: 0.55,
      }).connect(this.masterVol);

      this.windFilter = new Tone.Filter(400, 'lowpass').connect(this.masterVol);
      this.windNoise = new Tone.Noise('pink').connect(this.windFilter).start();
      this.windNoise.volume.value = -16;

      this.auroraSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sine' },
        envelope: { attack: 1.8, decay: 1.0, sustain: 0.7, release: 3.5 },
      }).connect(this.panner);
      this.auroraSynth.volume.value = -24;

      this.waterSynth = new Tone.FMSynth({
        harmonicity: 2,
        modulationIndex: 3,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.08, decay: 0.25, sustain: 0.1, release: 0.9 },
      }).connect(this.panner);
      this.waterSynth.volume.value = -18;

      this.plantSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.02, decay: 0.45, sustain: 0.08, release: 1.4 },
      }).connect(this.panner);
      this.plantSynth.volume.value = -16;

      this.initialized = true;
      return true;
    } catch {
      return false;
    }
  }

  public setMuted(mute: boolean): void {
    this.muted = mute;
    if (this.masterVol) {
      this.masterVol.mute = mute;
    }
  }

  public syncSpatial(camera: THREE.Camera, cursorWorldPos: THREE.Vector3, active: boolean): void {
    if (!this.initialized || !this.panner) return;

    const listener = Tone.getListener();
    camera.getWorldPosition(this._camWorldPos);
    camera.getWorldQuaternion(this._camWorldQuat);
    this._forward.set(0, 0, -1).applyQuaternion(this._camWorldQuat).normalize();
    this._up.set(0, 1, 0).applyQuaternion(this._camWorldQuat).normalize();

    listener.positionX.value = this._camWorldPos.x;
    listener.positionY.value = this._camWorldPos.y;
    listener.positionZ.value = this._camWorldPos.z;
    listener.forwardX.value = this._forward.x;
    listener.forwardY.value = this._forward.y;
    listener.forwardZ.value = this._forward.z;
    listener.upX.value = this._up.x;
    listener.upY.value = this._up.y;
    listener.upZ.value = this._up.z;

    if (active && cursorWorldPos.x < 900) {
      this.panner.positionX.rampTo(cursorWorldPos.x, 0.06);
      this.panner.positionY.rampTo(cursorWorldPos.y, 0.06);
      this.panner.positionZ.rampTo(cursorWorldPos.z, 0.06);
    } else {
      this.panner.positionX.rampTo(0, 0.15);
      this.panner.positionY.rampTo(0, 0.15);
      this.panner.positionZ.rampTo(0, 0.15);
    }
  }

  public triggerPlantChime(): void {
    if (!this.initialized || this.muted || !this.plantSynth) return;
    const chords = [
      ['D4', 'A4', 'E5'],
      ['E4', 'B4', 'F#5'],
      ['G4', 'D5', 'A5'],
    ];
    const chord = chords[Math.floor(Math.random() * chords.length)];
    this.plantSynth.triggerAttackRelease(chord, '4n');
  }

  public modulate(windStrength: number, speed: number, mode: InteractionMode): void {
    if (!this.initialized || this.muted || !this.windFilter) return;

    const targetFreq = Math.min(200 + windStrength * 480 + speed * 90, 4800);
    this.windFilter.frequency.rampTo(targetFreq, 0.12);

    const now = performance.now();
    if (now - this.lastNoteAt < 260) return;

    if (mode === 'Aurora Field' && speed > 2.0 && this.auroraSynth && Math.random() > 0.65) {
      const notes = ['C4', 'E4', 'G4', 'B4', 'D5'];
      const note = notes[Math.floor(Math.random() * notes.length)];
      this.auroraSynth.triggerAttackRelease(note, '2n');
      this.lastNoteAt = now;
    } else if (
      (mode === 'Fluid Push/Pull' || mode === 'Seismic Ripple') &&
      speed > 5.0 &&
      this.waterSynth &&
      Math.random() > 0.55
    ) {
      const bassNotes = mode === 'Seismic Ripple' ? ['A1', 'C2', 'D2'] : ['C2', 'G2', 'D3'];
      const note = bassNotes[Math.floor(Math.random() * bassNotes.length)];
      this.waterSynth.triggerAttackRelease(note, '8n');
      this.lastNoteAt = now;
    }
  }

  public getAudioEnergy(): number {
    if (!this.initialized || this.muted || !this.meter) {
      this.smoothedEnergy *= 0.85;
      return this.smoothedEnergy;
    }
    const val = this.meter.getValue();
    const db = Array.isArray(val) ? val[0] : val;
    const norm = Number.isFinite(db) ? THREE.MathUtils.clamp((db + 54) / 42, 0, 1) : 0;
    this.smoothedEnergy = this.smoothedEnergy * 0.8 + norm * 0.2;
    return this.smoothedEnergy;
  }

  public dispose(): void {
    if (this.windNoise) {
      this.windNoise.stop();
      this.windNoise.dispose();
    }
    this.windFilter?.dispose();
    this.auroraSynth?.dispose();
    this.waterSynth?.dispose();
    this.plantSynth?.dispose();
    this.panner?.dispose();
    this.meter?.dispose();
    this.masterVol?.dispose();
    this.initialized = false;
  }
}
