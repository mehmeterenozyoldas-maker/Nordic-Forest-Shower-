import React from 'react';
import { Hand, RefreshCw, X } from 'lucide-react';
import { HandTrackingState } from '../types/simulation';

interface HandTrackingPipProps {
  state: HandTrackingState;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  previewCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  onRetry: () => void;
  onStop: () => void;
}

export const HandTrackingPip: React.FC<HandTrackingPipProps> = ({
  state,
  videoRef,
  previewCanvasRef,
  onRetry,
  onStop,
}) => {
  const isVisible = state.status !== 'idle';

  return (
    <>
      {/* Hidden live video element kept active in DOM layout so browser decodes webcam frames */}
      <video
        ref={videoRef}
        playsInline
        muted
        className="pointer-events-none fixed left-0 top-0 h-px w-px opacity-0"
      />

      {isVisible && (
        <div
          aria-label="Hand tracking preview"
          className="pointer-events-auto fixed right-6 top-20 z-30 w-56 overflow-hidden rounded-lg border border-white/15 bg-stone-950/95 shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-stone-100">
              <Hand className="h-3.5 w-3.5 text-cyan-300" />
              <span>
                {state.status === 'starting'
                  ? 'Starting Camera...'
                  : state.status === 'error'
                    ? 'Camera Error'
                    : state.handDetected
                      ? 'Hand Locked'
                      : 'Show Hand'}
              </span>
            </div>
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop hand tracking"
              className="text-stone-400 transition-colors hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {state.status === 'error' ? (
            <div className="space-y-2.5 p-3">
              <p className="text-[11px] leading-relaxed text-red-200">{state.error}</p>
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 rounded border border-white/20 bg-white/10 px-2.5 py-1 text-[11px] font-medium text-stone-100 hover:bg-white/20"
              >
                <RefreshCw className="h-3 w-3" />
                <span>Retry Camera</span>
              </button>
            </div>
          ) : (
            <div className="relative bg-black">
              <canvas
                ref={previewCanvasRef}
                width={224}
                height={150}
                className="block h-[150px] w-full"
              />
              {state.status === 'starting' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/75 px-3 text-center text-[11px] text-stone-300">
                  Loading hand landmark model...
                </div>
              )}
              {state.status === 'active' && (
                <div className="flex items-center justify-between border-t border-white/10 bg-stone-950/90 px-3 py-1.5 font-mono-tabular text-[11px] text-stone-400">
                  <span>Index · Cursor</span>
                  <span>Pinch {Math.round(state.pinchStrength * 100)}%</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
};
