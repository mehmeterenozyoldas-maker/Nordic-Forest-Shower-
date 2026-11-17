import * as THREE from 'three';
import { PlantSpecies, SavedPlantedTree, Season, SimulationParams } from '../types/simulation';
import { QualityProfile } from './quality';

export const TERRAIN_SIZE = 70;

const WOOD_COLOR_BASE = new THREE.Color(0x6b5b45);
const WOOD_COLOR_VAR = new THREE.Color(0x4a4031);
const PINE_TINT = new THREE.Color(0x166534);

const PALETTES: Record<Season, THREE.Color[]> = {
  autumn: [
    new THREE.Color(0x8b7355),
    new THREE.Color(0x6b5b45),
    new THREE.Color(0xa0855b),
    new THREE.Color(0x5c4d3c),
    new THREE.Color(0x8c3a3a),
    new THREE.Color(0x4a5e31),
    new THREE.Color(0x7a8b6c),
    new THREE.Color(0x9e907f),
  ],
  spring: [
    new THREE.Color(0x6b8e23),
    new THREE.Color(0x556b2f),
    new THREE.Color(0x8fbc8f),
    new THREE.Color(0x4f6f52),
    new THREE.Color(0x78866b),
    new THREE.Color(0x9eab88),
    new THREE.Color(0xdbe5d0),
    new THREE.Color(0xe8ece1),
  ],
  winter: [
    new THREE.Color(0x2f4f4f),
    new THREE.Color(0x3a4f3d),
    new THREE.Color(0x4a5d5e),
    new THREE.Color(0x708090),
    new THREE.Color(0xb0c4de),
    new THREE.Color(0xe6e6fa),
    new THREE.Color(0xf0f8ff),
    new THREE.Color(0xffffff),
  ],
};

function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function simpleNoise(x: number, y: number, z: number): number {
  const s = Math.sin(x * 0.5) * Math.cos(y * 0.3) * Math.sin(z * 0.5);
  return (s + 1.0) * 0.5;
}

