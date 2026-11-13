import * as Tone from 'tone';
import { InteractionMode } from '../types/simulation';

export class SoundscapeEngine {
  private initialized = false;
  private muted = false;
  private masterVol: Tone.Volume | null = null;
  private windFilter: Tone.Filter | null = null;
  private windNoise: Tone.Noise | null = null;
  private auroraSynth: Tone.PolySynth | null = null;
  private waterSynth: Tone.FMSynth | null = null;
  private lastNoteAt = 0;

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

      this.windFilter = new Tone.Filter(400, 'lowpass').connect(this.masterVol);
      this.windNoise = new Tone.Noise('pink').connect(this.windFilter).start();
      this.windNoise.volume.value = -16;

      this.auroraSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sine' },
        envelope: { attack: 1.8, decay: 1.0, sustain: 0.7, release: 3.5 },
      }).connect(this.masterVol);
      this.auroraSynth.volume.value = -26;

      this.waterSynth = new Tone.FMSynth({
        harmonicity: 2,
        modulationIndex: 3,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.08, decay: 0.25, sustain: 0.1, release: 0.9 },
      }).connect(this.masterVol);
      this.waterSynth.volume.value = -20;

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

  public dispose(): void {
    if (this.windNoise) {
      this.windNoise.stop();
      this.windNoise.dispose();
    }
    this.windFilter?.dispose();
    this.auroraSynth?.dispose();
    this.waterSynth?.dispose();
    this.masterVol?.dispose();
    this.initialized = false;
  }
}
