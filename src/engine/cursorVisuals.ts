import * as THREE from 'three';
import { InteractionContext, InteractionMode, ModeType } from '../types/simulation';

const CONTEXT_COLORS: Record<InteractionContext, THREE.Color> = {
  All: new THREE.Color(0xdbeafe), // Alabaster / Pale ice
  'Trees Only': new THREE.Color(0x4ade80), // Botanical emerald
  'Water Only': new THREE.Color(0x38bdf8), // Fjord cyan
  'Ground Only': new THREE.Color(0xf59e0b), // Mineral amber
};

const PLANT_COLOR = new THREE.Color(0x86efac); // Fresh birch-sapling emerald

const RING_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const RING_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uEnergy;
  uniform float uOpacity;
  uniform float uModeId;
  uniform float uIsPlantMode;

  varying vec2 vUv;

  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    if (r > 1.0) discard;

    float angle = atan(p.y, p.x);

    // Outer precision reticle boundary
    float outerRing = smoothstep(0.035, 0.0, abs(r - 0.92));

    // Plant mode shows an 8-notch botanical placement reticle; Explore mode adapts per physics mode
    float segCount = uIsPlantMode > 0.5
      ? 8.0
      : (abs(uModeId - 3.0) < 0.25 ? 6.0 : (abs(uModeId - 4.0) < 0.25 ? 12.0 : 4.0));
    float segMask = smoothstep(-0.2, 0.35, sin(angle * segCount + uTime * (1.2 + uEnergy * 2.0)));
    float innerRing = smoothstep(0.025, 0.0, abs(r - 0.56)) * mix(0.35, 1.0, segMask);

    // Plant mode inner crosshair ticks
    float crossMask = 0.0;
    if (uIsPlantMode > 0.5) {
      float crossBand = step(0.18, r) * step(r, 0.42);
      float axis = min(abs(p.x), abs(p.y));
      crossMask = smoothstep(0.028, 0.0, axis) * crossBand;
    }

    float centerDot = smoothstep(0.09, 0.03, r);
    float radialGlow = exp(-r * r * 3.8) * (0.14 + uEnergy * 0.22);

    float alpha = (outerRing * 0.85 + innerRing * 0.65 + crossMask * 0.85 + centerDot * 0.9 + radialGlow) * uOpacity;
    if (alpha < 0.005) discard;

    gl_FragColor = vec4(uColor * (1.0 + uEnergy * 0.55), clamp(alpha, 0.0, 0.95));
  }
`;

const TRAIL_VERTEX = /* glsl */ `
  attribute float aLife;
  uniform float uSize;
  varying float vLife;

  void main() {
    vLife = aLife;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = uSize * aLife * (24.0 / max(1.0, -mvPosition.z));
  }
`;

const TRAIL_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vLife;

  void main() {
    if (vLife <= 0.01) discard;
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float alpha = smoothstep(0.5, 0.05, d) * vLife * 0.72;
    gl_FragColor = vec4(uColor * 1.2, alpha);
  }
`;

const TRAIL_LENGTH = 56;

class CursorInstance {
  public readonly group = new THREE.Group();
  private readonly ringMesh: THREE.Mesh;
  private readonly ringMaterial: THREE.ShaderMaterial;

  private readonly trailPoints: THREE.Points;
  private readonly trailGeometry: THREE.BufferGeometry;
  private readonly trailMaterial: THREE.ShaderMaterial;
  private readonly trailPositions = new Float32Array(TRAIL_LENGTH * 3);
  private readonly trailLives = new Float32Array(TRAIL_LENGTH);
  private trailHead = 0;
  private trailTimer = 0;

  private readonly currentColor = new THREE.Color(0xdbeafe);
  private readonly _lastDropPos = new THREE.Vector3(999, 999, 999);

