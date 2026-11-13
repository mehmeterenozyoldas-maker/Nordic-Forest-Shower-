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

export interface SingleHandPose {
  ndcX: number;
  ndcY: number;
  force: number;
  pinchStrength: number;
  detected: boolean;
}

export interface DualHandPoseReading {
  primary: SingleHandPose;
  secondary: SingleHandPose;
  handsCount: number;
  zoomDelta: number;
  twoHandZoomActive: boolean;
}

function isVictoryPose(lm: NormalizedLandmark[]): boolean {
  const wrist = lm[0];
  const d = (idx: number) => Math.hypot(lm[idx].x - wrist.x, lm[idx].y - wrist.y);
  // Index (8 > 6) and Middle (12 > 10) extended; Ring (16 < 14) and Pinky (20 < 18) curled
  const indexExtended = d(8) > d(6) * 1.15;
  const middleExtended = d(12) > d(10) * 1.15;
  const ringCurled = d(16) < d(14) * 0.98;
  const pinkyCurled = d(20) < d(18) * 0.98;
  return indexExtended && middleExtended && ringCurled && pinkyCurled;
}

export class HandTrackerController {
  private handLandmarker: HandLandmarker | null = null;
  private stream: MediaStream | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private previewCanvas: HTMLCanvasElement | null = null;
  private rafId: number | null = null;
  private lastVideoTime = -1;

  private prevPinchSpan: number | null = null;
  private victoryHoldStart: number | null = null;
  private lastChapterTriggerAt = 0;

  private state: HandTrackingState = {
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

  private onReading: (reading: DualHandPoseReading) => void;
  private onChapterGesture: () => void;
  private onState: (state: HandTrackingState) => void;

  constructor(
    onReading: (reading: DualHandPoseReading) => void,
    onChapterGesture: () => void,
    onState: (state: HandTrackingState) => void,
  ) {
    this.onReading = onReading;
    this.onChapterGesture = onChapterGesture;
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

    this.emitState({
      status: 'starting',
      handDetected: false,
      handsCount: 0,
      chapterGestureProgress: 0,
      gestureHint: null,
      error: null,
    });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
      this.stream = stream;
      this.videoEl.srcObject = stream;
      await this.videoEl.play();

      if (!this.handLandmarker) {
        const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
        this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_URL,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.45,
          minHandPresenceConfidence: 0.45,
          minTrackingConfidence: 0.45,
        });
      }

