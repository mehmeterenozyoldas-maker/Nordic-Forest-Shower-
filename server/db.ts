import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export interface SavedPlantedTree {
  id: string;
  x: number;
  z: number;
  species: 'Oak' | 'Pine' | 'Bush';
  scale: number;
  plantedAt: number;
}

export interface TerrainConfigRecord {
  seed: number;
  riverWidth: number;
  terrainRoughness: number;
  treeDensity: number;
  treeScale: number;
  baseSpecies: 'Oak' | 'Pine' | 'Bush';
}

export interface AtmosphereRecord {
  season: 'autumn' | 'spring' | 'winter';
  sunElevation: number;
  sunAzimuth: number;
  fogDensity: number;
  bloomStrength: number;
  windStrength: number;
  windDirection: number;
  interactionMode: string;
  interactionContext: string;
}

export interface CameraTargetRecord {
  theta: number;
  phi: number;
  radius: number;
}

export interface ForestPlateRecord {
  id: string;
  accessionCode: string;
  curatorId: string;
  authorName: string;
  title: string;
  notes: string;
  visibility: 'public' | 'unlisted';
  terrainConfig: TerrainConfigRecord;
  atmosphere: AtmosphereRecord;
  cameraTarget: CameraTargetRecord;
  plantedTrees: SavedPlantedTree[];
  thumbnailDataUrl: string | null;
  likesCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AtmospherePresetRecord {
  id: string;
  curatorId: string;
  authorName: string;
  name: string;
  isPublic: boolean;
  atmosphere: AtmosphereRecord;
  cameraTarget: CameraTargetRecord;
  createdAt: string;
}

export interface CuratorProfile {
  id: string;
  handle: string;
  displayName: string;
  createdAt: string;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'nordic_archive.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS curators (
    id TEXT PRIMARY KEY,
    handle TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    pin_hash TEXT NOT NULL,
    session_token TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS forests (
    id TEXT PRIMARY KEY,
    accession_code TEXT UNIQUE NOT NULL,
    curator_id TEXT NOT NULL,
    author_name TEXT NOT NULL,
    title TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    visibility TEXT NOT NULL DEFAULT 'public',
    terrain_config_json TEXT NOT NULL,
    atmosphere_json TEXT NOT NULL,
    camera_target_json TEXT NOT NULL,
    planted_trees_json TEXT NOT NULL,
    thumbnail_data_url TEXT,
    likes_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS presets (
    id TEXT PRIMARY KEY,
    curator_id TEXT NOT NULL,
    author_name TEXT NOT NULL,
    name TEXT NOT NULL,
    is_public INTEGER NOT NULL DEFAULT 1,
    atmosphere_json TEXT NOT NULL,
    camera_target_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_forests_visibility_created ON forests(visibility, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_forests_curator ON forests(curator_id, created_at DESC);
`);

function hashPin(pin: string): string {
  return crypto.createHash('sha256').update(`nordic-pin:${pin}`).digest('hex');
}

function slugHandle(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28);
  return cleaned || 'visitor';
}

function seedInitialArchive(): void {
  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM forests').get() as { cnt: number };
  if (countRow.cnt > 0) return;

  const now = new Date().toISOString();
  const curatorId = 'curator-archive-nordic';
  db.prepare(
    `INSERT OR IGNORE INTO curators (id, handle, display_name, pin_hash, session_token, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    curatorId,
    'nordic-curatorial',
    'Nordic Curatorial Archive',
    hashPin('0000'),
    crypto.randomBytes(24).toString('hex'),
    now,
  );

  const starterPlates: Array<{
    id: string;
    accessionCode: string;
    title: string;
    notes: string;
    terrainConfig: TerrainConfigRecord;
    atmosphere: AtmosphereRecord;
    cameraTarget: CameraTargetRecord;
    plantedTrees: SavedPlantedTree[];
    likesCount: number;
  }> = [
    {
      id: 'plate-fjord-dawn-canopy',
      accessionCode: 'ARC.2026.001',
      title: 'Fjord Dawn Canopy',
      notes: 'Golden low-horizon light across young riverside oaks and misted birch ridges.',
      terrainConfig: {
        seed: 104729,
        riverWidth: 4.0,
        terrainRoughness: 2.0,
        treeDensity: 35,
        treeScale: 0.72,
        baseSpecies: 'Oak',
      },
      atmosphere: {
        season: 'autumn',
        sunElevation: 0.24,
        sunAzimuth: 0.65,
        fogDensity: 0.017,
        bloomStrength: 0.96,
        windStrength: 1.85,
        windDirection: 0.35,
        interactionMode: 'Wind Gust',
        interactionContext: 'All',
      },
      cameraTarget: { theta: Math.PI * 0.48, phi: Math.PI * 0.34, radius: 36 },
      plantedTrees: [
        { id: 'seed-t1', x: -11.4, z: 6.2, species: 'Oak', scale: 0.85, plantedAt: 0 },
        { id: 'seed-t2', x: 12.8, z: -8.1, species: 'Pine', scale: 0.9, plantedAt: 0 },
        { id: 'seed-t3', x: -6.2, z: -13.5, species: 'Bush', scale: 0.8, plantedAt: 0 },
      ],
      likesCount: 14,
    },
    {
      id: 'plate-tromso-frost-grove',
      accessionCode: 'ARC.2026.002',
      title: 'Tromsø Frost Grove',
      notes: 'Sub-arctic winter twilight with snow drift currents and pine silhouettes along the frozen bend.',
      terrainConfig: {
        seed: 42891,
        riverWidth: 4.2,
        terrainRoughness: 2.2,
        treeDensity: 38,
        treeScale: 0.78,
        baseSpecies: 'Pine',
      },
      atmosphere: {
        season: 'winter',
        sunElevation: -0.14,
        sunAzimuth: 1.15,
        fogDensity: 0.022,
        bloomStrength: 1.25,
        windStrength: 0.65,
        windDirection: 1.1,
        interactionMode: 'Aurora Field',
        interactionContext: 'All',
      },
      cameraTarget: { theta: Math.PI * 1.12, phi: Math.PI * 0.39, radius: 33 },
      plantedTrees: [
        { id: 'seed-t4', x: 14.2, z: 7.5, species: 'Pine', scale: 0.95, plantedAt: 0 },
        { id: 'seed-t5', x: -14.8, z: -4.2, species: 'Pine', scale: 0.88, plantedAt: 0 },
        { id: 'seed-t6', x: 8.9, z: -14.1, species: 'Oak', scale: 0.75, plantedAt: 0 },
      ],
      likesCount: 19,
    },
    {
      id: 'plate-abisko-vernal-wake',
      accessionCode: 'ARC.2026.003',
      title: 'Abisko Vernal Wake',
      notes: 'Spring thaw currents and firefly canopy eddies tuned for fluid wake choreography.',
      terrainConfig: {
        seed: 77319,
        riverWidth: 4.4,
        terrainRoughness: 1.85,
        treeDensity: 34,
        treeScale: 0.7,
        baseSpecies: 'Oak',
      },
      atmosphere: {
        season: 'spring',
        sunElevation: 0.72,
        sunAzimuth: 0.25,
        fogDensity: 0.012,
        bloomStrength: 1.05,
        windStrength: 0.9,
        windDirection: -0.45,
        interactionMode: 'Fluid Push/Pull',
        interactionContext: 'All',
      },
      cameraTarget: { theta: Math.PI * 0.74, phi: Math.PI * 0.29, radius: 31 },
      plantedTrees: [
        { id: 'seed-t7', x: -9.5, z: -9.4, species: 'Bush', scale: 0.9, plantedAt: 0 },
        { id: 'seed-t8', x: 11.2, z: 10.6, species: 'Oak', scale: 0.85, plantedAt: 0 },
      ],
      likesCount: 11,
    },
  ];

  const insertForest = db.prepare(
    `INSERT INTO forests (
      id, accession_code, curator_id, author_name, title, notes, visibility,
      terrain_config_json, atmosphere_json, camera_target_json, planted_trees_json,
      thumbnail_data_url, likes_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const plate of starterPlates) {
    insertForest.run(
      plate.id,
      plate.accessionCode,
      curatorId,
      'Nordic Curatorial Archive',
      plate.title,
      plate.notes,
      'public',
      JSON.stringify(plate.terrainConfig),
      JSON.stringify(plate.atmosphere),
      JSON.stringify(plate.cameraTarget),
      JSON.stringify(plate.plantedTrees),
      null,
      plate.likesCount,
      now,
      now,
    );
  }

  const presetCount = (db.prepare('SELECT COUNT(*) as cnt FROM presets').get() as { cnt: number }).cnt;
  if (presetCount === 0) {
    const insertPreset = db.prepare(
      `INSERT INTO presets (id, curator_id, author_name, name, is_public, atmosphere_json, camera_target_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const starterPresets = [
      {
        id: 'preset-arctic-blue-hour',
        name: 'Arctic Blue Hour',
        atmosphere: starterPlates[1].atmosphere,
        cameraTarget: starterPlates[1].cameraTarget,
      },
      {
        id: 'preset-golden-solstice',
        name: 'Golden Solstice',
        atmosphere: {
          season: 'autumn',
          sunElevation: 0.19,
          sunAzimuth: 0.9,
          fogDensity: 0.015,
          bloomStrength: 1.05,
          windStrength: 1.4,
          windDirection: 0.2,
          interactionMode: 'Wind Gust',
          interactionContext: 'All',
        },
        cameraTarget: { theta: Math.PI * 0.45, phi: Math.PI * 0.35, radius: 35 },
      },
      {
        id: 'preset-emerald-mist',
        name: 'Deep Emerald Mist',
        atmosphere: starterPlates[2].atmosphere,
        cameraTarget: starterPlates[2].cameraTarget,
      },
    ];
    for (const p of starterPresets) {
      insertPreset.run(
        p.id,
        curatorId,
        'Nordic Curatorial Archive',
        p.name,
        1,
        JSON.stringify(p.atmosphere),
        JSON.stringify(p.cameraTarget),
        now,
      );
    }
  }
}

seedInitialArchive();

export function authenticateCuratorToken(token: string | undefined): CuratorProfile | null {
  if (!token || token.length < 12) return null;
  const row = db
    .prepare('SELECT id, handle, display_name, created_at FROM curators WHERE session_token = ?')
    .get(token) as { id: string; handle: string; display_name: string; created_at: string } | undefined;
  if (!row) return null;
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
}

export function signInOrRegisterCurator(
  displayNameRaw: string,
  pinRaw: string,
): { curator: CuratorProfile; token: string } {
  const displayName = displayNameRaw.trim().slice(0, 48);
  if (displayName.length < 2) {
    throw new Error('Curator name must be at least 2 characters.');
  }
  const pin = pinRaw.trim() || '0000';
  const pinHash = hashPin(pin);
  const handle = slugHandle(displayName);

  const existing = db
    .prepare('SELECT id, handle, display_name, pin_hash, created_at FROM curators WHERE handle = ?')
    .get(handle) as
    | { id: string; handle: string; display_name: string; pin_hash: string; created_at: string }
    | undefined;

  if (existing) {
    if (existing.pin_hash !== pinHash) {
      throw new Error('Curator handle already exists with a different PIN.');
    }
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare('UPDATE curators SET session_token = ?, display_name = ? WHERE id = ?').run(
      token,
      displayName,
      existing.id,
    );
    return {
      curator: {
        id: existing.id,
        handle: existing.handle,
        displayName,
        createdAt: existing.created_at,
      },
      token,
    };
  }

  const id = `cur-${crypto.randomUUID()}`;
  const token = crypto.randomBytes(24).toString('hex');
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO curators (id, handle, display_name, pin_hash, session_token, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, handle, displayName, pinHash, token, createdAt);

  return {
    curator: { id, handle, displayName, createdAt },
    token,
  };
}

function mapForestRow(row: Record<string, unknown>): ForestPlateRecord {
  return {
    id: String(row.id),
    accessionCode: String(row.accession_code),
    curatorId: String(row.curator_id),
    authorName: String(row.author_name),
    title: String(row.title),
    notes: String(row.notes ?? ''),
    visibility: row.visibility === 'unlisted' ? 'unlisted' : 'public',
    terrainConfig: JSON.parse(String(row.terrain_config_json)) as TerrainConfigRecord,
    atmosphere: JSON.parse(String(row.atmosphere_json)) as AtmosphereRecord,
    cameraTarget: JSON.parse(String(row.camera_target_json)) as CameraTargetRecord,
    plantedTrees: JSON.parse(String(row.planted_trees_json)) as SavedPlantedTree[],
    thumbnailDataUrl: row.thumbnail_data_url ? String(row.thumbnail_data_url) : null,
    likesCount: Number(row.likes_count ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function listForestPlates(opts: {
  curatorId?: string;
  scope?: 'gallery' | 'mine';
  sort?: 'recent' | 'popular';
  query?: string;
}): ForestPlateRecord[] {
  const orderCol = opts.sort === 'popular' ? 'likes_count DESC, created_at DESC' : 'created_at DESC';
  const search = opts.query ? `%${opts.query.trim().toLowerCase()}%` : null;

  let sql = 'SELECT * FROM forests WHERE ';
  const params: unknown[] = [];

  if (opts.scope === 'mine' && opts.curatorId) {
    sql += 'curator_id = ?';
    params.push(opts.curatorId);
  } else {
    sql += "visibility = 'public'";
  }

  if (search) {
    sql += ' AND (LOWER(title) LIKE ? OR LOWER(author_name) LIKE ? OR LOWER(accession_code) LIKE ?)';
    params.push(search, search, search);
  }

  sql += ` ORDER BY ${orderCol} LIMIT 60`;
  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  return rows.map(mapForestRow);
}

export function getForestPlateById(id: string, requesterCuratorId?: string): ForestPlateRecord | null {
  const row = db.prepare('SELECT * FROM forests WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  if (row.visibility === 'unlisted' && requesterCuratorId && row.curator_id !== requesterCuratorId) {
    // Allow unlisted direct link access too (unlisted means hidden from public gallery browse, accessible by direct URL)
  }
  return mapForestRow(row);
}

export function createForestPlate(input: {
  curator: CuratorProfile;
  title: string;
  notes: string;
  visibility: 'public' | 'unlisted';
  terrainConfig: TerrainConfigRecord;
  atmosphere: AtmosphereRecord;
  cameraTarget: CameraTargetRecord;
  plantedTrees: SavedPlantedTree[];
  thumbnailDataUrl: string | null;
}): ForestPlateRecord {
  const title = input.title.trim().slice(0, 80);
  if (title.length < 2) {
    throw new Error('Title must be at least 2 characters.');
  }
  const notes = input.notes.trim().slice(0, 320);
  const visibility = input.visibility === 'unlisted' ? 'unlisted' : 'public';
  const trees = Array.isArray(input.plantedTrees) ? input.plantedTrees.slice(0, 250) : [];

  const totalRow = db.prepare('SELECT COUNT(*) as cnt FROM forests').get() as { cnt: number };
  const seq = String(totalRow.cnt + 1).padStart(3, '0');
  const year = new Date().getFullYear();
  const accessionCode = `ARC.${year}.${seq}`;

  const id = `plate-${crypto.randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();

  // Keep thumbnail safely bounded
  const thumb =
    input.thumbnailDataUrl &&
    input.thumbnailDataUrl.startsWith('data:image/') &&
    input.thumbnailDataUrl.length < 280_000
      ? input.thumbnailDataUrl
      : null;

  db.prepare(
    `INSERT INTO forests (
      id, accession_code, curator_id, author_name, title, notes, visibility,
      terrain_config_json, atmosphere_json, camera_target_json, planted_trees_json,
      thumbnail_data_url, likes_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(
    id,
    accessionCode,
    input.curator.id,
    input.curator.displayName,
    title,
    notes,
    visibility,
    JSON.stringify(input.terrainConfig),
    JSON.stringify(input.atmosphere),
    JSON.stringify(input.cameraTarget),
    JSON.stringify(trees),
    thumb,
    now,
    now,
  );

  return getForestPlateById(id, input.curator.id)!;
}

export function incrementForestLike(id: string): ForestPlateRecord | null {
  const info = db.prepare('UPDATE forests SET likes_count = likes_count + 1 WHERE id = ?').run(id);
  if (info.changes === 0) return null;
  return getForestPlateById(id);
}

export function deleteForestPlate(id: string, curatorId: string): boolean {
  const info = db
    .prepare('DELETE FROM forests WHERE id = ? AND curator_id = ?')
    .run(id, curatorId);
  return info.changes > 0;
}

export function listAtmospherePresets(curatorId?: string): AtmospherePresetRecord[] {
  const rows = curatorId
    ? (db
        .prepare(
          'SELECT * FROM presets WHERE is_public = 1 OR curator_id = ? ORDER BY created_at DESC LIMIT 40',
        )
        .all(curatorId) as Array<Record<string, unknown>>)
    : (db
        .prepare('SELECT * FROM presets WHERE is_public = 1 ORDER BY created_at DESC LIMIT 40')
        .all() as Array<Record<string, unknown>>);

  return rows.map((row) => ({
    id: String(row.id),
    curatorId: String(row.curator_id),
    authorName: String(row.author_name),
    name: String(row.name),
    isPublic: Boolean(row.is_public),
    atmosphere: JSON.parse(String(row.atmosphere_json)) as AtmosphereRecord,
    cameraTarget: JSON.parse(String(row.camera_target_json)) as CameraTargetRecord,
    createdAt: String(row.created_at),
  }));
}

export function createAtmospherePreset(input: {
  curator: CuratorProfile;
  name: string;
  isPublic: boolean;
  atmosphere: AtmosphereRecord;
  cameraTarget: CameraTargetRecord;
}): AtmospherePresetRecord {
  const name = input.name.trim().slice(0, 60);
  if (name.length < 2) {
    throw new Error('Preset name must be at least 2 characters.');
  }
  const id = `preset-${crypto.randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO presets (id, curator_id, author_name, name, is_public, atmosphere_json, camera_target_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.curator.id,
    input.curator.displayName,
    name,
    input.isPublic ? 1 : 0,
    JSON.stringify(input.atmosphere),
    JSON.stringify(input.cameraTarget),
    now,
  );

  return {
    id,
    curatorId: input.curator.id,
    authorName: input.curator.displayName,
    name,
    isPublic: input.isPublic,
    atmosphere: input.atmosphere,
    cameraTarget: input.cameraTarget,
    createdAt: now,
  };
}

export function deleteAtmospherePreset(id: string, curatorId: string): boolean {
  const info = db
    .prepare('DELETE FROM presets WHERE id = ? AND curator_id = ?')
    .run(id, curatorId);
  return info.changes > 0;
}
