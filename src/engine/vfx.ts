import * as THREE from 'three';

const AMBIENT_COUNT = 6_000;
const BURST_CAPACITY = 4_000;

const AMBIENT_VERTEX = /* glsl */ `
  attribute float aSeed;
  attribute float aSize;

  uniform float uTime;
  uniform float uWindStrength;
  uniform vec3 uWindDir;
  uniform vec3 uSeasonWeights; // (autumn, spring, winter)
  uniform sampler2D uWakeTex;

  varying float vSeed;
  varying float vGlow;

  void main() {
    vSeed = aSeed;
    vec3 pos = position;

    // Wind + seasonal drift
    float driftSpeed = mix(0.6, 1.35, uSeasonWeights.z) * (0.4 + uWindStrength * 0.45);
    pos.x = mod(pos.x + uWindDir.x * uTime * driftSpeed * 2.2 + 35.0, 70.0) - 35.0;
    pos.z = mod(pos.z + uWindDir.z * uTime * driftSpeed * 2.2 + 35.0, 70.0) - 35.0;

    // Snow falls gently downward; spores & fireflies bob smoothly
    float fallRate = uSeasonWeights.z * 2.1;
    float bobAmp = mix(0.65, 1.35, uSeasonWeights.y);
    float rawY = pos.y - uTime * fallRate + sin(uTime * 1.4 + aSeed * 25.0) * bobAmp;
    pos.y = mod(rawY + 4.0, 24.0) - 4.0;

    // Lateral spiral turbulence
    pos.x += sin(uTime * 0.9 + aSeed * 19.0) * (0.5 + uSeasonWeights.y * 0.8);
    pos.z += cos(uTime * 0.85 + aSeed * 23.0) * (0.5 + uSeasonWeights.y * 0.8);

    // Couple to persistent GPU fluid wake field
    vec2 wakeUv = clamp((pos.xz / 70.0) + 0.5, vec2(0.002), vec2(0.998));
    vec4 wake = texture2D(uWakeTex, wakeUv);
    vec2 wakeVel = (wake.rg - 0.5) * 2.0;
    float wakeEnergy = wake.b;
    pos.xz += wakeVel * wakeEnergy * 2.8;
    pos.y += wakeEnergy * 1.8;

    // Firefly twinkle in spring, crisp shimmer in winter snow
    float pulse = 0.5 + 0.5 * sin(uTime * mix(2.2, 5.5, uSeasonWeights.y) + aSeed * 62.8);
    vGlow = mix(0.45 + 0.55 * pulse, 0.75 + 0.25 * pulse, uSeasonWeights.z) + wakeEnergy * 0.6;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    float seasonalSize = aSize * mix(1.0, 1.3, uSeasonWeights.y + uSeasonWeights.z * 0.5);
    gl_PointSize = seasonalSize * (22.0 / max(1.0, -mvPosition.z));
  }
`;

const AMBIENT_FRAGMENT = /* glsl */ `
  uniform vec3 uSeasonWeights;
  varying float vSeed;
  varying float vGlow;

  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;

    float core = smoothstep(0.5, 0.04, d);
    vec3 autumnSpore = mix(vec3(0.95, 0.78, 0.42), vec3(0.85, 0.58, 0.28), fract(vSeed * 7.3));
    vec3 springFirefly = mix(vec3(0.65, 0.98, 0.45), vec3(0.98, 0.92, 0.52), fract(vSeed * 11.1));
    vec3 winterSnow = mix(vec3(0.78, 0.90, 1.0), vec3(0.98, 0.99, 1.0), fract(vSeed * 5.7));

    vec3 col =
      autumnSpore * uSeasonWeights.x +
      springFirefly * uSeasonWeights.y +
      winterSnow * uSeasonWeights.z;

    float alpha = core * clamp(vGlow * 0.65, 0.12, 0.92);
    gl_FragColor = vec4(col * (0.9 + vGlow * 0.5), alpha);
  }
`;

export class AmbientAtmosphereSystem {
  public readonly points: THREE.Points;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;

