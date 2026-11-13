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
          className="pointer-events-auto fixed right-6 top-20 z-30 w-60 overflow-hidden rounded-lg border border-white/15 bg-stone-950/95 shadow-2xl"
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
                      ? state.handsCount > 1
                        ? '2 Hands Locked'
                        : '1 Hand Locked'
                      : 'Show Hand(s)'}
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
                width={240}
                height={156}
                className="block h-[156px] w-full"
              />
              {state.status === 'starting' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/75 px-3 text-center text-[11px] text-stone-300">
                  Loading dual-hand landmark model...
                </div>
              )}

              {state.twoHandZoomActive && (
                <div className="absolute left-2 top-2 rounded border border-cyan-300/50 bg-stone-950/90 px-2 py-0.5 text-[10px] font-medium text-cyan-200">
                  Pinch-Zoom Active
                </div>
              )}

              {state.chapterGestureProgress > 0 && (
                <div className="absolute inset-x-2 bottom-9 rounded border border-amber-300/40 bg-stone-950/90 px-2 py-1">
                  <div className="flex items-center justify-between text-[10px] text-amber-200">
                    <span>Hold Peace Sign · Next Chapter</span>
                    <span className="font-mono-tabular">
                      {Math.round(state.chapterGestureProgress * 100)}%
                    </span>
                  </div>
                  <div className="mt-1 h-1 w-full overflow-hidden rounded bg-white/15">
                    <div
                      className="h-full bg-amber-300 transition-[width] duration-75"
                      style={{ width: `${Math.round(state.chapterGestureProgress * 100)}%` }}
                    />
                  </div>
                </div>
              )}

              {state.status === 'active' && (
                <div className="flex items-center justify-between border-t border-white/10 bg-stone-950/90 px-3 py-1.5 font-mono-tabular text-[11px] text-stone-400">
                  <span>Pinch {Math.round(state.pinchStrength * 100)}%</span>
                  <span>
                    {state.handsCount > 1
                      ? `H2 ${Math.round(state.secondaryPinchStrength * 100)}%`
                      : 'V-Pose: Chapter'}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
};
