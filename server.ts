import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import {
  authenticateCuratorToken,
  createAtmospherePreset,
  createForestPlate,
  deleteAtmospherePreset,
  deleteForestPlate,
  getForestPlateById,
  incrementForestLike,
  listAtmospherePresets,
  listForestPlates,
  signInOrRegisterCurator,
} from './server/db.ts';
import type { SavedPlantedTree } from './server/db.ts';

const PORT = 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

interface RoomVisitor {
  clientId: string;
  name: string;
  color: string;
  ws: WebSocket;
}

interface RoomState {
  visitors: Map<string, RoomVisitor>;
  plantedTrees: SavedPlantedTree[];
}

const rooms = new Map<string, RoomState>();

// 5-minute cached weather map keyed by rounded lat,lon
interface WeatherPayload {
  latitude: number;
  longitude: number;
  temperatureC: number;
  windSpeedKmh: number;
  windDirectionDeg: number;
  cloudCoverPct: number;
  precipitationMm: number;
  weatherCode: number;
  conditionLabel: string;
  observedAt: string;
  fallback: boolean;
}

const weatherCache = new Map<string, { expiresAt: number; data: WeatherPayload }>();

function weatherCodeToLabel(code: number): string {
  if (code === 0) return 'Clear Sky';
  if (code <= 3) return 'Partly Overcast';
  if (code === 45 || code === 48) return 'Nordic Fog';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'Rain Mist';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'Snowfall';
  if (code >= 95) return 'Storm Gusts';
  return 'Atmospheric Drift';
}

function getBearerToken(req: express.Request): string | undefined {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return undefined;
  return auth.slice(7).trim();
}

function getOrCreateRoom(roomId: string): RoomState {
  let room = rooms.get(roomId);
  if (!room) {
    room = { visitors: new Map(), plantedTrees: [] };
    rooms.set(roomId, room);
  }
  return room;
}

