import * as THREE from 'three';
import { PlantSpecies, Season, SimulationParams } from '../types/simulation';

export const PARTICLE_COUNT = 1_500_000;
export const TERRAIN_SIZE = 70;

const WOOD_COLOR_BASE = new THREE.Color(0x6b5b45);
const WOOD_COLOR_VAR = new THREE.Color(0x4a4031);

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

function simpleNoise(x: number, y: number, z: number): number {
  const s = Math.sin(x * 0.5) * Math.cos(y * 0.3) * Math.sin(z * 0.5);
  return (s + 1.0) * 0.5;
}

function smoothstep(min: number, max: number, value: number): number {
  const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return x * x * (3 - 2 * x);
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
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly types: Float32Array;
  private readonly birthTimes: Float32Array;
  private readonly colorHints: Float32Array; // Moisture / Palette seed for smooth GPU season morphing
  private pIndex = 0;

  private readonly _axis = new THREE.Vector3();
  private readonly _perp = new THREE.Vector3();
  private readonly _perp2 = new THREE.Vector3();
  private readonly _color = new THREE.Color();

  constructor(initialParams: SimulationParams) {
    this.geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(PARTICLE_COUNT * 3);
    this.colors = new Float32Array(PARTICLE_COUNT * 3);
    this.types = new Float32Array(PARTICLE_COUNT);
    this.birthTimes = new Float32Array(PARTICLE_COUNT);
    this.colorHints = new Float32Array(PARTICLE_COUNT);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
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

  private addParticle(
    x: number,
    y: number,
    z: number,
    color: THREE.Color,
    type: number,
    birthTime: number,
    hint: number,
  ): void {
    if (this.pIndex >= PARTICLE_COUNT) return;
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
    const density = 500;
    const segmentParticles = Math.max(20, Math.floor(length * radius * density));

    const axis = this._axis.copy(dir).normalize();
    const perp = this._perp.set(1, 0, 0);
    if (Math.abs(axis.x) > 0.9) perp.set(0, 1, 0);
    perp.cross(axis).normalize();
    const perp2 = this._perp2.crossVectors(axis, perp).normalize();

    for (let i = 0; i < segmentParticles; i++) {
      const h = Math.random() * length;
      const t = h / length;
      const r = radius * (1.0 - t * 0.2);
      const theta = Math.random() * Math.PI * 2;
      const rNoise = (Math.random() - 0.5) * 0.15 * radius;
      const distanceToCenter = Math.random();
      const ao = 0.4 + 0.6 * distanceToCenter;

      const radScale = (r + rNoise) * distanceToCenter;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      const px = start.x + axis.x * h + perp.x * radScale * cosT + perp2.x * radScale * sinT;
      const py = start.y + axis.y * h + perp.y * radScale * cosT + perp2.y * radScale * sinT;
      const pz = start.z + axis.z * h + perp.z * radScale * cosT + perp2.z * radScale * sinT;

      this._color
        .copy(WOOD_COLOR_BASE)
        .lerp(WOOD_COLOR_VAR, Math.random() * 0.8)
        .multiplyScalar(ao);
      this.addParticle(px, py, pz, this._color, 0.0, birthTime, Math.random());
    }

    if (depth <= 3) {
      const isTip = depth === 0;
      const leafDensity = isTip ? 180 : 50;
      const leafSpread = isTip ? 1.8 : 0.9;
      const currentPalette = PALETTES[season];

      for (let i = 0; i < leafDensity; i++) {
        const t = Math.pow(Math.random(), 0.6);
        const cx = start.x + dir.x * length * t;
        const cy = start.y + dir.y * length * t;
        const cz = start.z + dir.z * length * t;

        const ox = Math.random() - 0.5;
        const oy = Math.random() - 0.5;
        const oz = Math.random() - 0.5;
        const olen = Math.hypot(ox, oy, oz) || 1;
        const dist = Math.random() * leafSpread;

        const px = cx + (ox / olen) * dist;
        const py = cy + (oy / olen) * dist;
        const pz = cz + (oz / olen) * dist;

        const ao = 0.5 + 0.5 * (dist / leafSpread);
        const noiseVal = simpleNoise(px, py, pz);
        const paletteIndexFloat =
          noiseVal * (currentPalette.length - 1) + (Math.random() - 0.5) * 2.0;
        const paletteIndex = Math.max(
          0,
          Math.min(currentPalette.length - 1, Math.floor(paletteIndexFloat)),
        );

        this._color
          .copy(currentPalette[paletteIndex])
          .offsetHSL(0, 0, (Math.random() - 0.5) * 0.1)
          .multiplyScalar(ao);
        this.addParticle(px, py, pz, this._color, 1.0, birthTime, noiseVal);
      }
    }

    if (depth <= 0) return;

    const end = new THREE.Vector3().copy(start).addScaledVector(dir, length);
    let numBranches = 2;
    if (Math.random() < 0.25) numBranches = 3;
    if (depth > maxDepth - 2) numBranches = 2;

    for (let i = 0; i < numBranches; i++) {
      const spread = 0.8 + (Math.random() - 0.4) * 0.4;
      const angleX = (Math.random() - 0.5) * spread;
      const angleZ = (Math.random() - 0.5) * spread;

      const newDir = dir
        .clone()
        .applyEuler(new THREE.Euler(angleX, 0, angleZ))
        .normalize();
      newDir.y -= 0.08 * (maxDepth - depth) * 0.15;
      newDir.normalize();

      this.createBranch(
        end,
        newDir,
        length * (0.75 + Math.random() * 0.15),
        radius * 0.6,
        depth - 1,
        maxDepth,
        season,
        birthTime,
      );
    }
  }

  private createPine(start: THREE.Vector3, scale: number, season: Season, birthTime: number): void {
    const height = 10.0 * scale;
    const trunkRadius = 1.0 * scale;
    const trunkParticles = Math.floor(height * trunkRadius * 600);

    for (let i = 0; i < trunkParticles; i++) {
      const h = Math.random() * height;
      const r = trunkRadius * (1.0 - h / height);
      const theta = Math.random() * Math.PI * 2;
      const ao = 0.4 + 0.6 * Math.random();
      this._color
        .copy(WOOD_COLOR_BASE)
        .lerp(WOOD_COLOR_VAR, Math.random())
        .multiplyScalar(ao);
      this.addParticle(
        start.x + r * Math.cos(theta),
        start.y + h,
        start.z + r * Math.sin(theta),
        this._color,
        0.0,
        birthTime,
        Math.random(),
      );
    }

    const leafDensity = 4000 * scale;
    const currentPalette = PALETTES[season];
    const pineTint = new THREE.Color(0x166534);
    for (let i = 0; i < leafDensity; i++) {
      const h = Math.random() * height * 0.85 + height * 0.15;
      const maxR = (height - h) * 0.5;
      const r = Math.pow(Math.random(), 0.5) * maxR;
      const theta = Math.random() * Math.PI * 2;
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
        .lerp(pineTint, 0.3);

      this.addParticle(px, py, pz, this._color, 1.0, birthTime, noiseVal);
    }
  }

  private createBush(start: THREE.Vector3, scale: number, season: Season, birthTime: number): void {
    const radius = 2.5 * scale;
    const leafDensity = 3000 * scale;
    const currentPalette = PALETTES[season];
    for (let i = 0; i < leafDensity; i++) {
      const r = Math.pow(Math.random(), 0.4) * radius;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const px = start.x + r * Math.sin(phi) * Math.cos(theta);
      let py = start.y + r * Math.cos(phi) * 0.7;
      const pz = start.z + r * Math.sin(phi) * Math.sin(theta);
      if (py < start.y) py = start.y + Math.random() * 0.5;

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
    season: Season,
    elapsedTime: number,
  ): { ok: boolean; y: number } {
    const py = terrainHeight(x, z, roughness);
    if (this.pIndex > PARTICLE_COUNT - 16_000) {
      return { ok: false, y: py };
    }

    const s = scale + (Math.random() - 0.5) * 0.2;
    const tiltX = (Math.random() - 0.5) * 0.2;
    const tiltZ = (Math.random() - 0.5) * 0.2;
    const dir = new THREE.Vector3(tiltX, 1, tiltZ).normalize();
    const origin = new THREE.Vector3(x, py, z);

    if (species === 'Oak') {
      this.createBranch(origin, dir, 5.0 * s, 1.6 * s, 6, 6, season, elapsedTime);
    } else if (species === 'Pine') {
      this.createPine(origin, s, season, elapsedTime);
    } else {
      this.createBush(origin, s, season, elapsedTime);
    }

    this.geometry.setDrawRange(0, this.pIndex);
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.type as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.aBirthTime as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.aHint as THREE.BufferAttribute).needsUpdate = true;

    return { ok: true, y: py };
  }

  public generate(params: SimulationParams, markUpdate: boolean): void {
    this.pIndex = 0;

    // 1. Terrain & River
    const terrainParticles = 350_000;
    const colorDirt = new THREE.Color(0x3d3b38);
    const colorRock = new THREE.Color(0x7a8789);
    const waterBase = new THREE.Color(0x1c3d4d);
    const waterHigh = new THREE.Color(0x2a5a6b);
    const colorMoss = new THREE.Color(0x4a5d4e);
    const colorHigh = new THREE.Color(0x5c6b6d);

    for (let i = 0; i < terrainParticles; i++) {
      const px = (Math.random() - 0.5) * TERRAIN_SIZE;
      const pz = (Math.random() - 0.5) * TERRAIN_SIZE;

      const riverPathX = Math.sin(pz * 0.1) * 8.0 + Math.cos(pz * 0.05) * 5.0;
      const distToRiver = Math.abs(px - riverPathX);
      const baseHeight = terrainHeight(px, pz, params.terrainRoughness);
      const riverWidth = params.riverWidth + Math.sin(pz * 0.3) * 1.5;

      const depth = Math.pow(Math.random(), 2.0) * 3.0;
      const py = baseHeight - depth;

      if (distToRiver < riverWidth && baseHeight < -1.0) {
        const waterLevel = -2.0;
        if (py < waterLevel + 0.5) {
          this._color.copy(waterBase).lerp(waterHigh, Math.random());
          const waterY = waterLevel + (Math.random() - 0.5) * 0.2;
          this.addParticle(px, waterY, pz, this._color, 3.0, -10.0, Math.random());
        }
      } else {
        const moisture = 1.0 - smoothstep(riverWidth, riverWidth + 10.0, distToRiver);
        this._color
          .copy(colorDirt)
          .lerp(colorMoss, moisture)
          .lerp(colorHigh, smoothstep(-2.0, 2.0, baseHeight))
          .lerp(colorRock, smoothstep(2.0, 6.0, baseHeight))
          .offsetHSL(0, 0, (Math.random() - 0.5) * 0.1);

        const ao = 0.2 + 0.8 * (1.0 - depth / 3.0);
        this._color.multiplyScalar(ao);
        // Hint stores normalized height/moisture factor for winter frost/snow morphing
        const snowAffinity = clamp01(smoothstep(-2.0, 4.0, baseHeight) * 0.6 + moisture * 0.4);
        this.addParticle(px, py, pz, this._color, 2.0, -10.0, snowAffinity);
      }
    }

    // 2. Forest Trees (generated in base autumn palette; shader smoothly morphs seasons!)
    for (let i = 0; i < params.treeDensity; i++) {
      let tx = 0;
      let tz = 0;
      let valid = false;
      let attempts = 0;
      while (!valid && attempts < 100) {
        tx = (Math.random() - 0.5) * (TERRAIN_SIZE - 10);
        tz = (Math.random() - 0.5) * (TERRAIN_SIZE - 10);
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
        const scale = params.treeScale + Math.random() * 0.8;
        const tiltX = (Math.random() - 0.5) * 0.2;
        const tiltZ = (Math.random() - 0.5) * 0.2;
        const dir = new THREE.Vector3(tiltX, 1, tiltZ).normalize();
        const origin = new THREE.Vector3(tx, py, tz);

        if (params.plantType === 'Oak') {
          this.createBranch(origin, dir, 5.0 * scale, 1.6 * scale, 6, 6, 'autumn', -10.0);
        } else if (params.plantType === 'Pine') {
          this.createPine(origin, scale, 'autumn', -10.0);
        } else {
          this.createBush(origin, scale, 'autumn', -10.0);
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

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