function smoothstep(min: number, max: number, value: number): number {
  const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return x * x * (3 - 2 * x);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function terrainHeight(x: number, z: number, roughness: number): number {
  const riverPathX = Math.sin(z * 0.1) * 8.0 + Math.cos(z * 0.05) * 5.0;
  const distToRiver = Math.abs(x - riverPathX);

  let h = (1.0 - Math.exp(-distToRiver * 0.15)) * 8.0;
  h += Math.sin(x * 0.2) * Math.cos(z * 0.2) * roughness;
  h += Math.sin(x * 0.5 + z * 0.3) * (roughness * 0.25);

  return h - 4.0;
}

export class ParticleEnvironment {
  public readonly geometry: THREE.BufferGeometry;
  private readonly profile: QualityProfile;
  private readonly maxParticles: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly types: Float32Array;
  private readonly birthTimes: Float32Array;
  private readonly colorHints: Float32Array;
  private pIndex = 0;

  private plantedTrees: SavedPlantedTree[] = [];
  private plantedIds = new Set<string>();
  private rng: () => number = Math.random;

  private readonly _axis = new THREE.Vector3();
  private readonly _perp = new THREE.Vector3();
  private readonly _perp2 = new THREE.Vector3();
  private readonly _color = new THREE.Color();
  private readonly _euler = new THREE.Euler();
  private readonly _origin = new THREE.Vector3();
  private readonly _dir = new THREE.Vector3();
  private readonly _branchEnds = Array.from({ length: 8 }, () => new THREE.Vector3());
  private readonly _branchDirs = Array.from({ length: 8 }, () => new THREE.Vector3());

  constructor(initialParams: SimulationParams, profile: QualityProfile) {
    this.profile = profile;
    this.maxParticles = profile.maxParticles;

    this.geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(this.maxParticles * 3);
    this.colors = new Float32Array(this.maxParticles * 3);
    this.types = new Float32Array(this.maxParticles);
    this.birthTimes = new Float32Array(this.maxParticles);
    this.colorHints = new Float32Array(this.maxParticles);

    for (let i = 0; i < this.maxParticles; i++) {
      this.positions[i * 3 + 1] = -10000;
      this.birthTimes[i] = -10.0;
    }

    this.generate(initialParams, false);

    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('type', new THREE.BufferAttribute(this.types, 1));
    this.geometry.setAttribute('aBirthTime', new THREE.BufferAttribute(this.birthTimes, 1));
    this.geometry.setAttribute('aHint', new THREE.BufferAttribute(this.colorHints, 1));
  }

  public getPlantedTrees(): SavedPlantedTree[] {
    return [...this.plantedTrees];
  }

  public hasPlantedTree(id: string): boolean {
    return this.plantedIds.has(id);
  }

  private addParticle(
    x: number,
    y: number,
    z: number,
    color: THREE.Color,
    type: number,
    birthTime: number,
    hint: number,
  ): void {
    if (this.pIndex >= this.maxParticles) return;
    const idx3 = this.pIndex * 3;
    this.positions[idx3] = x;
    this.positions[idx3 + 1] = y;
    this.positions[idx3 + 2] = z;

    this.colors[idx3] = color.r;
    this.colors[idx3 + 1] = color.g;
    this.colors[idx3 + 2] = color.b;

    this.types[this.pIndex] = type;
    this.birthTimes[this.pIndex] = birthTime;
    this.colorHints[this.pIndex] = hint;
    this.pIndex++;
  }

  private createBranch(
    start: THREE.Vector3,
    dir: THREE.Vector3,
    length: number,
    radius: number,
    depth: number,
    maxDepth: number,
    season: Season,
    birthTime: number,
  ): void {
    if (this.pIndex >= this.maxParticles) return;

    const rand = this.rng;
    const isLight = this.profile.tier !== 'desktop';
    const density = isLight ? 280 : 410;
    const segmentParticles = Math.max(12, Math.floor(length * radius * density));

    const axis = this._axis.copy(dir).normalize();
    const perp = this._perp.set(1, 0, 0);
    if (Math.abs(axis.x) > 0.9) perp.set(0, 1, 0);
    perp.cross(axis).normalize();
    const perp2 = this._perp2.crossVectors(axis, perp).normalize();

    for (let i = 0; i < segmentParticles; i++) {
      const h = rand() * length;
      const t = h / length;
      const r = radius * (1.0 - t * 0.2);
      const theta = rand() * Math.PI * 2;
      const rNoise = (rand() - 0.5) * 0.15 * radius;
      const distanceToCenter = rand();
      const ao = 0.4 + 0.6 * distanceToCenter;

      const radScale = (r + rNoise) * distanceToCenter;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      const px = start.x + axis.x * h + perp.x * radScale * cosT + perp2.x * radScale * sinT;
      const py = start.y + axis.y * h + perp.y * radScale * cosT + perp2.y * radScale * sinT;
      const pz = start.z + axis.z * h + perp.z * radScale * cosT + perp2.z * radScale * sinT;

      this._color
        .copy(WOOD_COLOR_BASE)
        .lerp(WOOD_COLOR_VAR, rand() * 0.8)
        .multiplyScalar(ao);
      this.addParticle(px, py, pz, this._color, 0.0, birthTime, rand());
    }

    if (depth <= 3) {
      const isTip = depth === 0;
      const leafDensity = isTip ? (isLight ? 95 : 145) : (isLight ? 28 : 42);
      const leafSpread = isTip ? 1.85 : 0.95;
      const currentPalette = PALETTES[season];

      for (let i = 0; i < leafDensity; i++) {
        const t = Math.pow(rand(), 0.6);
        const cx = start.x + dir.x * length * t;
        const cy = start.y + dir.y * length * t;
        const cz = start.z + dir.z * length * t;

        const ox = rand() - 0.5;
        const oy = rand() - 0.5;
        const oz = rand() - 0.5;
        const olen = Math.hypot(ox, oy, oz) || 1;
        const dist = rand() * leafSpread;

        const px = cx + (ox / olen) * dist;
        const py = cy + (oy / olen) * dist;
        const pz = cz + (oz / olen) * dist;

        const ao = 0.5 + 0.5 * (dist / leafSpread);
        const noiseVal = simpleNoise(px, py, pz);
        const paletteIndexFloat =
          noiseVal * (currentPalette.length - 1) + (rand() - 0.5) * 2.0;
        const paletteIndex = Math.max(
          0,
          Math.min(currentPalette.length - 1, Math.floor(paletteIndexFloat)),
        );

        this._color
          .copy(currentPalette[paletteIndex])
          .offsetHSL(0, 0, (rand() - 0.5) * 0.1)
          .multiplyScalar(ao);
        this.addParticle(px, py, pz, this._color, 1.0, birthTime, noiseVal);
      }
    }

    if (depth <= 0) return;

    const end = this._branchEnds[depth].copy(start).addScaledVector(dir, length);
    let numBranches = 2;
    if (rand() < 0.25) numBranches = 3;
    if (depth > maxDepth - 2) numBranches = 2;

    for (let i = 0; i < numBranches; i++) {
      const spread = 0.8 + (rand() - 0.4) * 0.4;
      const angleX = (rand() - 0.5) * spread;
      const angleZ = (rand() - 0.5) * spread;

      this._euler.set(angleX, 0, angleZ);
      const newDir = this._branchDirs[depth]
        .copy(dir)
        .applyEuler(this._euler)
        .normalize();
      newDir.y -= 0.08 * (maxDepth - depth) * 0.15;
      newDir.normalize();

      this.createBranch(
        end,
        newDir,
        length * (0.75 + rand() * 0.15),
        radius * 0.6,
        depth - 1,
        maxDepth,
        season,
        birthTime,
      );
    }
  }

  private createPine(start: THREE.Vector3, scale: number, season: Season, birthTime: number): void {
    const rand = this.rng;
    const isLight = this.profile.tier !== 'desktop';
    const height = 10.0 * scale;
    const trunkRadius = 1.0 * scale;
    const trunkParticles = Math.floor(height * trunkRadius * (isLight ? 320 : 480));

    for (let i = 0; i < trunkParticles; i++) {
      const h = rand() * height;
      const r = trunkRadius * (1.0 - h / height);
      const theta = rand() * Math.PI * 2;
      const ao = 0.4 + 0.6 * rand();
      this._color
        .copy(WOOD_COLOR_BASE)
        .lerp(WOOD_COLOR_VAR, rand())
        .multiplyScalar(ao);
      this.addParticle(
        start.x + r * Math.cos(theta),
        start.y + h,
        start.z + r * Math.sin(theta),
        this._color,
        0.0,
        birthTime,
        rand(),
      );
    }

    const leafDensity = (isLight ? 2100 : 3200) * scale;
    const currentPalette = PALETTES[season];
    for (let i = 0; i < leafDensity; i++) {
      const h = rand() * height * 0.85 + height * 0.15;
      const maxR = (height - h) * 0.5;
      const r = Math.pow(rand(), 0.5) * maxR;
      const theta = rand() * Math.PI * 2;
      const px = start.x + r * Math.cos(theta);
      const py = start.y + h;
      const pz = start.z + r * Math.sin(theta);

      const distFromCenter = maxR > 0 ? r / maxR : 0;
      const ao = 0.3 + 0.7 * distFromCenter;
      const noiseVal = simpleNoise(px, py, pz);
      const paletteIndex = Math.floor(noiseVal * (currentPalette.length - 1));
      this._color
        .copy(currentPalette[paletteIndex])
        .multiplyScalar(ao)
        .lerp(PINE_TINT, 0.3);

      this.addParticle(px, py, pz, this._color, 1.0, birthTime, noiseVal);
    }
  }

  private createBush(start: THREE.Vector3, scale: number, season: Season, birthTime: number): void {
    const rand = this.rng;
    const isLight = this.profile.tier !== 'desktop';
    const radius = 2.5 * scale;
    const leafDensity = (isLight ? 1500 : 2400) * scale;
    const currentPalette = PALETTES[season];
    for (let i = 0; i < leafDensity; i++) {
      const r = Math.pow(rand(), 0.4) * radius;
      const theta = rand() * Math.PI * 2;
      const phi = rand() * Math.PI;
      const px = start.x + r * Math.sin(phi) * Math.cos(theta);
      let py = start.y + r * Math.cos(phi) * 0.7;
      const pz = start.z + r * Math.sin(phi) * Math.sin(theta);
      if (py < start.y) py = start.y + rand() * 0.5;

      const ao = 0.4 + 0.6 * (r / radius);
      const noiseVal = simpleNoise(px, py, pz);
      const paletteIndex = Math.floor(noiseVal * (currentPalette.length - 1));
      this._color.copy(currentPalette[paletteIndex]).multiplyScalar(ao);

      this.addParticle(px, py, pz, this._color, 1.0, birthTime, noiseVal);
    }
  }

  public plantTreeAt(
    x: number,
    z: number,
    species: PlantSpecies,
    scale: number,
    roughness: number,
    _season: Season,
    elapsedTime: number,
    explicitTree?: SavedPlantedTree,
  ): { ok: boolean; y: number; tree?: SavedPlantedTree } {
    if (explicitTree && this.plantedIds.has(explicitTree.id)) {
      return { ok: false, y: terrainHeight(x, z, roughness) };
    }
    const py = terrainHeight(x, z, roughness);
    if (this.pIndex > this.maxParticles - 6_500) {
      return { ok: false, y: py };
    }

    const treeId = explicitTree?.id ?? `tr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const treeScale = explicitTree?.scale ?? scale + (Math.random() - 0.5) * 0.2;
    const treeSpecies = explicitTree?.species ?? species;

    const coordSeed =
      (Math.abs(Math.round(x * 100)) * 73856093) ^
      (Math.abs(Math.round(z * 100)) * 19349663) ^
      treeSpecies.length;
    this.rng = createSeededRng(coordSeed);

    const tiltX = (this.rng() - 0.5) * 0.2;
    const tiltZ = (this.rng() - 0.5) * 0.2;
    this._dir.set(tiltX, 1, tiltZ).normalize();
    this._origin.set(x, py, z);

    const depth = this.profile.treeDepth;
    if (treeSpecies === 'Oak') {
      this.createBranch(this._origin, this._dir, 5.0 * treeScale, 1.6 * treeScale, depth, depth, 'autumn', elapsedTime);
    } else if (treeSpecies === 'Pine') {
      this.createPine(this._origin, treeScale, 'autumn', elapsedTime);
    } else {
      this.createBush(this._origin, treeScale, 'autumn', elapsedTime);
    }

    const record: SavedPlantedTree = explicitTree ?? {
      id: treeId,
      x: Number(x.toFixed(2)),
      z: Number(z.toFixed(2)),
      species: treeSpecies,
      scale: Number(treeScale.toFixed(3)),
      plantedAt: Date.now(),
    };
    this.plantedTrees.push(record);
    this.plantedIds.add(record.id);

    this.geometry.setDrawRange(0, this.pIndex);
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.type as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.aBirthTime as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.aHint as THREE.BufferAttribute).needsUpdate = true;

    return { ok: true, y: py, tree: record };
  }

  public restorePlantedTrees(
    trees: SavedPlantedTree[],
    roughness: number,
    season: Season,
    elapsedTime: number,
  ): number {
    let added = 0;
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i];
      if (this.plantedIds.has(t.id)) continue;
      const res = this.plantTreeAt(
        t.x,
        t.z,
        t.species,
        t.scale,
        roughness,
        season,
        elapsedTime + Math.min(i * 0.04, 0.8),
        t,
      );
      if (res.ok) added++;
    }
    return added;
  }

  public generate(params: SimulationParams, markUpdate: boolean): void {
    this.pIndex = 0;
    this.plantedTrees = [];
    this.plantedIds.clear();
    this.rng = createSeededRng(params.terrainSeed || 104729);
    const rand = this.rng;

    const terrainParticles = this.profile.terrainParticles;
    const colorDirt = new THREE.Color(0x3d3b38);
    const colorRock = new THREE.Color(0x7a8789);
    const waterBase = new THREE.Color(0x1c3d4d);
    const waterHigh = new THREE.Color(0x2a5a6b);
    const colorMoss = new THREE.Color(0x4a5d4e);
    const colorHigh = new THREE.Color(0x5c6b6d);

    for (let i = 0; i < terrainParticles; i++) {
      const px = (rand() - 0.5) * TERRAIN_SIZE;
      const pz = (rand() - 0.5) * TERRAIN_SIZE;

      const riverPathX = Math.sin(pz * 0.1) * 8.0 + Math.cos(pz * 0.05) * 5.0;
      const distToRiver = Math.abs(px - riverPathX);
      const baseHeight = terrainHeight(px, pz, params.terrainRoughness);
      const riverWidth = params.riverWidth + Math.sin(pz * 0.3) * 1.5;

      const depth = Math.pow(rand(), 2.0) * 3.0;
      const py = baseHeight - depth;

      if (distToRiver < riverWidth && baseHeight < -1.0) {
        const waterLevel = -2.0;
        if (py < waterLevel + 0.5) {
          this._color.copy(waterBase).lerp(waterHigh, rand());
          const waterY = waterLevel + (rand() - 0.5) * 0.2;
          this.addParticle(px, waterY, pz, this._color, 3.0, -10.0, rand());
        }
      } else {
        const moisture = 1.0 - smoothstep(riverWidth, riverWidth + 10.0, distToRiver);
        this._color
          .copy(colorDirt)
          .lerp(colorMoss, moisture)
          .lerp(colorHigh, smoothstep(-2.0, 2.0, baseHeight))
          .lerp(colorRock, smoothstep(2.0, 6.0, baseHeight))
          .offsetHSL(0, 0, (rand() - 0.5) * 0.1);

        const ao = 0.2 + 0.8 * (1.0 - depth / 3.0);
        this._color.multiplyScalar(ao);
        const snowAffinity = clamp01(smoothstep(-2.0, 4.0, baseHeight) * 0.6 + moisture * 0.4);
        this.addParticle(px, py, pz, this._color, 2.0, -10.0, snowAffinity);
      }
    }

    const treeCount = Math.min(params.treeDensity, this.profile.treeDensity);
    const depth = this.profile.treeDepth;

    for (let i = 0; i < treeCount; i++) {
      let tx = 0;
      let tz = 0;
      let valid = false;
      let attempts = 0;
      while (!valid && attempts < 100) {
        tx = (rand() - 0.5) * (TERRAIN_SIZE - 10);
        tz = (rand() - 0.5) * (TERRAIN_SIZE - 10);
        const riverPathX = Math.sin(tz * 0.1) * 8.0 + Math.cos(tz * 0.05) * 5.0;
        const distToRiver = Math.abs(tx - riverPathX);
        const riverWidth = params.riverWidth + Math.sin(tz * 0.3) * 1.5;

        if (distToRiver > riverWidth + 2.0) {
          valid = true;
        }
        attempts++;
      }

      if (valid) {
        const py = terrainHeight(tx, tz, params.terrainRoughness);
        const scale = params.treeScale + rand() * 0.8;
        const tiltX = (rand() - 0.5) * 0.2;
        const tiltZ = (rand() - 0.5) * 0.2;
        this._dir.set(tiltX, 1, tiltZ).normalize();
        this._origin.set(tx, py, tz);

        if (params.plantType === 'Oak') {
          this.createBranch(this._origin, this._dir, 5.0 * scale, 1.6 * scale, depth, depth, 'autumn', -10.0);
        } else if (params.plantType === 'Pine') {
          this.createPine(this._origin, scale, 'autumn', -10.0);
        } else {
          this.createBush(this._origin, scale, 'autumn', -10.0);
        }
      }
    }

    this.geometry.setDrawRange(0, this.pIndex);
    if (markUpdate) {
      (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
      (this.geometry.attributes.type as THREE.BufferAttribute).needsUpdate = true;
      (this.geometry.attributes.aBirthTime as THREE.BufferAttribute).needsUpdate = true;
      (this.geometry.attributes.aHint as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  public dispose(): void {
    this.geometry.dispose();
  }
}
