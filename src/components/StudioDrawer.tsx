import React, { useState } from 'react';
import { CloudSun, Compass, Plus, Sliders, Trash2, X } from 'lucide-react';
import {
  AtmospherePreset,
  CuratorProfile,
  Season,
  SimulationHUDState,
  WeatherSyncState,
} from '../types/simulation';
import { NORDIC_WEATHER_STATIONS } from '../utils/solar';

interface StudioDrawerProps {
  open: boolean;
  onClose: () => void;
  hud: SimulationHUDState;
  weather: WeatherSyncState;
  presets: AtmospherePreset[];
  curator: CuratorProfile | null;
  onSelectSeason: (season: Season) => void;
  onChangeSunElevation: (rad: number) => void;
  onChangeSunAzimuth: (rad: number) => void;
  onChangeFogDensity: (val: number) => void;
  onChangeBloomStrength: (val: number) => void;
  onChangeWindStrength: (val: number) => void;
  onChangeWindDirection: (rad: number) => void;
  onChangeInteractionRadius: (val: number) => void;
  onEnableStationWeather: (stationId: string) => void;
  onEnableGeoWeather: () => void;
  onDisableWeather: () => void;
  onApplyPreset: (preset: AtmospherePreset) => void;
  onSavePreset: (name: string) => Promise<void>;
  onDeletePreset: (id: string) => Promise<void>;
}

const SEASONS: Season[] = ['autumn', 'spring', 'winter'];

