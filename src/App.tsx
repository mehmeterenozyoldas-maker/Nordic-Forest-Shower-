import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Archive,
  Circle,
  CloudSun,
  Eye,
  EyeOff,
  Glasses,
  Hand,
  Monitor,
  Radio,
  RotateCcw,
  Sliders,
  Sprout,
  Square,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { ArchiveDrawer } from './components/ArchiveDrawer';
import { CollabPopover } from './components/CollabPopover';
import { HandTrackingPip } from './components/HandTrackingPip';
import { InputsDrawer } from './components/InputsDrawer';
import { StudioDrawer } from './components/StudioDrawer';
import { createSampleNatureRecording, EXHIBITION_CHAPTERS } from './data/chapters';
import { SimulationController } from './engine/SimulationController';
import {
  appreciateForestPlate,
  fetchAtmospherePresets,
  fetchForestPlateById,
  fetchForestPlates,
  publishForestPlate,
  removeAtmospherePreset,
  removeForestPlate,
  restoreCuratorSession,
  saveAtmospherePreset,
  signInCurator,
  signOutCurator,
} from './services/archiveApi';
import {
  AtmospherePreset,
  CuratorProfile,
  ForestPlate,
  InteractionContext,
  InteractionMode,
  PlantSpecies,
  SimulationHUDState,
} from './types/simulation';

const INTERACTION_CONTEXTS: InteractionContext[] = [
  'All',
  'Trees Only',
  'Water Only',
  'Ground Only',
];

const INTERACTION_MODES: InteractionMode[] = [
  'Wind Gust',
  'Fluid Push/Pull',
  'Tornado',
  'Parting',
  'Aurora Field',
  'Seismic Ripple',
];

const PLANT_SPECIES: PlantSpecies[] = ['Oak', 'Pine', 'Bush'];

const INITIAL_HUD: SimulationHUDState = {
  mode: 'explore',
  plantType: 'Oak',
  plantedCount: 0,
  chapterIndex: 0,
  activePlateTitle: null,
  activePlateAuthor: null,
  activePlateAccession: null,
  season: 'autumn',
  sunElevation: 0.3,
  sunAzimuth: 0.5,
  fogDensity: 0.018,
  bloomStrength: 0.9,
  windStrength: 2.0,
  windDirection: 0.0,
  interactionMode: 'Wind Gust',
  interactionContext: 'All',
  interactionRadius: 5.5,
  activeSource: 'pointer',
  secondaryCursorActive: false,
  attractMode: false,
  audioEnabled: false,
  audioMuted: false,
  cursorNdc: { x: 0.5, y: 0.5 },
  cursorSpeed: 0,
  handTracking: {
    status: 'idle',
    handDetected: false,
    handsCount: 0,
    pinchStrength: 0,
    secondaryPinchStrength: 0,
    twoHandZoomActive: false,
    chapterGestureProgress: 0,
    gestureHint: null,
    error: null,
  },
  hardware: {
    bleStatus: 'disconnected',
    bleDeviceName: null,
    bleError: null,
    wsStatus: 'disconnected',
    wsUrl: 'ws://192.168.4.1:81',
    wsError: null,
    packetCount: 0,
    lastPacket: null,
  },
  playback: {
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
  },
  recording: { isRecording: false, elapsedSec: 0, error: null },
  webxr: { supported: false, active: false, controllersConnected: 0, error: null },
  weather: {
    enabled: false,
    loading: false,
    stationId: 'tromso',
    stationName: 'Tromsø',
    solarElevationDeg: 0,
    observation: null,
    error: null,
  },
  collab: {
    status: 'disconnected',
    roomId: 'fjord-hall',
    selfId: '',
    selfName: 'Guest Visitor',
    selfColor: '#67e8f9',
    visitors: [],
    error: null,
  },
  kiosk: {
    enabled: false,
    intervalSec: 45,
    plateIndex: 0,
    plateTotal: 0,
  },
  webglLost: false,
  isSoftwareGl: false,
};

function formatRecTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<SimulationController | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [hud, setHud] = useState<SimulationHUDState>(INITIAL_HUD);
  const [inputsOpen, setInputsOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  const [collabOpen, setCollabOpen] = useState(false);
  const [hudCollapsed, setHudCollapsed] = useState(false);
  const [placardVisible, setPlacardVisible] = useState(true);

  // Archive, Curator & Preset State
  const [curator, setCurator] = useState<CuratorProfile | null>(null);
  const [plates, setPlates] = useState<ForestPlate[]>([]);
  const [platesLoading, setPlatesLoading] = useState(false);
  const [platesError, setPlatesError] = useState<string | null>(null);
  const [archiveScope, setArchiveScope] = useState<'gallery' | 'mine'>('gallery');
  const [archiveSort, setArchiveSort] = useState<'recent' | 'popular'>('recent');
  const [archiveSearch, setArchiveSearch] = useState('');
  const [presets, setPresets] = useState<AtmospherePreset[]>([]);

  const loadArchiveData = useCallback(async () => {
    setPlatesLoading(true);
    setPlatesError(null);
    try {
      const [fetchedPlates, fetchedPresets] = await Promise.all([
        fetchForestPlates({
          scope: archiveScope,
          sort: archiveSort,
          query: archiveSearch,
        }),
        fetchAtmospherePresets(),
      ]);
      setPlates(fetchedPlates);
      setPresets(fetchedPresets);
      if (archiveScope === 'gallery' && !archiveSearch) {
        controllerRef.current?.setKioskPlates(fetchedPlates);
      }
    } catch (err) {
      setPlatesError(err instanceof Error ? err.message : 'Failed to load archive.');
    } finally {
      setPlatesLoading(false);
    }
  }, [archiveScope, archiveSort, archiveSearch]);

  useEffect(() => {
    const mount = canvasMountRef.current;
    if (!mount) return;

    const controller = new SimulationController(mount, setHud);
    controllerRef.current = controller;
    controller.attachHandTrackingElements(videoRef.current, previewCanvasRef.current);

    // Bootstrap curator session, initial gallery plates (for Kiosk), and URL deep-links
    void (async () => {
      const restoredCurator = await restoreCuratorSession();
      if (restoredCurator) setCurator(restoredCurator);

      const urlParams = new URLSearchParams(window.location.search);
      const forestId = urlParams.get('forest');
      const roomId = urlParams.get('room');
      const kioskParam = urlParams.get('kiosk');

      if (forestId) {
        try {
          const plate = await fetchForestPlateById(forestId);
          controller.loadForestPlate(plate);
        } catch {
          // Ignore unknown plate id
        }
      }
      if (roomId) {
        controller.joinCollabRoom(roomId, restoredCurator?.displayName);
      }

      try {
        const publicPlates = await fetchForestPlates({ scope: 'gallery', sort: 'popular' });
        controller.setKioskPlates(publicPlates);
        if (kioskParam === '1') {
          controller.setKioskMode(true, 45);
        }
      } catch {
        // Ignore initial preload failure
      }
    })();

    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    void loadArchiveData();
  }, [loadArchiveData]);

  useEffect(() => {
    controllerRef.current?.attachHandTrackingElements(
      videoRef.current,
      previewCanvasRef.current,
    );
  }, [hud.handTracking.status]);

  // Kinetic museum placard entrance whenever chapter or loaded plate changes
  useEffect(() => {
    setPlacardVisible(false);
    const id = window.setTimeout(() => setPlacardVisible(true), 60);
    return () => window.clearTimeout(id);
  }, [hud.chapterIndex, hud.activePlateAccession]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const k = e.key.toLowerCase();
      if (k === 'b' || k === 'i') {
        setInputsOpen((prev) => !prev);
      } else if (k === 'u' || k === 'h') {
        setHudCollapsed((prev) => !prev);
      } else if (k === 'p') {
        controllerRef.current?.setMode(hud.mode === 'explore' ? 'plant' : 'explore');
      } else if (k === 'k') {
        controllerRef.current?.setKioskMode(!hud.kiosk.enabled, 45);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hud.mode, hud.kiosk.enabled]);

  const currentChapter = EXHIBITION_CHAPTERS[hud.chapterIndex] ?? EXHIBITION_CHAPTERS[0];
  const anyHardwareConnected =
    hud.hardware.bleStatus === 'connected' ||
    hud.hardware.wsStatus === 'connected' ||
    hud.playback.playing;

  const togglePanel = (target: 'archive' | 'studio' | 'collab' | 'inputs') => {
    setArchiveOpen(target === 'archive' ? !archiveOpen : false);
    setStudioOpen(target === 'studio' ? !studioOpen : false);
    setCollabOpen(target === 'collab' ? !collabOpen : false);
    setInputsOpen(target === 'inputs' ? !inputsOpen : false);
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black text-stone-100">
      {/* Dedicated Isolated WebGL Canvas Container */}
      <div ref={canvasMountRef} className="h-full w-full" />

      {/* Hand Tracking Webcam Pipeline & Compact Preview */}
      <HandTrackingPip
        state={hud.handTracking}
        videoRef={videoRef}
        previewCanvasRef={previewCanvasRef}
        onRetry={() => void controllerRef.current?.toggleHandTracking()}
        onStop={() => void controllerRef.current?.toggleHandTracking()}
      />

      {/* WebGL Context Loss Guard */}
      {hud.webglLost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-6 text-center">
          <div className="max-w-md rounded-lg border border-white/15 bg-stone-950 p-6">
            <h2 className="font-display text-2xl text-stone-50">Graphics Context Paused</h2>
            <p className="mt-2 text-sm text-stone-300">
              The browser suspended the WebGL context. Restoring particle simulation automatically.
            </p>
          </div>
        </div>
      )}

      {/* Museum Kiosk Mode Overlay */}
      {hud.kiosk.enabled ? (
        <div className="pointer-events-none fixed inset-0 z-30 flex flex-col justify-between p-8">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-mono-tabular text-xs uppercase tracking-[0.2em] text-stone-400">
                Nordic Simulation · Exhibition Projection
              </p>
              <h1 className="font-display mt-1 text-4xl text-stone-50">
                {hud.activePlateTitle ?? currentChapter.title}
              </h1>
              <p className="mt-1 text-xs text-stone-300">
                {hud.activePlateAccession ?? currentChapter.accessionCode}
                {hud.activePlateAuthor ? ` · Curated by ${hud.activePlateAuthor}` : ''}
                {hud.weather.enabled && hud.weather.observation
                  ? ` · Live ${hud.weather.stationName} (${hud.weather.observation.temperatureC.toFixed(
                      1,
                    )}°C)`
                  : ''}
              </p>
            </div>
            <div className="pointer-events-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => controllerRef.current?.advanceKioskPlate()}
                className="rounded-md border border-white/20 bg-stone-950/90 px-3 py-1.5 text-xs text-stone-200 hover:border-white/40 hover:text-white"
              >
                Next Plate
              </button>
              <button
                type="button"
                onClick={() => controllerRef.current?.setKioskMode(false)}
                className="rounded-md border border-white/20 bg-stone-950/90 px-3 py-1.5 text-xs text-stone-200 hover:border-white/40 hover:text-white"
              >
                Exit Kiosk (K)
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Standard Interactive Museum UI Overlay */
        <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between p-6">
          {/* Top Bar */}
          <header className="flex items-start justify-between gap-4">
            <div
              className={`transition-all duration-500 ease-out ${
                hudCollapsed ? '-translate-y-2 opacity-0' : 'translate-y-0 opacity-100'
              }`}
            >
              <h1 className="font-display text-3xl font-normal tracking-[0.14em] text-stone-50 sm:text-4xl">
                Nordic Simulation
              </h1>
              <p className="mt-1 max-w-md text-xs leading-relaxed text-stone-400">
                Interactive forest archive · Persistent fluid wakes · Spatial WebXR
              </p>
            </div>

            <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => togglePanel('archive')}
                className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
                  archiveOpen
                    ? 'border-emerald-300/60 bg-emerald-950/90 text-emerald-100'
                    : 'border-white/15 bg-stone-950/90 text-stone-200 hover:border-white/30 hover:text-white'
                }`}
              >
                <Archive className="h-3.5 w-3.5" />
                <span>Archive Gallery</span>
              </button>

              <button
                type="button"
                onClick={() => togglePanel('studio')}
                className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
                  studioOpen || hud.weather.enabled
                    ? 'border-cyan-300/60 bg-stone-900/95 text-cyan-100'
                    : 'border-white/15 bg-stone-950/90 text-stone-200 hover:border-white/30 hover:text-white'
                }`}
              >
                {hud.weather.enabled ? (
                  <CloudSun className="h-3.5 w-3.5 text-cyan-300" />
                ) : (
                  <Sliders className="h-3.5 w-3.5" />
                )}
                <span>
                  {hud.weather.enabled ? `Live · ${hud.weather.stationName}` : 'Atmosphere'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => togglePanel('collab')}
                className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
                  collabOpen || hud.collab.status === 'connected'
                    ? 'border-cyan-300/60 bg-cyan-950/90 text-cyan-100'
                    : 'border-white/15 bg-stone-950/90 text-stone-200 hover:border-white/30 hover:text-white'
                }`}
              >
                <Users className="h-3.5 w-3.5" />
                <span>
                  {hud.collab.status === 'connected'
                    ? `Room · ${hud.collab.visitors.length}`
                    : 'Live Room'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => void controllerRef.current?.toggleMuteAudio()}
                className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
                  hud.audioEnabled && !hud.audioMuted
                    ? 'border-white/30 bg-stone-900/95 text-stone-100'
                    : 'border-white/15 bg-stone-950/90 text-stone-300 hover:border-white/30 hover:text-white'
                }`}
              >
                {hud.audioEnabled && !hud.audioMuted ? (
                  <Volume2 className="h-3.5 w-3.5 text-cyan-300" />
                ) : (
                  <VolumeX className="h-3.5 w-3.5" />
                )}
                <span>
                  {hud.audioEnabled ? (hud.audioMuted ? 'Muted' : 'Sound On') : 'Sound'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => void controllerRef.current?.toggleHandTracking()}
                className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
                  hud.handTracking.status === 'active'
                    ? 'border-cyan-300/60 bg-cyan-950/90 text-cyan-100'
                    : 'border-white/15 bg-stone-950/90 text-stone-200 hover:border-white/30 hover:text-white'
                }`}
              >
                <Hand className="h-3.5 w-3.5" />
                <span>
                  {hud.handTracking.status === 'starting'
                    ? 'Starting...'
                    : hud.handTracking.status === 'active'
                      ? 'Stop Hands'
                      : 'Hands'}
                </span>
              </button>

              <button
                type="button"
                disabled={!hud.webxr.supported}
                onClick={() => void controllerRef.current?.toggleVR()}
                title={
                  hud.webxr.supported
                    ? 'Enter immersive WebXR VR installation'
                    : 'WebXR headset not detected in this browser'
                }
                className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
                  hud.webxr.active
                    ? 'border-cyan-300/60 bg-cyan-950/90 text-cyan-100'
                    : hud.webxr.supported
                      ? 'border-white/15 bg-stone-950/90 text-stone-200 hover:border-cyan-300/40 hover:text-white'
                      : 'cursor-not-allowed border-white/10 bg-stone-950/60 text-stone-500'
                }`}
              >
                <Glasses className="h-3.5 w-3.5" />
                <span>{hud.webxr.active ? 'Exit VR' : 'VR'}</span>
              </button>

              <button
                type="button"
                onClick={() => togglePanel('inputs')}
                className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
                  inputsOpen || anyHardwareConnected
                    ? 'border-cyan-300/50 bg-stone-900/95 text-cyan-100'
                    : 'border-white/15 bg-stone-950/90 text-stone-200 hover:border-white/30 hover:text-white'
                }`}
              >
                <Radio className="h-3.5 w-3.5" />
                <span>Sensors</span>
              </button>

              <button
                type="button"
                onClick={() => controllerRef.current?.toggleRecording()}
                className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
                  hud.recording.isRecording
                    ? 'border-red-400 bg-red-600/90 text-white'
                    : 'border-white/15 bg-stone-950/90 text-stone-200 hover:border-red-400/50 hover:text-white'
                }`}
              >
                {hud.recording.isRecording ? (
                  <>
                    <Square className="h-3 w-3 fill-current" />
                    <span className="font-mono-tabular">
                      {formatRecTime(hud.recording.elapsedSec)}
                    </span>
                  </>
                ) : (
                  <>
                    <Circle className="h-3 w-3 fill-red-400 text-red-400" />
                    <span>Rec</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => controllerRef.current?.setKioskMode(true, 45)}
                title="Enter Museum Kiosk Loop (K)"
                className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-stone-950/90 px-3 py-2 text-xs font-medium text-stone-300 whitespace-nowrap transition-colors hover:border-white/30 hover:text-white"
              >
                <Monitor className="h-3.5 w-3.5" />
                <span>Kiosk</span>
              </button>

              <button
                type="button"
                onClick={() => setHudCollapsed((prev) => !prev)}
                title="Toggle Zen View (U)"
                className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-stone-950/90 px-3 py-2 text-xs font-medium text-stone-300 whitespace-nowrap transition-colors hover:border-white/30 hover:text-white"
              >
                {hudCollapsed ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                <span>{hudCollapsed ? 'HUD' : 'Zen'}</span>
              </button>
            </div>
          </header>

          {/* Center Attract Mode Prompt */}
          {hud.attractMode && !hudCollapsed && (
            <div className="pointer-events-none mx-auto flex flex-col items-center text-center transition-opacity duration-500">
              <div className="mb-3 h-12 w-12 rounded-full border border-white/35" />
              <p className="text-xs uppercase tracking-[0.22em] text-stone-200">
                Move pointer, wave hand, or join a live room to interact
              </p>
            </div>
          )}

          {/* Bottom Area: Curatorial Placard + Unified Control Dock */}
          {!hudCollapsed && (
            <div className="flex flex-col gap-4">
              {/* Kinetic Curatorial Info Placard */}
              <div
                className={`max-w-md rounded-lg border border-white/15 bg-stone-950/90 p-5 transition-all duration-500 ease-out ${
                  placardVisible ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-stone-400">
                    {hud.activePlateAccession ?? currentChapter.accessionCode}
                  </p>
                  {hud.plantedCount > 0 && (
                    <span className="font-mono-tabular text-[11px] text-emerald-300">
                      +{hud.plantedCount} Planted
                    </span>
                  )}
                </div>
                <h2 className="font-display mt-1 text-2xl font-semibold text-stone-50">
                  {hud.activePlateTitle ?? currentChapter.title}
                </h2>
                <p className="mt-2 text-xs leading-relaxed text-stone-300">
                  {hud.activePlateAuthor
                    ? `Archived by ${hud.activePlateAuthor} · ${hud.season} palette · ${hud.interactionMode}`
                    : currentChapter.desc}
                </p>
              </div>

              {/* Unified Bottom Control Dock */}
              <div className="pointer-events-auto mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 rounded-lg border border-white/15 bg-stone-950/92 px-4 py-3">
                {/* Chapter Navigation */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {EXHIBITION_CHAPTERS.map((ch, idx) => (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => controllerRef.current?.setChapter(idx)}
                      className={`rounded px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                        hud.chapterIndex === idx && !hud.activePlateTitle
                          ? 'bg-stone-100 text-stone-950'
                          : 'border border-white/10 bg-black/50 text-stone-300 hover:border-white/30 hover:text-white'
                      }`}
                    >
                      {ch.shortLabel}
                    </button>
                  ))}
                </div>

                {/* Explore vs Plant Mode Switch */}
                <div className="flex items-center gap-1.5">
                  <div className="flex items-center gap-1 rounded border border-white/10 bg-black/60 p-0.5">
                    <button
                      type="button"
                      onClick={() => controllerRef.current?.setMode('explore')}
                      className={`rounded px-2.5 py-1 text-xs whitespace-nowrap transition-colors ${
                        hud.mode === 'explore'
                          ? 'bg-stone-100 font-semibold text-stone-950'
                          : 'text-stone-300 hover:text-white'
                      }`}
                    >
                      Explore
                    </button>
                    <button
                      type="button"
                      onClick={() => controllerRef.current?.setMode('plant')}
                      className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs whitespace-nowrap transition-colors ${
                        hud.mode === 'plant'
                          ? 'bg-emerald-300 font-semibold text-stone-950'
                          : 'text-stone-300 hover:text-white'
                      }`}
                    >
                      <Sprout className="h-3 w-3" />
                      <span>Plant</span>
                    </button>
                  </div>

                  {hud.mode === 'plant' && (
                    <div className="flex items-center gap-1 rounded border border-emerald-400/25 bg-black/60 p-0.5">
                      {PLANT_SPECIES.map((sp) => (
                        <button
                          key={sp}
                          type="button"
                          onClick={() => controllerRef.current?.setPlantType(sp)}
                          className={`rounded px-2 py-1 text-xs whitespace-nowrap transition-colors ${
                            hud.plantType === sp
                              ? 'bg-emerald-400/90 font-semibold text-stone-950'
                              : 'text-stone-300 hover:text-white'
                          }`}
                        >
                          {sp}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Context Target Filter (Explore Mode) */}
                {hud.mode === 'explore' && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-stone-400 whitespace-nowrap">Target</span>
                    <div className="flex items-center gap-1 rounded border border-white/10 bg-black/60 p-0.5">
                      {INTERACTION_CONTEXTS.map((ctx) => (
                        <button
                          key={ctx}
                          type="button"
                          onClick={() => controllerRef.current?.setInteractionContext(ctx)}
                          className={`rounded px-2.5 py-1 text-xs whitespace-nowrap transition-colors ${
                            hud.interactionContext === ctx
                              ? 'bg-cyan-300 font-semibold text-stone-950'
                              : 'text-stone-300 hover:text-white'
                          }`}
                        >
                          {ctx.replace(' Only', '')}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Physics Mode & Wake Reset */}
                <div className="flex items-center gap-2">
                  {hud.mode === 'explore' && (
                    <select
                      aria-label="Interaction physics mode"
                      value={hud.interactionMode}
                      onChange={(e) =>
                        controllerRef.current?.setInteractionMode(e.target.value as InteractionMode)
                      }
                      className="rounded border border-white/15 bg-black px-2.5 py-1.5 text-xs text-stone-100 focus:border-cyan-300 focus:outline-none"
                    >
                      {INTERACTION_MODES.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  )}

                  <button
                    type="button"
                    onClick={() => controllerRef.current?.clearFluidWakes()}
                    title="Clear persistent GPU fluid wakes"
                    className="inline-flex items-center gap-1 rounded border border-white/15 bg-black/50 px-2.5 py-1.5 text-xs text-stone-300 whitespace-nowrap transition-colors hover:border-white/35 hover:text-white"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Reset Wake</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Drawers & Panels */}
      <ArchiveDrawer
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        curator={curator}
        plates={plates}
        loading={platesLoading}
        error={platesError}
        scope={archiveScope}
        sort={archiveSort}
        searchQuery={archiveSearch}
        plantedCount={hud.plantedCount}
        onChangeScope={setArchiveScope}
        onChangeSort={setArchiveSort}
        onChangeSearch={setArchiveSearch}
        onSignIn={async (name, pin) => {
          const prof = await signInCurator(name, pin);
          setCurator(prof);
          controllerRef.current?.updateVisitorName(prof.displayName);
          await loadArchiveData();
        }}
        onSignOut={() => {
          signOutCurator();
          setCurator(null);
          void loadArchiveData();
        }}
        onPublish={async (title, notes, visibility) => {
          const exportData = controllerRef.current?.getArchiveExportPayload();
          if (!exportData) return null;
          const created = await publishForestPlate({
            title,
            notes,
            visibility,
            ...exportData,
          });
          await loadArchiveData();
          return created;
        }}
        onLoadPlate={(plate) => {
          controllerRef.current?.loadForestPlate(plate);
          setArchiveOpen(false);
        }}
        onAppreciate={async (id) => {
          const updated = await appreciateForestPlate(id);
          setPlates((prev) => prev.map((p) => (p.id === id ? updated : p)));
        }}
        onDeletePlate={async (id) => {
          await removeForestPlate(id);
          await loadArchiveData();
        }}
      />

      <StudioDrawer
        open={studioOpen}
        onClose={() => setStudioOpen(false)}
        hud={hud}
        weather={hud.weather}
        presets={presets}
        curator={curator}
        onSelectSeason={(s) => controllerRef.current?.setSeason(s)}
        onChangeSunElevation={(v) => controllerRef.current?.setSunElevation(v)}
        onChangeSunAzimuth={(v) => controllerRef.current?.setSunAzimuth(v)}
        onChangeFogDensity={(v) => controllerRef.current?.setFogDensity(v)}
        onChangeBloomStrength={(v) => controllerRef.current?.setBloomStrength(v)}
        onChangeWindStrength={(v) => controllerRef.current?.setWindStrength(v)}
        onChangeWindDirection={(v) => controllerRef.current?.setWindDirection(v)}
        onChangeInteractionRadius={(v) => controllerRef.current?.setInteractionRadius(v)}
        onEnableStationWeather={(id) => void controllerRef.current?.enableWeatherSync(id)}
        onEnableGeoWeather={() => controllerRef.current?.enableGeolocationWeatherSync()}
        onDisableWeather={() => controllerRef.current?.disableWeatherSync()}
        onApplyPreset={(preset) =>
          controllerRef.current?.applyAtmospherePreset(preset.atmosphere, preset.cameraTarget)
        }
        onSavePreset={async (name) => {
          const exportData = controllerRef.current?.getArchiveExportPayload();
          if (!exportData) return;
          await saveAtmospherePreset({
            name,
            isPublic: true,
            atmosphere: exportData.atmosphere,
            cameraTarget: exportData.cameraTarget,
          });
          await loadArchiveData();
        }}
        onDeletePreset={async (id) => {
          await removeAtmospherePreset(id);
          await loadArchiveData();
        }}
      />

      <CollabPopover
        open={collabOpen}
        onClose={() => setCollabOpen(false)}
        collab={hud.collab}
        defaultVisitorName={curator?.displayName}
        onJoinRoom={(roomId, name) => controllerRef.current?.joinCollabRoom(roomId, name)}
        onLeaveRoom={() => controllerRef.current?.leaveCollabRoom()}
      />

      {/* Hardware & Recorded Nature Playback Drawer */}
      <InputsDrawer
        open={inputsOpen}
        onClose={() => setInputsOpen(false)}
        hardware={hud.hardware}
        playback={hud.playback}
        onConnectBle={() => void controllerRef.current?.connectBle()}
        onDisconnectBle={() => controllerRef.current?.disconnectBle()}
        onConnectWs={(url) => controllerRef.current?.connectWebSocket(url)}
        onDisconnectWs={() => controllerRef.current?.disconnectWebSocket()}
        onLoadSampleRecording={() =>
          controllerRef.current?.loadRecordingObject(createSampleNatureRecording(), true)
        }
        onLoadFile={(name, text) => controllerRef.current?.loadRecordingFile(name, text)}
        onTogglePlayback={() => controllerRef.current?.togglePlayback()}
        onToggleLoop={(loop) => controllerRef.current?.setPlaybackLoop(loop)}
        onChangeSpeed={(spd) => controllerRef.current?.setPlaybackSpeed(spd)}
        onScrubPlayback={(t) => controllerRef.current?.scrubPlayback(t)}
      />
    </div>
  );
}
