import { FilesetResolver, HandLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision';
import { HandTrackingState } from '../types/simulation';

const HAND_CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export interface HandPoseReading {
  ndcX: number;
  ndcY: number;
  force: number;
  detected: boolean;
}

export class HandTrackerController {
  private handLandmarker: HandLandmarker | null = null;
  private stream: MediaStream | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private previewCanvas: HTMLCanvasElement | null = null;
  private rafId: number | null = null;
  private lastVideoTime = -1;

  private state: HandTrackingState = {
    status: 'idle',
    handDetected: false,
    pinchStrength: 0,
    error: null,
  };

  private onReading: (reading: HandPoseReading) => void;
  private onState: (state: HandTrackingState) => void;

  constructor(
    onReading: (reading: HandPoseReading) => void,
    onState: (state: HandTrackingState) => void,
  ) {
    this.onReading = onReading;
    this.onState = onState;
  }

  public get status(): HandTrackingState {
    return this.state;
  }

  public attachElements(video: HTMLVideoElement | null, previewCanvas: HTMLCanvasElement | null): void {
    this.videoEl = video;
    this.previewCanvas = previewCanvas;
  }

  private emitState(patch: Partial<HandTrackingState>): void {
    this.state = { ...this.state, ...patch };
    this.onState({ ...this.state });
  }

  public async start(): Promise<void> {
    if (this.state.status === 'starting' || this.state.status === 'active') return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.emitState({
        status: 'error',
        error: 'Webcam access requires a secure browser context (HTTPS or localhost).',
      });
      return;
    }

    if (!this.videoEl) {
      this.emitState({ status: 'error', error: 'Video pipeline element is not mounted.' });
      return;
    }

    this.emitState({ status: 'starting', handDetected: false, error: null });

    try {
      // 1. Acquire webcam stream first so permission prompt happens immediately on click
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
      this.stream = stream;
      this.videoEl.srcObject = stream;
      await this.videoEl.play();

      // 2. Lazily initialize HandLandmarker with local WASM files in /mediapipe/wasm
      if (!this.handLandmarker) {
        const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
        this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_URL,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numHands: 1,
          minHandDetectionConfidence: 0.45,
          minHandPresenceConfidence: 0.45,
          minTrackingConfidence: 0.45,
        });
      }

      this.lastVideoTime = -1;
      this.emitState({ status: 'active', error: null });
      this.loop();
    } catch (err) {
      this.stopStreamOnly();
      const rawMsg = err instanceof Error ? err.message : 'Unable to initialize hand tracking.';
      const friendlyMsg = rawMsg.toLowerCase().includes('permission') || rawMsg.toLowerCase().includes('notallowed')
        ? 'Camera permission was denied. Allow webcam access in your browser bar and retry.'
        : rawMsg;
      this.emitState({
        status: 'error',
        handDetected: false,
        error: friendlyMsg,
      });
    }
  }

  public stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.stopStreamOnly();
    this.clearPreview();
    this.onReading({ ndcX: 0, ndcY: 0, force: 1.0, detected: false });
    this.emitState({
      status: 'idle',
      handDetected: false,
      pinchStrength: 0,
      error: null,
    });
  }

  private stopStreamOnly(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
    if (this.videoEl) {
      this.videoEl.srcObject = null;
    }
  }

  private loop = (): void => {
    if (this.state.status !== 'active' || !this.videoEl || !this.handLandmarker) return;

    if (this.videoEl.readyState >= 2 && this.videoEl.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = this.videoEl.currentTime;
      const result = this.handLandmarker.detectForVideo(this.videoEl, performance.now());

      if (result.landmarks && result.landmarks.length > 0) {
        const lm = result.landmarks[0];
        const indexTip = lm[8];
        const thumbTip = lm[4];

        // Mirror X so moving hand right moves cursor right
        const ndcX = -(indexTip.x * 2 - 1);
        const ndcY = -(indexTip.y * 2 - 1);

        // Thumb-index pinch modulates force boost (close pinch = 1.0 strength)
        const pinchDist = Math.hypot(indexTip.x - thumbTip.x, indexTip.y - thumbTip.y);
        const pinchStrength = Math.max(0, Math.min(1, 1 - (pinchDist - 0.03) / 0.16));
        const force = 0.75 + pinchStrength * 1.85;

        this.drawPreview(lm, pinchStrength);
        this.onReading({ ndcX, ndcY, force, detected: true });

        if (!this.state.handDetected || Math.abs(this.state.pinchStrength - pinchStrength) > 0.05) {
          this.emitState({ handDetected: true, pinchStrength });
        }
      } else {
        this.drawPreview(null, 0);
        this.onReading({ ndcX: 0, ndcY: 0, force: 1.0, detected: false });
        if (this.state.handDetected) {
          this.emitState({ handDetected: false, pinchStrength: 0 });
        }
      }
    }

    this.rafId = requestAnimationFrame(this.loop);
  };

  private clearPreview(): void {
    if (!this.previewCanvas) return;
    const ctx = this.previewCanvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
    }
  }

  private drawPreview(landmarks: NormalizedLandmark[] | null, pinchStrength: number): void {
    if (!this.previewCanvas || !this.videoEl) return;
    const ctx = this.previewCanvas.getContext('2d');
    if (!ctx) return;

    const w = this.previewCanvas.width;
    const h = this.previewCanvas.height;

    ctx.save();
    ctx.clearRect(0, 0, w, h);
    // Mirrored dim video feed
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.globalAlpha = 0.45;
    ctx.drawImage(this.videoEl, 0, 0, w, h);
    ctx.restore();

    if (!landmarks) return;

    // Draw mirrored skeleton
    ctx.strokeStyle = 'rgba(245, 243, 238, 0.55)';
    ctx.lineWidth = 1.5;
    for (const [a, b] of HAND_CONNECTIONS) {
      const pa = landmarks[a];
      const pb = landmarks[b];
      ctx.beginPath();
      ctx.moveTo((1 - pa.x) * w, pa.y * h);
      ctx.lineTo((1 - pb.x) * w, pb.y * h);
      ctx.stroke();
    }

    const tip = landmarks[8];
    const tx = (1 - tip.x) * w;
    const ty = tip.y * h;
    ctx.fillStyle = pinchStrength > 0.45 ? '#67e8f9' : '#f5f3ee';
    ctx.beginPath();
    ctx.arc(tx, ty, 4 + pinchStrength * 3, 0, Math.PI * 2);
    ctx.fill();
  }

  public dispose(): void {
    this.stop();
    this.handLandmarker?.close();
    this.handLandmarker = null;
  }
}