      this.lastVideoTime = -1;
      this.prevPinchSpan = null;
      this.victoryHoldStart = null;
      this.emitState({ status: 'active', error: null });
      this.loop();
    } catch (err) {
      this.stopStreamOnly();
      const rawMsg = err instanceof Error ? err.message : 'Unable to initialize hand tracking.';
      const friendlyMsg =
        rawMsg.toLowerCase().includes('permission') || rawMsg.toLowerCase().includes('notallowed')
          ? 'Camera permission was denied. Allow webcam access in your browser bar and retry.'
          : rawMsg;
      this.emitState({
        status: 'error',
        handDetected: false,
        handsCount: 0,
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
    this.prevPinchSpan = null;
    this.victoryHoldStart = null;
    this.onReading({
      primary: { ndcX: 0, ndcY: 0, force: 1.0, pinchStrength: 0, detected: false },
      secondary: { ndcX: 0, ndcY: 0, force: 1.0, pinchStrength: 0, detected: false },
      handsCount: 0,
      zoomDelta: 0,
      twoHandZoomActive: false,
    });
    this.emitState({
      status: 'idle',
      handDetected: false,
      handsCount: 0,
      pinchStrength: 0,
      secondaryPinchStrength: 0,
      twoHandZoomActive: false,
      chapterGestureProgress: 0,
      gestureHint: null,
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

  private extractHandPose(lm: NormalizedLandmark[]): SingleHandPose {
    const indexTip = lm[8];
    const thumbTip = lm[4];
    const ndcX = -(indexTip.x * 2 - 1);
    const ndcY = -(indexTip.y * 2 - 1);
    const pinchDist = Math.hypot(indexTip.x - thumbTip.x, indexTip.y - thumbTip.y);
    const pinchStrength = Math.max(0, Math.min(1, 1 - (pinchDist - 0.03) / 0.16));
    const force = 0.75 + pinchStrength * 1.85;
    return { ndcX, ndcY, force, pinchStrength, detected: true };
  }

  private loop = (): void => {
    if (this.state.status !== 'active' || !this.videoEl || !this.handLandmarker) return;

    if (this.videoEl.readyState >= 2 && this.videoEl.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = this.videoEl.currentTime;
      const now = performance.now();
      const result = this.handLandmarker.detectForVideo(this.videoEl, now);
      const allHands = result.landmarks ?? [];
      const handsCount = allHands.length;

      if (handsCount > 0) {
        const primaryLm = allHands[0];
        const primary = this.extractHandPose(primaryLm);

        const secondaryLm = handsCount > 1 ? allHands[1] : null;
        const secondary: SingleHandPose = secondaryLm
          ? this.extractHandPose(secondaryLm)
          : { ndcX: 0, ndcY: 0, force: 1.0, pinchStrength: 0, detected: false };

        // Two-Hand Pinch-Spread Camera Zoom
        let zoomDelta = 0;
        let twoHandZoomActive = false;
        if (secondaryLm && primary.pinchStrength > 0.55 && secondary.pinchStrength > 0.55) {
          twoHandZoomActive = true;
          const span = Math.hypot(primary.ndcX - secondary.ndcX, primary.ndcY - secondary.ndcY);
          if (this.prevPinchSpan !== null) {
            zoomDelta = (this.prevPinchSpan - span) * 28.0;
          }
          this.prevPinchSpan = span;
        } else {
          this.prevPinchSpan = null;
        }

        // Hands-free Chapter Switch Gesture: Held Victory/Peace sign for 0.85s
        let chapterGestureProgress = 0;
        let gestureHint: string | null = twoHandZoomActive ? 'Pinch-Zoom' : null;
        if (!twoHandZoomActive && isVictoryPose(primaryLm) && now - this.lastChapterTriggerAt > 1500) {
          if (this.victoryHoldStart === null) {
            this.victoryHoldStart = now;
          }
          const heldMs = now - this.victoryHoldStart;
          chapterGestureProgress = Math.min(1, heldMs / 850);
          gestureHint = 'Next Chapter';
          if (heldMs >= 850) {
            this.victoryHoldStart = null;
            this.lastChapterTriggerAt = now;
            chapterGestureProgress = 0;
            this.onChapterGesture();
          }
        } else {
          this.victoryHoldStart = null;
        }

        this.drawPreview(allHands, [primary.pinchStrength, secondary.pinchStrength]);
        this.onReading({
          primary,
          secondary,
          handsCount,
          zoomDelta,
          twoHandZoomActive,
        });

        const changed =
          !this.state.handDetected ||
          this.state.handsCount !== handsCount ||
          this.state.twoHandZoomActive !== twoHandZoomActive ||
          this.state.gestureHint !== gestureHint ||
          Math.abs(this.state.pinchStrength - primary.pinchStrength) > 0.05 ||
          Math.abs(this.state.chapterGestureProgress - chapterGestureProgress) > 0.08;

        if (changed) {
          this.emitState({
            handDetected: true,
            handsCount,
            pinchStrength: primary.pinchStrength,
            secondaryPinchStrength: secondary.pinchStrength,
            twoHandZoomActive,
            chapterGestureProgress,
            gestureHint,
          });
        }
      } else {
        this.prevPinchSpan = null;
        this.victoryHoldStart = null;
        this.drawPreview([], []);
        this.onReading({
          primary: { ndcX: 0, ndcY: 0, force: 1.0, pinchStrength: 0, detected: false },
          secondary: { ndcX: 0, ndcY: 0, force: 1.0, pinchStrength: 0, detected: false },
          handsCount: 0,
          zoomDelta: 0,
          twoHandZoomActive: false,
        });
        if (this.state.handDetected || this.state.chapterGestureProgress > 0) {
          this.emitState({
            handDetected: false,
            handsCount: 0,
            pinchStrength: 0,
            secondaryPinchStrength: 0,
            twoHandZoomActive: false,
            chapterGestureProgress: 0,
            gestureHint: null,
          });
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

  private drawPreview(hands: NormalizedLandmark[][], pinches: number[]): void {
    if (!this.previewCanvas || !this.videoEl) return;
    const ctx = this.previewCanvas.getContext('2d');
    if (!ctx) return;

    const w = this.previewCanvas.width;
    const h = this.previewCanvas.height;

    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.globalAlpha = 0.45;
    ctx.drawImage(this.videoEl, 0, 0, w, h);
    ctx.restore();

    const strokeColors = ['rgba(245, 243, 238, 0.65)', 'rgba(103, 232, 249, 0.65)'];
    const tipColors = ['#f5f3ee', '#67e8f9'];

    hands.forEach((landmarks, idx) => {
      ctx.strokeStyle = strokeColors[idx] ?? strokeColors[0];
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
      const pinchStrength = pinches[idx] ?? 0;
      ctx.fillStyle = pinchStrength > 0.45 ? '#38bdf8' : tipColors[idx] ?? '#f5f3ee';
      ctx.beginPath();
      ctx.arc(tx, ty, 4 + pinchStrength * 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  public dispose(): void {
    this.stop();
    this.handLandmarker?.close();
    this.handLandmarker = null;
  }
}