function broadcastRoom(room: RoomState, payload: unknown, exceptClientId?: string): void {
  const encoded = JSON.stringify(payload);
  for (const visitor of room.visitors.values()) {
    if (exceptClientId && visitor.clientId === exceptClientId) continue;
    if (visitor.ws.readyState === WebSocket.OPEN) {
      visitor.ws.send(encoded);
    }
  }
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '1.5mb' }));

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, roomsActive: rooms.size });
  });

  // Curator Session (Register / Sign In)
  app.post('/api/curators/session', (req, res) => {
    try {
      const displayName = typeof req.body?.displayName === 'string' ? req.body.displayName : '';
      const pin = typeof req.body?.pin === 'string' ? req.body.pin : '0000';
      const result = signInOrRegisterCurator(displayName, pin);
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Unable to open curator session.',
      });
    }
  });

  app.get('/api/curators/me', (req, res) => {
    const curator = authenticateCuratorToken(getBearerToken(req));
    if (!curator) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    res.json({ curator });
  });

  // Forest Archive Gallery & Plates
  app.get('/api/forests', (req, res) => {
    const curator = authenticateCuratorToken(getBearerToken(req));
    const scope = req.query.scope === 'mine' ? 'mine' : 'gallery';
    const sort = req.query.sort === 'popular' ? 'popular' : 'recent';
    const query = typeof req.query.q === 'string' ? req.query.q : undefined;
    if (scope === 'mine' && !curator) {
      res.json({ plates: [] });
      return;
    }
    const plates = listForestPlates({
      curatorId: curator?.id,
      scope,
      sort,
      query,
    });
    res.json({ plates });
  });

  app.get('/api/forests/:id', (req, res) => {
    const curator = authenticateCuratorToken(getBearerToken(req));
    const plate = getForestPlateById(req.params.id, curator?.id);
    if (!plate) {
      res.status(404).json({ error: 'Forest plate not found.' });
      return;
    }
    res.json({ plate });
  });

  app.post('/api/forests', (req, res) => {
    const curator = authenticateCuratorToken(getBearerToken(req));
    if (!curator) {
      res.status(401).json({ error: 'Sign in with a curator name to publish to the archive.' });
      return;
    }
    try {
      const plate = createForestPlate({
        curator,
        title: String(req.body?.title ?? ''),
        notes: String(req.body?.notes ?? ''),
        visibility: req.body?.visibility === 'unlisted' ? 'unlisted' : 'public',
        terrainConfig: req.body?.terrainConfig,
        atmosphere: req.body?.atmosphere,
        cameraTarget: req.body?.cameraTarget,
        plantedTrees: req.body?.plantedTrees ?? [],
        thumbnailDataUrl:
          typeof req.body?.thumbnailDataUrl === 'string' ? req.body.thumbnailDataUrl : null,
      });
      res.status(201).json({ plate });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Unable to save forest plate.',
      });
    }
  });

  app.post('/api/forests/:id/like', (req, res) => {
    const updated = incrementForestLike(req.params.id);
    if (!updated) {
      res.status(404).json({ error: 'Forest plate not found.' });
      return;
    }
    res.json({ plate: updated });
  });

  app.delete('/api/forests/:id', (req, res) => {
    const curator = authenticateCuratorToken(getBearerToken(req));
    if (!curator) {
      res.status(401).json({ error: 'Sign in required.' });
      return;
    }
    const ok = deleteForestPlate(req.params.id, curator.id);
    if (!ok) {
      res.status(404).json({ error: 'Plate not found or not owned by current curator.' });
      return;
    }
    res.json({ ok: true });
  });

  // Custom Atmosphere Presets
  app.get('/api/presets', (req, res) => {
    const curator = authenticateCuratorToken(getBearerToken(req));
    const presets = listAtmospherePresets(curator?.id);
    res.json({ presets });
  });

  app.post('/api/presets', (req, res) => {
    const curator = authenticateCuratorToken(getBearerToken(req));
    if (!curator) {
      res.status(401).json({ error: 'Sign in with a curator name to save presets.' });
      return;
    }
    try {
      const preset = createAtmospherePreset({
        curator,
        name: String(req.body?.name ?? ''),
        isPublic: req.body?.isPublic !== false,
        atmosphere: req.body?.atmosphere,
        cameraTarget: req.body?.cameraTarget,
      });
      res.status(201).json({ preset });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Unable to save preset.',
      });
    }
  });

  app.delete('/api/presets/:id', (req, res) => {
    const curator = authenticateCuratorToken(getBearerToken(req));
    if (!curator) {
      res.status(401).json({ error: 'Sign in required.' });
      return;
    }
    const ok = deleteAtmospherePreset(req.params.id, curator.id);
    res.json({ ok });
  });

  // Cached Open-Meteo Real-Time Weather Proxy
  app.get('/api/weather', async (req, res) => {
    const lat = Number(req.query.lat ?? 69.6492);
    const lon = Number(req.query.lon ?? 18.9553);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      res.status(400).json({ error: 'Invalid coordinates.' });
      return;
    }
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    const cached = weatherCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      res.json(cached.data);
      return;
    }

    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(
        lat.toFixed(4),
      )}&longitude=${encodeURIComponent(
        lon.toFixed(4),
      )}&current=temperature_2m,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation,weather_code&timezone=UTC`;

      const upstream = await fetch(url, { signal: AbortSignal.timeout(4500) });
      if (!upstream.ok) throw new Error(`Weather API ${upstream.status}`);
      const json = (await upstream.json()) as {
        current?: {
          temperature_2m?: number;
          wind_speed_10m?: number;
          wind_direction_10m?: number;
          cloud_cover?: number;
          precipitation?: number;
          weather_code?: number;
          time?: string;
        };
      };
      const cur = json.current ?? {};
      const code = Number(cur.weather_code ?? 2);
      const data: WeatherPayload = {
        latitude: lat,
        longitude: lon,
        temperatureC: Number(cur.temperature_2m ?? 3.5),
        windSpeedKmh: Number(cur.wind_speed_10m ?? 14.0),
        windDirectionDeg: Number(cur.wind_direction_10m ?? 210),
        cloudCoverPct: Number(cur.cloud_cover ?? 45),
        precipitationMm: Number(cur.precipitation ?? 0),
        weatherCode: code,
        conditionLabel: weatherCodeToLabel(code),
        observedAt: cur.time ?? new Date().toISOString(),
        fallback: false,
      };
      weatherCache.set(key, { expiresAt: Date.now() + 5 * 60_000, data });
      res.json(data);
    } catch {
      const data: WeatherPayload = {
        latitude: lat,
        longitude: lon,
        temperatureC: 2.0,
        windSpeedKmh: 16.5,
        windDirectionDeg: 225,
        cloudCoverPct: 52,
        precipitationMm: 0,
        weatherCode: 2,
        conditionLabel: 'Nordic Breeze (Offline Est.)',
        observedAt: new Date().toISOString(),
        fallback: true,
      };
      res.json(data);
    }
  });

  // Mount Vite Dev Middleware or Static Production Build
  const server = http.createServer(app);

  if (!IS_PROD) {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  // WebSocket Collaborative Room Broker (/ws)
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const reqUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (reqUrl.pathname !== '/ws') {
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, reqUrl);
    });
  });

  wss.on('connection', (ws: WebSocket) => {
    let joinedRoomId: string | null = null;
    let joinedClientId: string | null = null;

    ws.on('message', (rawData) => {
      try {
        const msg = JSON.parse(rawData.toString()) as Record<string, unknown>;
        const type = String(msg.type ?? '');

        if (type === 'join') {
          const roomId = String(msg.roomId ?? 'fjord-hall')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, '')
            .slice(0, 32) || 'fjord-hall';
          const clientId = String(msg.clientId ?? '').slice(0, 48);
          if (!clientId) return;

          const name = String(msg.name ?? 'Visitor').trim().slice(0, 32) || 'Visitor';
          const color = String(msg.color ?? '#67e8f9').slice(0, 16);

          if (joinedRoomId && joinedClientId) {
            const prevRoom = rooms.get(joinedRoomId);
            if (prevRoom) {
              prevRoom.visitors.delete(joinedClientId);
              broadcastRoom(prevRoom, { type: 'visitor:left', clientId: joinedClientId });
            }
          }

          const room = getOrCreateRoom(roomId);
          room.visitors.set(clientId, { clientId, name, color, ws });
          joinedRoomId = roomId;
          joinedClientId = clientId;

          const roster = Array.from(room.visitors.values()).map((v) => ({
            clientId: v.clientId,
            name: v.name,
            color: v.color,
          }));

          ws.send(
            JSON.stringify({
              type: 'room:state',
              roomId,
              visitors: roster,
              plantedTrees: room.plantedTrees,
            }),
          );

          broadcastRoom(
            room,
            { type: 'visitor:joined', visitor: { clientId, name, color } },
            clientId,
          );
          return;
        }

        if (!joinedRoomId || !joinedClientId) return;
        const room = rooms.get(joinedRoomId);
        if (!room) return;

        if (type === 'cursor') {
          broadcastRoom(
            room,
            {
              type: 'visitor:cursor',
              clientId: joinedClientId,
              x: Number(msg.x ?? 999),
              y: Number(msg.y ?? 999),
              z: Number(msg.z ?? 999),
              vx: Number(msg.vx ?? 0),
              vz: Number(msg.vz ?? 0),
              force: Number(msg.force ?? 1),
              active: Boolean(msg.active),
            },
            joinedClientId,
          );
        } else if (type === 'plant') {
          const tree = msg.tree as SavedPlantedTree | undefined;
          if (!tree || !tree.id) return;
          if (!room.plantedTrees.some((t) => t.id === tree.id)) {
            if (room.plantedTrees.length >= 250) {
              room.plantedTrees.shift();
            }
            room.plantedTrees.push(tree);
            broadcastRoom(room, { type: 'tree:planted', tree, clientId: joinedClientId }, joinedClientId);
          }
        } else if (type === 'clear_wake') {
          broadcastRoom(room, { type: 'room:clear_wake', clientId: joinedClientId }, joinedClientId);
        }
      } catch {
        // Ignore malformed packets
      }
    });

    ws.on('close', () => {
      if (!joinedRoomId || !joinedClientId) return;
      const room = rooms.get(joinedRoomId);
      if (!room) return;
      room.visitors.delete(joinedClientId);
      broadcastRoom(room, { type: 'visitor:left', clientId: joinedClientId });
      if (room.visitors.size === 0 && room.plantedTrees.length === 0) {
        rooms.delete(joinedRoomId);
      }
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Nordic Simulation exhibition server listening on port ${PORT}`);
  });
}

void startServer();
