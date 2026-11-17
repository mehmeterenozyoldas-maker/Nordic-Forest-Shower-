import * as THREE from 'three';
import { CollabState, CollabVisitor, SavedPlantedTree } from '../types/simulation';

const VISITOR_COLORS = ['#67e8f9', '#86efac', '#fcd34d', '#f9a8d4', '#c4b5fd', '#fdba74'];

export interface RemoteVisitorCursor {
  clientId: string;
  name: string;
  color: THREE.Color;
  targetPos: THREE.Vector3;
  worldPos: THREE.Vector3;
  velocity: THREE.Vector3;
  force: number;
  active: boolean;
  lastSeenAt: number;
}

export class CollabRoomClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private intentionalClose = false;
  private lastSentAt = 0;

  private readonly selfId = `vis-${Math.random().toString(36).slice(2, 9)}`;
  private readonly selfColor =
    VISITOR_COLORS[Math.floor(Math.random() * VISITOR_COLORS.length)];

  private state: CollabState = {
    status: 'disconnected',
    roomId: 'fjord-hall',
    selfId: this.selfId,
    selfName: 'Guest Visitor',
    selfColor: this.selfColor,
    visitors: [],
    error: null,
  };

  private readonly remoteCursors = new Map<string, RemoteVisitorCursor>();

  private onState: (state: CollabState) => void;
  private onRemoteTrees: (trees: SavedPlantedTree[]) => void;
  private onRemoteClearWake: () => void;

  constructor(
    onState: (state: CollabState) => void,
    onRemoteTrees: (trees: SavedPlantedTree[]) => void,
    onRemoteClearWake: () => void,
  ) {
    this.onState = onState;
    this.onRemoteTrees = onRemoteTrees;
    this.onRemoteClearWake = onRemoteClearWake;
  }

  public get status(): CollabState {
    return this.state;
  }

  public getRemoteCursors(): IterableIterator<RemoteVisitorCursor> {
    return this.remoteCursors.values();
  }

  private emitState(patch: Partial<CollabState>): void {
    this.state = { ...this.state, ...patch };
    this.onState({ ...this.state, visitors: [...this.state.visitors] });
  }

  public join(roomId: string, visitorName?: string): void {
    const cleanRoom =
      roomId
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '')
        .slice(0, 32) || 'fjord-hall';
    const name = visitorName?.trim().slice(0, 32) || this.state.selfName;

    this.disconnect(false);
    this.intentionalClose = false;
    this.emitState({
      status: 'connecting',
      roomId: cleanRoom,
      selfName: name,
      error: null,
    });

    this.openSocket(cleanRoom, name);
  }

  public updateName(name: string): void {
    const clean = name.trim().slice(0, 32);
    if (!clean) return;
    this.emitState({ selfName: clean });
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'join',
          roomId: this.state.roomId,
          clientId: this.selfId,
          name: clean,
          color: this.selfColor,
        }),
      );
    }
  }

  private openSocket(roomId: string, name: string): void {
    try {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      this.ws = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'join',
            roomId,
            clientId: this.selfId,
            name,
            color: this.selfColor,
          }),
        );
        this.emitState({ status: 'connected', error: null });
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
          const type = String(msg.type ?? '');

          if (type === 'room:state') {
            const visitors = (msg.visitors as CollabVisitor[] | undefined) ?? [];
            this.remoteCursors.clear();
            for (const v of visitors) {
              if (v.clientId !== this.selfId) {
                this.ensureRemoteCursor(v);
              }
            }
            this.emitState({ visitors });
            const trees = (msg.plantedTrees as SavedPlantedTree[] | undefined) ?? [];
            if (trees.length > 0) {
              this.onRemoteTrees(trees);
            }
          } else if (type === 'visitor:joined') {
            const v = msg.visitor as CollabVisitor | undefined;
            if (!v || v.clientId === this.selfId) return;
            this.ensureRemoteCursor(v);
            const nextVisitors = this.state.visitors.some((x) => x.clientId === v.clientId)
              ? this.state.visitors
              : [...this.state.visitors, v];
            this.emitState({ visitors: nextVisitors });
          } else if (type === 'visitor:left') {
            const cid = String(msg.clientId ?? '');
            this.remoteCursors.delete(cid);
            this.emitState({
              visitors: this.state.visitors.filter((v) => v.clientId !== cid),
            });
          } else if (type === 'visitor:cursor') {
            const cid = String(msg.clientId ?? '');
            const cursor = this.remoteCursors.get(cid);
            if (!cursor) return;
            cursor.targetPos.set(
              Number(msg.x ?? 999),
              Number(msg.y ?? 999),
              Number(msg.z ?? 999),
            );
            cursor.velocity.set(Number(msg.vx ?? 0), 0, Number(msg.vz ?? 0));
            cursor.force = Number(msg.force ?? 1);
            cursor.active = Boolean(msg.active);
            cursor.lastSeenAt = performance.now();
          } else if (type === 'tree:planted') {
            const tree = msg.tree as SavedPlantedTree | undefined;
            if (tree) this.onRemoteTrees([tree]);
          } else if (type === 'room:clear_wake') {
            this.onRemoteClearWake();
          }
        } catch {
          // Ignore malformed frame
        }
      };

      ws.onerror = () => {
        this.emitState({ status: 'error', error: 'Collaboration socket encountered an error.' });
      };

      ws.onclose = () => {
        this.ws = null;
        if (!this.intentionalClose && this.state.status !== 'disconnected') {
          this.emitState({ status: 'connecting' });
          this.reconnectTimer = window.setTimeout(() => {
            if (!this.intentionalClose) {
              this.openSocket(this.state.roomId, this.state.selfName);
            }
          }, 2500);
        }
      };
    } catch (err) {
      this.emitState({
        status: 'error',
        error: err instanceof Error ? err.message : 'Unable to connect to collaboration room.',
      });
    }
  }

  private ensureRemoteCursor(v: CollabVisitor): RemoteVisitorCursor {
    let rc = this.remoteCursors.get(v.clientId);
    if (!rc) {
      rc = {
        clientId: v.clientId,
        name: v.name,
        color: new THREE.Color(v.color || '#67e8f9'),
        targetPos: new THREE.Vector3(999, 999, 999),
        worldPos: new THREE.Vector3(999, 999, 999),
        velocity: new THREE.Vector3(),
        force: 1,
        active: false,
        lastSeenAt: 0,
      };
      this.remoteCursors.set(v.clientId, rc);
    }
    return rc;
  }

  public sendCursor(
    worldPos: THREE.Vector3,
    velocity: THREE.Vector3,
    force: number,
    active: boolean,
  ): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const now = performance.now();
    if (now - this.lastSentAt < 48) return; // ~20 Hz cap
    this.lastSentAt = now;

    this.ws.send(
      JSON.stringify({
        type: 'cursor',
        x: Number(worldPos.x.toFixed(2)),
        y: Number(worldPos.y.toFixed(2)),
        z: Number(worldPos.z.toFixed(2)),
        vx: Number(velocity.x.toFixed(2)),
        vz: Number(velocity.z.toFixed(2)),
        force: Number(force.toFixed(2)),
        active,
      }),
    );
  }

  public sendPlantTree(tree: SavedPlantedTree): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'plant', tree }));
  }

  public sendClearWake(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'clear_wake' }));
  }

  public stepSmoothing(dt: number): void {
    const now = performance.now();
    const alpha = 1 - Math.exp(-14 * dt);
    for (const rc of this.remoteCursors.values()) {
      if (now - rc.lastSeenAt > 3500) {
        rc.active = false;
      }
      if (rc.active && rc.targetPos.x < 900) {
        if (rc.worldPos.x > 900) rc.worldPos.copy(rc.targetPos);
        else rc.worldPos.lerp(rc.targetPos, alpha);
      } else {
        rc.worldPos.set(999, 999, 999);
      }
    }
  }

  public disconnect(emit = true): void {
    this.intentionalClose = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.remoteCursors.clear();
    if (emit) {
      this.emitState({ status: 'disconnected', visitors: [], error: null });
    }
  }
}
