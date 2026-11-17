import {
  AtmospherePreset,
  AtmosphereSnapshot,
  CameraTarget,
  CuratorProfile,
  ForestPlate,
  SavedPlantedTree,
  TerrainConfig,
  WeatherObservation,
} from '../types/simulation';

const TOKEN_STORAGE_KEY = 'nordic_curator_token';

function getStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage errors in sandboxed iframes
  }
}

async function apiFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(url, { ...init, headers });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(json.error ?? `Request failed (${res.status})`);
  }
  return json;
}

export async function restoreCuratorSession(): Promise<CuratorProfile | null> {
  if (!getStoredToken()) return null;
  try {
    const res = await apiFetch<{ curator: CuratorProfile }>('/api/curators/me');
    return res.curator;
  } catch {
    setStoredToken(null);
    return null;
  }
}

export async function signInCurator(displayName: string, pin: string): Promise<CuratorProfile> {
  const res = await apiFetch<{ curator: CuratorProfile; token: string }>('/api/curators/session', {
    method: 'POST',
    body: JSON.stringify({ displayName, pin }),
  });
  setStoredToken(res.token);
  return res.curator;
}

export function signOutCurator(): void {
  setStoredToken(null);
}

export async function fetchForestPlates(opts: {
  scope?: 'gallery' | 'mine';
  sort?: 'recent' | 'popular';
  query?: string;
}): Promise<ForestPlate[]> {
  const params = new URLSearchParams();
  if (opts.scope) params.set('scope', opts.scope);
  if (opts.sort) params.set('sort', opts.sort);
  if (opts.query) params.set('q', opts.query);
  const res = await apiFetch<{ plates: ForestPlate[] }>(`/api/forests?${params.toString()}`);
  return res.plates;
}

export async function fetchForestPlateById(id: string): Promise<ForestPlate> {
  const res = await apiFetch<{ plate: ForestPlate }>(`/api/forests/${encodeURIComponent(id)}`);
  return res.plate;
}

export async function publishForestPlate(payload: {
  title: string;
  notes: string;
  visibility: 'public' | 'unlisted';
  terrainConfig: TerrainConfig;
  atmosphere: AtmosphereSnapshot;
  cameraTarget: CameraTarget;
  plantedTrees: SavedPlantedTree[];
  thumbnailDataUrl: string | null;
}): Promise<ForestPlate> {
  const res = await apiFetch<{ plate: ForestPlate }>('/api/forests', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.plate;
}

export async function appreciateForestPlate(id: string): Promise<ForestPlate> {
  const res = await apiFetch<{ plate: ForestPlate }>(
    `/api/forests/${encodeURIComponent(id)}/like`,
    { method: 'POST' },
  );
  return res.plate;
}

export async function removeForestPlate(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/forests/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function fetchAtmospherePresets(): Promise<AtmospherePreset[]> {
  const res = await apiFetch<{ presets: AtmospherePreset[] }>('/api/presets');
  return res.presets;
}

export async function saveAtmospherePreset(payload: {
  name: string;
  isPublic: boolean;
  atmosphere: AtmosphereSnapshot;
  cameraTarget: CameraTarget;
}): Promise<AtmospherePreset> {
  const res = await apiFetch<{ preset: AtmospherePreset }>('/api/presets', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.preset;
}

export async function removeAtmospherePreset(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/presets/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function fetchLiveWeather(lat: number, lon: number): Promise<WeatherObservation> {
  return apiFetch<WeatherObservation>(
    `/api/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`,
  );
}