export const StudioDrawer: React.FC<StudioDrawerProps> = ({
  open,
  onClose,
  hud,
  weather,
  presets,
  curator,
  onSelectSeason,
  onChangeSunElevation,
  onChangeSunAzimuth,
  onChangeFogDensity,
  onChangeBloomStrength,
  onChangeWindStrength,
  onChangeWindDirection,
  onChangeInteractionRadius,
  onEnableStationWeather,
  onEnableGeoWeather,
  onDisableWeather,
  onApplyPreset,
  onSavePreset,
  onDeletePreset,
}) => {
  const [presetName, setPresetName] = useState('');
  const [saving, setSaving] = useState(false);
  const [presetError, setPresetError] = useState<string | null>(null);

  if (!open) return null;

  const handleSavePreset = async (e: React.FormEvent) => {
    e.preventDefault();
    setPresetError(null);
    setSaving(true);
    try {
      await onSavePreset(presetName);
      setPresetName('');
    } catch (err) {
      setPresetError(err instanceof Error ? err.message : 'Unable to save preset.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside
      aria-label="Atmosphere studio and weather sync"
      className="fixed left-6 top-20 z-40 flex max-h-[calc(100vh-11rem)] w-[390px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-lg border border-white/15 bg-stone-950/95 shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div className="flex items-center gap-2">
          <Sliders className="h-4 w-4 text-cyan-300" />
          <div>
            <h2 className="font-display text-xl font-semibold text-stone-50">
              Atmosphere & Weather Studio
            </h2>
            <p className="text-xs text-stone-400">
              Custom lighting presets & real-time Nordic telemetry
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close atmosphere studio"
          className="rounded p-1.5 text-stone-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        {/* Real-Time Weather & Solar Sync */}
        <section className="space-y-3 rounded-md border border-white/12 bg-black/55 p-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-stone-100">
              <CloudSun className="h-4 w-4 text-cyan-300" />
              <span>Real-Time Weather & Solar Sync</span>
            </div>
            {weather.enabled && (
              <button
                type="button"
                onClick={onDisableWeather}
                className="rounded border border-white/20 px-2 py-0.5 text-[11px] text-stone-300 hover:text-white"
              >
                Unlock Manual
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {NORDIC_WEATHER_STATIONS.map((st) => (
              <button
                key={st.id}
                type="button"
                onClick={() => onEnableStationWeather(st.id)}
                className={`rounded px-2.5 py-1 text-xs whitespace-nowrap transition-colors ${
                  weather.enabled && weather.stationId === st.id
                    ? 'bg-cyan-300 font-semibold text-stone-950'
                    : 'border border-white/12 bg-black text-stone-300 hover:border-white/30 hover:text-white'
                }`}
              >
                {st.name}
              </button>
            ))}
            <button
              type="button"
              onClick={onEnableGeoWeather}
              className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs whitespace-nowrap transition-colors ${
                weather.enabled && weather.stationId === 'custom'
                  ? 'bg-cyan-300 font-semibold text-stone-950'
                  : 'border border-white/12 bg-black text-stone-300 hover:border-white/30 hover:text-white'
              }`}
            >
              <Compass className="h-3 w-3" />
              <span>My Location</span>
            </button>
          </div>

          {weather.loading && (
            <p className="text-[11px] text-stone-400">Syncing live Nordic weather & solar angle...</p>
          )}
          {weather.error && <p className="text-[11px] text-amber-300">{weather.error}</p>}

          {weather.enabled && weather.observation && (
            <div className="grid grid-cols-2 gap-2 border-t border-white/10 pt-2.5 font-mono-tabular text-[11px] text-stone-300">
              <div>
                <span className="text-stone-500">Station </span>
                <span>{weather.stationName}</span>
              </div>
              <div>
                <span className="text-stone-500">Sky </span>
                <span>{weather.observation.conditionLabel}</span>
              </div>
              <div>
                <span className="text-stone-500">Temp </span>
                <span>{weather.observation.temperatureC.toFixed(1)}°C</span>
              </div>
              <div>
                <span className="text-stone-500">Wind </span>
                <span>{weather.observation.windSpeedKmh.toFixed(1)} km/h</span>
              </div>
              <div>
                <span className="text-stone-500">Clouds </span>
                <span>{Math.round(weather.observation.cloudCoverPct)}%</span>
              </div>
              <div>
                <span className="text-stone-500">Solar Alt </span>
                <span>{weather.solarElevationDeg.toFixed(1)}°</span>
              </div>
            </div>
          )}
        </section>

        {/* Lighting & Atmosphere Studio Sliders */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-stone-200">Season</span>
            <div className="flex items-center gap-1 rounded border border-white/12 bg-black p-0.5">
              {SEASONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onSelectSeason(s)}
                  className={`rounded px-2.5 py-1 text-xs capitalize whitespace-nowrap transition-colors ${
                    hud.season === s
                      ? 'bg-stone-100 font-semibold text-stone-950'
                      : 'text-stone-300 hover:text-white'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <label className="block space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-stone-300">Sun Elevation</span>
              <span className="font-mono-tabular text-stone-400">
                {Math.round((hud.sunElevation * 180) / Math.PI)}°
              </span>
            </div>
            <input
              type="range"
              min={-0.25}
              max={1.25}
              step={0.01}
              value={hud.sunElevation}
              onChange={(e) => onChangeSunElevation(Number(e.target.value))}
              className="exhibition-range w-full"
            />
          </label>

          <label className="block space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-stone-300">Sun Azimuth</span>
              <span className="font-mono-tabular text-stone-400">
                {Math.round((hud.sunAzimuth * 180) / Math.PI)}°
              </span>
            </div>
            <input
              type="range"
              min={-3.14}
              max={3.14}
              step={0.02}
              value={hud.sunAzimuth}
              onChange={(e) => onChangeSunAzimuth(Number(e.target.value))}
              className="exhibition-range w-full"
            />
          </label>

          <label className="block space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-stone-300">Atmospheric Fog</span>
              <span className="font-mono-tabular text-stone-400">
                {(hud.fogDensity * 1000).toFixed(1)}
              </span>
            </div>
            <input
              type="range"
              min={0.004}
              max={0.036}
              step={0.0005}
              value={hud.fogDensity}
              onChange={(e) => onChangeFogDensity(Number(e.target.value))}
              className="exhibition-range w-full"
            />
          </label>

          <label className="block space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-stone-300">Luminance Bloom</span>
              <span className="font-mono-tabular text-stone-400">
                {hud.bloomStrength.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={0.3}
              max={1.7}
              step={0.02}
              value={hud.bloomStrength}
              onChange={(e) => onChangeBloomStrength(Number(e.target.value))}
              className="exhibition-range w-full"
            />
          </label>

          <label className="block space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-stone-300">Wind Strength</span>
              <span className="font-mono-tabular text-stone-400">
                {hud.windStrength.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={4.5}
              step={0.05}
              value={hud.windStrength}
              onChange={(e) => onChangeWindStrength(Number(e.target.value))}
              className="exhibition-range w-full"
            />
          </label>

          <label className="block space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-stone-300">Wind Direction</span>
              <span className="font-mono-tabular text-stone-400">
                {Math.round((hud.windDirection * 180) / Math.PI)}°
              </span>
            </div>
            <input
              type="range"
              min={-3.14}
              max={3.14}
              step={0.05}
              value={hud.windDirection}
              onChange={(e) => onChangeWindDirection(Number(e.target.value))}
              className="exhibition-range w-full"
            />
          </label>

          <label className="block space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-stone-300">Cursor Field Radius</span>
              <span className="font-mono-tabular text-stone-400">
                {hud.interactionRadius.toFixed(1)} m
              </span>
            </div>
            <input
              type="range"
              min={2.0}
              max={12.0}
              step={0.25}
              value={hud.interactionRadius}
              onChange={(e) => onChangeInteractionRadius(Number(e.target.value))}
              className="exhibition-range w-full"
            />
          </label>
        </section>

        {/* Custom Chapter Presets */}
        <section className="space-y-2.5 border-t border-white/10 pt-4">
          <h3 className="text-xs font-medium text-stone-200">Custom Chapter Presets</h3>

          <form onSubmit={(e) => void handleSavePreset(e)} className="flex gap-2">
            <input
              type="text"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder={curator ? 'Save current look as preset...' : 'Sign in in Archive to save'}
              disabled={!curator}
              maxLength={60}
              className="min-w-0 flex-1 rounded border border-white/15 bg-black px-2.5 py-1.5 text-xs text-stone-100 placeholder-stone-500 focus:border-cyan-300 focus:outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!curator || saving || presetName.trim().length < 2}
              className="inline-flex items-center gap-1 rounded bg-stone-100 px-2.5 py-1.5 text-xs font-semibold text-stone-950 whitespace-nowrap hover:bg-white disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Save</span>
            </button>
          </form>
          {presetError && <p className="text-[11px] text-red-300">{presetError}</p>}

          <div className="space-y-1.5">
            {presets.map((p) => {
              const isOwner = curator && p.curatorId === curator.id;
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-2 rounded border border-white/10 bg-black/50 px-3 py-2"
                >
                  <button
                    type="button"
                    onClick={() => onApplyPreset(p)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-xs font-medium text-stone-100 hover:text-cyan-200">
                      {p.name}
                    </p>
                    <p className="font-mono-tabular text-[10px] text-stone-400">
                      {p.atmosphere.season} · {p.atmosphere.interactionMode} · by {p.authorName}
                    </p>
                  </button>
                  {isOwner && (
                    <button
                      type="button"
                      onClick={() => void onDeletePreset(p.id)}
                      title="Delete preset"
                      className="rounded p-1 text-stone-500 hover:text-red-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </aside>
  );
};
