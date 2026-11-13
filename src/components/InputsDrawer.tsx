import React, { useRef, useState } from 'react';
import {
  Bluetooth,
  Download,
  FileSpreadsheet,
  Pause,
  Play,
  Repeat,
  Upload,
  Wifi,
  X,
} from 'lucide-react';
import { createSampleNatureRecording, recordingToCsvText } from '../data/chapters';
import { HardwareConnectionState, PlaybackStatus } from '../types/simulation';

interface InputsDrawerProps {
  open: boolean;
  onClose: () => void;
  hardware: HardwareConnectionState;
  playback: PlaybackStatus;
  onConnectBle: () => void;
  onDisconnectBle: () => void;
  onConnectWs: (url: string) => void;
  onDisconnectWs: () => void;
  onLoadSampleRecording: () => void;
  onLoadFile: (fileName: string, content: string) => void;
  onTogglePlayback: () => void;
  onToggleLoop: (loop: boolean) => void;
  onChangeSpeed: (speed: number) => void;
  onScrubPlayback: (timeMs: number) => void;
}

type DrawerTab = 'playback' | 'ble' | 'wifi';

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const InputsDrawer: React.FC<InputsDrawerProps> = ({
  open,
  onClose,
  hardware,
  playback,
  onConnectBle,
  onDisconnectBle,
  onConnectWs,
  onDisconnectWs,
  onLoadSampleRecording,
  onLoadFile,
  onTogglePlayback,
  onToggleLoop,
  onChangeSpeed,
  onScrubPlayback,
}) => {
  const [tab, setTab] = useState<DrawerTab>('playback');
  const [wsInput, setWsInput] = useState(hardware.wsUrl || 'ws://192.168.4.1:81');
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!open) return null;

  const handleFileSelection = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    onLoadFile(file.name, text);
  };

  const handleDownloadSample = () => {
    const sample = createSampleNatureRecording();
    const csv = recordingToCsvText(sample);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = sample.name;
    document.body.appendChild(a);
    a.click();
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }, 200);
  };

  return (
    <aside
      aria-label="Hardware and sensor playback inputs"
      className="pointer-events-auto fixed bottom-24 right-6 z-40 w-[min(420px,calc(100vw-3rem))] rounded-lg border border-white/15 bg-stone-950/95 p-5 text-stone-100 shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <div>
          <h3 className="font-display text-xl font-semibold tracking-wide text-stone-50">
            Physical &amp; Sensor Inputs
          </h3>
          <p className="text-xs text-stone-400">
            Recorded nature logs · ESP32 wireless telemetry
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inputs drawer"
          className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 text-stone-400 transition-colors hover:border-white/30 hover:text-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Tab Selector */}
      <div className="mt-4 grid grid-cols-3 gap-1 rounded-md border border-white/10 bg-black/60 p-1">
        <button
          type="button"
          onClick={() => setTab('playback')}
          className={`flex items-center justify-center gap-1.5 rounded px-2.5 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
            tab === 'playback'
              ? 'bg-stone-100 text-stone-950'
              : 'text-stone-300 hover:text-white'
          }`}
        >
          <FileSpreadsheet className="h-3.5 w-3.5" />
          <span>Sensor File</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('ble')}
          className={`flex items-center justify-center gap-1.5 rounded px-2.5 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
            tab === 'ble'
              ? 'bg-stone-100 text-stone-950'
              : 'text-stone-300 hover:text-white'
          }`}
        >
          <Bluetooth className="h-3.5 w-3.5" />
          <span>ESP32 BLE</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('wifi')}
          className={`flex items-center justify-center gap-1.5 rounded px-2.5 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
            tab === 'wifi'
              ? 'bg-stone-100 text-stone-950'
              : 'text-stone-300 hover:text-white'
          }`}
        >
          <Wifi className="h-3.5 w-3.5" />
          <span>ESP32 Wi-Fi</span>
        </button>
      </div>

      {/* Recorded Nature File Tab */}
      {tab === 'playback' && (
        <div className="mt-4 space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void handleFileSelection(e.dataTransfer.files[0]);
            }}
            className={`rounded-md border border-dashed p-4 text-center transition-colors ${
              dragging
                ? 'border-cyan-300 bg-cyan-950/30'
                : 'border-white/20 bg-black/40 hover:border-white/35'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.json,.txt"
              className="hidden"
              onChange={(e) => void handleFileSelection(e.target.files?.[0])}
            />
            <Upload className="mx-auto mb-2 h-5 w-5 text-stone-300" />
            <p className="text-xs text-stone-200">
              Drop a recorded nature <span className="font-mono-tabular">.csv</span> or{' '}
              <span className="font-mono-tabular">.json</span> log here
            </p>
            <p className="mt-1 text-[11px] text-stone-400">
              Auto-normalizes Arduino/IMU columns (<span className="font-mono-tabular">time_ms, x, y, force, wind</span>)
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium text-stone-100 whitespace-nowrap hover:bg-white/20"
              >
                Choose File
              </button>
              <button
                type="button"
                onClick={onLoadSampleRecording}
                className="rounded border border-cyan-400/40 bg-cyan-500/15 px-3 py-1.5 text-xs font-medium text-cyan-200 whitespace-nowrap hover:bg-cyan-500/25"
              >
                Load Birch Sway Sample
              </button>
              <button
                type="button"
                onClick={handleDownloadSample}
                title="Download sample CSV template"
                className="inline-flex items-center gap-1 rounded border border-white/15 px-2.5 py-1.5 text-xs text-stone-300 whitespace-nowrap hover:border-white/35 hover:text-white"
              >
                <Download className="h-3.5 w-3.5" />
                <span>CSV Sample</span>
              </button>
            </div>
          </div>

          {playback.error && (
            <p className="rounded border border-red-400/40 bg-red-950/40 px-3 py-2 text-xs text-red-200">
              {playback.error}
            </p>
          )}

          {playback.hasRecording && (
            <div className="space-y-3 rounded-md border border-white/10 bg-black/50 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-stone-100">
                    {playback.fileName}
                  </p>
                  <p className="font-mono-tabular text-[11px] text-stone-400">
                    {playback.sampleCount} samples · {formatDuration(playback.durationMs)}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={onTogglePlayback}
                    className="inline-flex items-center gap-1.5 rounded bg-stone-100 px-3 py-1.5 text-xs font-semibold text-stone-950 whitespace-nowrap hover:bg-white"
                  >
                    {playback.playing ? (
                      <>
                        <Pause className="h-3.5 w-3.5" />
                        <span>Pause</span>
                      </>
                    ) : (
                      <>
                        <Play className="h-3.5 w-3.5" />
                        <span>Play</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleLoop(!playback.loop)}
                    aria-pressed={playback.loop}
                    title="Toggle loop"
                    className={`flex h-8 w-8 items-center justify-center rounded border transition-colors ${
                      playback.loop
                        ? 'border-cyan-400/50 bg-cyan-500/20 text-cyan-200'
                        : 'border-white/15 text-stone-400 hover:text-white'
                    }`}
                  >
                    <Repeat className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div>
                <input
                  type="range"
                  min={0}
                  max={playback.durationMs}
                  step={20}
                  value={playback.currentTimeMs}
                  onChange={(e) => onScrubPlayback(Number(e.target.value))}
                  aria-label="Sensor playback timeline"
                  className="exhibition-range w-full"
                />
                <div className="mt-1.5 flex items-center justify-between font-mono-tabular text-[11px] text-stone-400">
                  <span>
                    {formatDuration(playback.currentTimeMs)} / {formatDuration(playback.durationMs)}
                  </span>
                  <div className="flex items-center gap-1">
                    {[0.5, 1, 2].map((spd) => (
                      <button
                        key={spd}
                        type="button"
                        onClick={() => onChangeSpeed(spd)}
                        className={`rounded px-1.5 py-0.5 text-[11px] transition-colors ${
                          playback.speed === spd
                            ? 'bg-white/20 text-white'
                            : 'text-stone-400 hover:text-stone-200'
                        }`}
                      >
                        {spd}x
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ESP32 Web Bluetooth Tab */}
      {tab === 'ble' && (
        <div className="mt-4 space-y-3.5">
          <div className="rounded-md border border-white/10 bg-black/50 p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-stone-100">
                  {hardware.bleStatus === 'connected'
                    ? `Connected: ${hardware.bleDeviceName}`
                    : hardware.bleStatus === 'connecting'
                      ? 'Pairing via Web Bluetooth...'
                      : 'Nordic UART BLE Bridge'}
                </p>
                <p className="mt-0.5 text-[11px] text-stone-400">
                  Scans for ESP32, Arduino, or Nordic UART devices
                </p>
              </div>
              {hardware.bleStatus === 'connected' ? (
                <button
                  type="button"
                  onClick={onDisconnectBle}
                  className="rounded border border-red-400/40 bg-red-500/15 px-3 py-1.5 text-xs font-medium text-red-200 whitespace-nowrap hover:bg-red-500/25"
                >
                  Disconnect
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onConnectBle}
                  disabled={hardware.bleStatus === 'connecting'}
                  className="rounded bg-cyan-300 px-3 py-1.5 text-xs font-semibold text-stone-950 whitespace-nowrap hover:bg-cyan-200 disabled:opacity-50"
                >
                  Pair Device
                </button>
              )}
            </div>

            {hardware.bleError && (
              <p className="mt-3 rounded border border-red-400/40 bg-red-950/40 px-2.5 py-2 text-xs text-red-200">
                {hardware.bleError}
              </p>
            )}
          </div>

          <div className="rounded-md border border-white/10 bg-black/40 p-3 text-[11px] text-stone-300">
            <p className="font-medium text-stone-100">ESP32 TX Packet Format</p>
            <p className="mt-1 font-mono-tabular text-stone-400">
              0.54,0.62,1.40 &nbsp;|&nbsp; WIND:2.20 &nbsp;|&nbsp; &#123;&quot;x&quot;:0.5,&quot;y&quot;:0.5,&quot;force&quot;:1.2&#125;
            </p>
            <p className="mt-2 font-mono-tabular text-stone-400">
              Packets received: {hardware.packetCount}
              {hardware.lastPacket ? ` · Last: ${hardware.lastPacket}` : ''}
            </p>
          </div>
        </div>
      )}

      {/* ESP32 Wi-Fi WebSocket Tab */}
      {tab === 'wifi' && (
        <div className="mt-4 space-y-3.5">
          <div className="rounded-md border border-white/10 bg-black/50 p-3.5">
            <label
              htmlFor="esp32-ws-url"
              className="block text-xs font-medium text-stone-200"
            >
              ESP32 WebSocket Endpoint
            </label>
            <div className="mt-2 flex gap-2">
              <input
                id="esp32-ws-url"
                type="text"
                value={wsInput}
                onChange={(e) => setWsInput(e.target.value)}
                placeholder="ws://192.168.4.1:81"
                className="min-w-0 flex-1 rounded border border-white/15 bg-black px-3 py-1.5 font-mono-tabular text-xs text-stone-100 focus:border-cyan-300 focus:outline-none"
              />
              {hardware.wsStatus === 'connected' ? (
                <button
                  type="button"
                  onClick={onDisconnectWs}
                  className="rounded border border-red-400/40 bg-red-500/15 px-3 py-1.5 text-xs font-medium text-red-200 whitespace-nowrap hover:bg-red-500/25"
                >
                  Disconnect
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onConnectWs(wsInput)}
                  disabled={hardware.wsStatus === 'connecting'}
                  className="rounded bg-cyan-300 px-3 py-1.5 text-xs font-semibold text-stone-950 whitespace-nowrap hover:bg-cyan-200 disabled:opacity-50"
                >
                  {hardware.wsStatus === 'connecting' ? 'Connecting...' : 'Connect'}
                </button>
              )}
            </div>

            {hardware.wsError && (
              <p className="mt-3 rounded border border-red-400/40 bg-red-950/40 px-2.5 py-2 text-xs text-red-200">
                {hardware.wsError}
              </p>
            )}
          </div>

          <div className="rounded-md border border-white/10 bg-black/40 p-3 text-[11px] text-stone-300">
            <p className="font-medium text-stone-100">Gallery Wi-Fi Stream</p>
            <p className="mt-1 text-stone-400">
              Ideal for longer-range ESP32 installations over local Wi-Fi without Bluetooth pairing prompts.
            </p>
            <p className="mt-2 font-mono-tabular text-stone-400">
              Status: {hardware.wsStatus} · Packets: {hardware.packetCount}
            </p>
          </div>
        </div>
      )}
    </aside>
  );
};