  constructor(initialColorHex: number) {
    this.currentColor.setHex(initialColorHex);

    const planeGeo = new THREE.PlaneGeometry(2, 2);
    this.ringMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: this.currentColor },
        uTime: { value: 0 },
        uEnergy: { value: 0 },
        uOpacity: { value: 0 },
        uModeId: { value: 3 },
        uIsPlantMode: { value: 0 },
      },
      vertexShader: RING_VERTEX,
      fragmentShader: RING_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    this.ringMesh = new THREE.Mesh(planeGeo, this.ringMaterial);
    this.ringMesh.renderOrder = 20;
    this.ringMesh.frustumCulled = false;

    for (let i = 0; i < TRAIL_LENGTH; i++) {
      this.trailPositions[i * 3 + 1] = -10000;
      this.trailLives[i] = 0;
    }

    this.trailGeometry = new THREE.BufferGeometry();
    this.trailGeometry.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    this.trailGeometry.setAttribute('aLife', new THREE.BufferAttribute(this.trailLives, 1));

    this.trailMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: this.currentColor },
        uSize: { value: 14.0 },
      },
      vertexShader: TRAIL_VERTEX,
      fragmentShader: TRAIL_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.trailPoints = new THREE.Points(this.trailGeometry, this.trailMaterial);
    this.trailPoints.renderOrder = 19;
    this.trailPoints.frustumCulled = false;

    this.group.add(this.ringMesh);
    this.group.add(this.trailPoints);
  }

  public update(
    dt: number,
    elapsedTime: number,
    worldPos: THREE.Vector3,
    camera: THREE.Camera,
    radius: number,
    speed: number,
    context: InteractionContext,
    physicsMode: InteractionMode,
    appMode: ModeType,
    active: boolean,
    secondaryTint = false,
  ): void {
    const targetColor =
      appMode === 'plant'
        ? PLANT_COLOR
        : secondaryTint
          ? new THREE.Color(0x67e8f9)
          : CONTEXT_COLORS[context];
    this.currentColor.lerp(targetColor, Math.min(1, dt * 8.0));

    const modeMap: Record<InteractionMode, number> = {
      'Wind Gust': 0,
      Tornado: 1,
      Parting: 2,
      'Fluid Push/Pull': 3,
      'Seismic Ripple': 4,
      'Aurora Field': 5,
    };

    const clampedEnergy = THREE.MathUtils.clamp(speed * 0.08, 0, 1);
    const targetOpacity = active ? 0.9 : 0.0;
    const currentOpacity = THREE.MathUtils.damp(
      this.ringMaterial.uniforms.uOpacity.value as number,
      targetOpacity,
      10.0,
      dt,
    );

    if (active && worldPos.x < 900) {
      this.ringMesh.position.copy(worldPos);
    }

    if (
      appMode === 'plant' ||
      context === 'Ground Only' ||
      context === 'Water Only' ||
      physicsMode === 'Seismic Ripple'
    ) {
      this.ringMesh.rotation.set(-Math.PI / 2, 0, 0);
    } else {
      this.ringMesh.quaternion.copy(camera.quaternion);
    }

    const scale = appMode === 'plant' ? 1.8 : Math.max(0.8, radius * 0.42);
    this.ringMesh.scale.setScalar(scale);

    this.ringMaterial.uniforms.uTime.value = elapsedTime;
    this.ringMaterial.uniforms.uEnergy.value = clampedEnergy;
    this.ringMaterial.uniforms.uOpacity.value = currentOpacity;
    this.ringMaterial.uniforms.uModeId.value = modeMap[physicsMode];
    this.ringMaterial.uniforms.uIsPlantMode.value = appMode === 'plant' ? 1.0 : 0.0;

    for (let i = 0; i < TRAIL_LENGTH; i++) {
      if (this.trailLives[i] > 0) {
        this.trailLives[i] = Math.max(0, this.trailLives[i] - dt * 0.95);
      }
    }

    this.trailTimer += dt;
    if (active && appMode !== 'plant' && worldPos.x < 900) {
      const movedDist = worldPos.distanceTo(this._lastDropPos);
      if (movedDist > 0.25 || this.trailTimer > 0.035) {
        const idx = this.trailHead;
        this.trailPositions[idx * 3] = worldPos.x;
        this.trailPositions[idx * 3 + 1] = worldPos.y;
        this.trailPositions[idx * 3 + 2] = worldPos.z;
        this.trailLives[idx] = 1.0;

        this.trailHead = (this.trailHead + 1) % TRAIL_LENGTH;
        this._lastDropPos.copy(worldPos);
        this.trailTimer = 0;
      }
    }

    (this.trailGeometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.trailGeometry.attributes.aLife as THREE.BufferAttribute).needsUpdate = true;
  }

  public dispose(): void {
    this.ringMesh.geometry.dispose();
    this.ringMaterial.dispose();
    this.trailGeometry.dispose();
    this.trailMaterial.dispose();
  }
}

export class ContextCursorVisuals {
  public readonly group = new THREE.Group();
  private readonly primary = new CursorInstance(0xdbeafe);
  private readonly secondary = new CursorInstance(0x67e8f9);

  constructor() {
    this.group.add(this.primary.group);
    this.group.add(this.secondary.group);
  }

  public update(
    dt: number,
    elapsedTime: number,
    worldPos: THREE.Vector3,
    camera: THREE.Camera,
    radius: number,
    speed: number,
    context: InteractionContext,
    physicsMode: InteractionMode,
    appMode: ModeType,
    active: boolean,
    worldPos2?: THREE.Vector3,
    speed2 = 0,
    active2 = false,
  ): void {
    this.primary.update(
      dt,
      elapsedTime,
      worldPos,
      camera,
      radius,
      speed,
      context,
      physicsMode,
      appMode,
      active,
      false,
    );

    this.secondary.update(
      dt,
      elapsedTime,
      worldPos2 ?? worldPos,
      camera,
      radius * 0.9,
      speed2,
      context,
      physicsMode,
      appMode,
      active2 && appMode !== 'plant',
      true,
    );
  }

  public dispose(): void {
    this.primary.dispose();
    this.secondary.dispose();
  }
}
