import { RecordingStatus } from '../types/simulation';

export class CanvasRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private timerId: number | null = null;
  private startTime = 0;
  private onChange: (status: RecordingStatus) => void;
  private state: RecordingStatus = {
    isRecording: false,
    elapsedSec: 0,
    error: null,
  };

  constructor(onChange: (status: RecordingStatus) => void) {
    this.onChange = onChange;
  }

  public get status(): RecordingStatus {
    return this.state;
  }

  public toggle(canvas: HTMLCanvasElement): void {
    if (this.state.isRecording) {
      this.stop();
    } else {
      this.start(canvas);
    }
  }

  public start(canvas: HTMLCanvasElement): void {
    if (this.state.isRecording) return;

    if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') {
      this.state = {
        isRecording: false,
        elapsedSec: 0,
        error: 'Canvas recording is not supported in this browser.',
      };
      this.onChange({ ...this.state });
      return;
    }

    const stream = canvas.captureStream(60);
    const mimeCandidates = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    const supportedMime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m));

    try {
      this.mediaRecorder = supportedMime
        ? new MediaRecorder(stream, { mimeType: supportedMime })
        : new MediaRecorder(stream);
    } catch {
      this.state = {
        isRecording: false,
        elapsedSec: 0,
        error: 'Could not initialize WebM video recorder.',
      };
      this.onChange({ ...this.state });
      return;
    }

    this.recordedChunks = [];
    this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        this.recordedChunks.push(event.data);
      }
    };

    this.mediaRecorder.onstop = () => {
      const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
      this.recordedChunks = [];
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `nordic-simulation-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.webm`;
      document.body.appendChild(a);
      a.click();
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }, 250);
    };

    this.mediaRecorder.start(250);
    this.startTime = Date.now();
    this.state = { isRecording: true, elapsedSec: 0, error: null };
    this.onChange({ ...this.state });

    this.timerId = window.setInterval(() => {
      this.state = {
        ...this.state,
        elapsedSec: Math.floor((Date.now() - this.startTime) / 1000),
      };
      this.onChange({ ...this.state });
    }, 500);
  }

  public stop(): void {
    if (!this.state.isRecording) return;
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.state = { isRecording: false, elapsedSec: 0, error: null };
    this.onChange({ ...this.state });
  }

  public dispose(): void {
    this.stop();
  }
}