  constructor(wakeTexture: THREE.Texture) {
    const positions = new Float32Array(AMBIENT_COUNT * 3);
    const seeds = new Float32Array(AMBIENT_COUNT);
    const sizes = new Float32Array(AMBIENT_COUNT);

    for (let i = 0; i < AMBIENT_COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 70;
      positions[i * 3 + 1] = Math.random() * 24 - 4;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 70;
      seeds[i] = Math.random();
      sizes[i] = 2.0 + Math.random() * 2.6;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uWindStrength: { value: 1.0 },
        uWindDir: { value: new THREE.Vector3(1, 0, 0) },
        uSeasonWeights: { value: new THREE.Vector3(1, 0, 0) },
        uWakeTex: { value: wakeTexture },
      },
      vertexShader: AMBIENT_VERTEX,
      fragmentShader: AMBIENT_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  public update(
    elapsedTime: number,
    windStrength: number,
    windDir: THREE.Vector3,
    seasonWeights: THREE.Vector3,
  ): void {
    this.material.uniforms.uTime.value = elapsedTime;
    this.material.uniforms.uWindStrength.value = windStrength;
    (this.material.uniforms.uWindDir.value as THREE.Vector3).copy(windDir);
    (this.material.uniforms.uSeasonWeights.value as THREE.Vector3).copy(seasonWeights);
  }

  public dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

const BURST_VERTEX = /* glsl */ `
  attribute float aLife;
  attribute vec3 aColor;
  attribute float aSize;

  varying float vLife;
  varying vec3 vColor;

  void main() {
    vLife = aLife;
    vColor = aColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = aSize * aLife * (24.0 / max(1.0, -mvPosition.z));
  }
`;

const BURST_FRAGMENT = /* glsl */ `
  varying float vLife;
  varying vec3 vColor;

  void main() {
    if (vLife <= 0.01) discard;
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float alpha = smoothstep(0.5, 0.05, d) * vLife;
    gl_FragColor = vec4(vColor * (1.2 + (1.0 - vLife) * 0.6), alpha);
  }
`;

export type BurstKind = 'splash' | 'spark' | 'plant';

export class ImpactBurstSystem {
  public readonly points: THREE.Points;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;

  private readonly positions = new Float32Array(BURST_CAPACITY * 3);
  private readonly velocities = new Float32Array(BURST_CAPACITY * 3);
  private readonly colors = new Float32Array(BURST_CAPACITY * 3);
  private readonly lives = new Float32Array(BURST_CAPACITY);
  private readonly sizes = new Float32Array(BURST_CAPACITY);
  private head = 0;

  constructor() {
    for (let i = 0; i < BURST_CAPACITY; i++) {
      this.positions[i * 3 + 1] = -10000;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('aLife', new THREE.BufferAttribute(this.lives, 1));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));

    this.material = new THREE.ShaderMaterial({
      vertexShader: BURST_VERTEX,
      fragmentShader: BURST_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 16;
  }

  public spawnBurst(worldPos: THREE.Vector3, count: number, kind: BurstKind): void {
    for (let i = 0; i < count; i++) {
      const idx = this.head;
      const i3 = idx * 3;
      this.head = (this.head + 1) % BURST_CAPACITY;

      const angle = Math.random() * Math.PI * 2;
      const speedHoriz =
        kind === 'plant'
          ? 1.5 + Math.random() * 5.0
          : kind === 'splash'
            ? 1.0 + Math.random() * 4.5
            : 2.0 + Math.random() * 6.5;
      const speedUp =
        kind === 'splash'
          ? 2.8 + Math.random() * 5.2
          : kind === 'plant'
            ? 3.2 + Math.random() * 6.0
            : 1.5 + Math.random() * 4.5;

      this.positions[i3] = worldPos.x + (Math.random() - 0.5) * 0.4;
      this.positions[i3 + 1] = worldPos.y + 0.1;
      this.positions[i3 + 2] = worldPos.z + (Math.random() - 0.5) * 0.4;

      this.velocities[i3] = Math.cos(angle) * speedHoriz;
      this.velocities[i3 + 1] = speedUp;
      this.velocities[i3 + 2] = Math.sin(angle) * speedHoriz;

      this.lives[idx] = 0.75 + Math.random() * 0.25;
      this.sizes[idx] = kind === 'splash' ? 4.5 + Math.random() * 3.5 : 3.5 + Math.random() * 3.0;

      if (kind === 'splash') {
        this.colors[i3] = 0.45 + Math.random() * 0.35;
        this.colors[i3 + 1] = 0.85 + Math.random() * 0.15;
        this.colors[i3 + 2] = 1.0;
      } else if (kind === 'plant') {
        this.colors[i3] = 0.35 + Math.random() * 0.4;
        this.colors[i3 + 1] = 0.92 + Math.random() * 0.08;
        this.colors[i3 + 2] = 0.58 + Math.random() * 0.25;
      } else {
        this.colors[i3] = 1.0;
        this.colors[i3 + 1] = 0.55 + Math.random() * 0.35;
        this.colors[i3 + 2] = 0.22 + Math.random() * 0.3;
      }
    }
  }

  public update(dt: number): void {
    let anyAlive = false;
    const gravity = 9.8;
    const drag = Math.exp(-1.5 * dt);

    for (let i = 0; i < BURST_CAPACITY; i++) {
      const life = this.lives[i];
      if (life <= 0) continue;

      anyAlive = true;
      const i3 = i * 3;
      this.velocities[i3] *= drag;
      this.velocities[i3 + 1] = this.velocities[i3 + 1] * drag - gravity * dt;
      this.velocities[i3 + 2] *= drag;

      this.positions[i3] += this.velocities[i3] * dt;
      this.positions[i3 + 1] += this.velocities[i3 + 1] * dt;
      this.positions[i3 + 2] += this.velocities[i3 + 2] * dt;

      this.lives[i] = Math.max(0, life - dt * 1.15);
    }

    if (anyAlive) {
      (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.geometry.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
      (this.geometry.attributes.aLife as THREE.BufferAttribute).needsUpdate = true;
      (this.geometry.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  public dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

export const AtmospherePostShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSunScreenPos: { value: new THREE.Vector2(0.75, 0.75) },
    uSunColor: { value: new THREE.Color(1.0, 0.9, 0.78) },
    uSunIntensity: { value: 0.22 },
    uChromaticAmount: { value: 0.0008 },
    uVignetteStrength: { value: 0.32 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uSunScreenPos;
    uniform vec3 uSunColor;
    uniform float uSunIntensity;
    uniform float uChromaticAmount;
    uniform float uVignetteStrength;

    varying vec2 vUv;

    void main() {
      vec2 toCenter = vUv - vec2(0.5);
      float radialDist = length(toCenter);

      // Subtle velocity & seismic-reactive chromatic aberration at edges
      vec2 caOffset = toCenter * uChromaticAmount * (0.4 + radialDist * 1.6);
      float r = texture2D(tDiffuse, clamp(vUv + caOffset, 0.0, 1.0)).r;
      vec4 centerSample = texture2D(tDiffuse, vUv);
      float b = texture2D(tDiffuse, clamp(vUv - caOffset, 0.0, 1.0)).b;
      vec3 col = vec3(r, centerSample.g, b);

      // Volumetric Radial Sunbeams (Crepuscular Screen-Space God Rays)
      if (uSunIntensity > 0.005) {
        vec2 deltaUv = (vUv - uSunScreenPos) * (1.0 / 12.0) * 0.65;
        vec2 sampleUv = vUv;
        float illuminationDecay = 1.0;
        vec3 rays = vec3(0.0);

        for (int i = 0; i < 12; i++) {
          sampleUv -= deltaUv;
          vec3 s = texture2D(tDiffuse, clamp(sampleUv, 0.001, 0.999)).rgb;
          float luma = dot(s, vec3(0.299, 0.587, 0.114));
          rays += s * smoothstep(0.18, 0.85, luma) * illuminationDecay;
          illuminationDecay *= 0.9;
        }
        float sunMask = smoothstep(1.35, 0.0, length(vUv - uSunScreenPos));
        col += (rays / 12.0) * uSunColor * uSunIntensity * (0.4 + 0.6 * sunMask);
      }

      // Soft museum framing vignette
      float vignette = smoothstep(0.95, 0.28, radialDist);
      col *= mix(1.0, vignette, uVignetteStrength);

      gl_FragColor = vec4(col, centerSample.a);
    }
  `,
};
