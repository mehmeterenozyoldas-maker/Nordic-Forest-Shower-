import * as THREE from 'three';
import { RemoteVisitorCursor } from '../inputs/collabClient';
import { InteractionContext, InteractionMode, ModeType } from '../types/simulation';

const CONTEXT_COLORS: Record<InteractionContext, THREE.Color> = {
  All: new THREE.Color(0xdbeafe),
  'Trees Only': new THREE.Color(0x4ade80),
  'Water Only': new THREE.Color(0x38bdf8),
  'Ground Only': new THREE.Color(0xf59e0b),
};

const PLANT_COLOR = new THREE.Color(0x86efac);

const RING_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const RING_FRAGMENT = /* glsl */ `
  precision mediump float;
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

    float outerRing = smoothstep(0.035, 0.0, abs(r - 0.92));

    float segCount = uIsPlantMode > 0.5
      ? 8.0
      : (abs(uModeId - 3.0) < 0.25 ? 6.0 : (abs(uModeId - 4.0) < 0.25 ? 12.0 : 4.0));
    float segMask = smoothstep(-0.2, 0.35, sin(angle * segCount + uTime * (1.2 + uEnergy * 2.0)));
    float innerRing = smoothstep(0.025, 0.0, abs(r - 0.56)) * mix(0.35, 1.0, segMask);

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
  uniform float uPointScale;
  varying float vLife;

  void main() {
    vLife = aLife;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = clamp(uSize * aLife * uPointScale * (24.0 / max(1.0, -mvPosition.z)), 1.0, 24.0);
  }
`;

const TRAIL_FRAGMENT = /* glsl */ `
  precision mediump float;
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

const TRAIL_LENGTH = 48;
const REMOTE_POOL_SIZE = 6;

const MODE_MAP: Record<InteractionMode, number> = {
  'Wind Gust': 0,
  Tornado: 1,
  Parting: 2,
  'Fluid Push/Pull': 3,
  'Seismic Ripple': 4,
  'Aurora Field': 5,
};

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
  private hasAliveTrail = false;

  private readonly currentColor = new THREE.Color(0xdbeafe);
  private readonly _lastDropPos = new THREE.Vector3(999, 999, 999);

  constructor(initialColorHex: number, pointScale = 1.0) {
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
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
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
        uPointScale: { value: pointScale },
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
    this.group.visible = false;
  }

  public setPointScale(scale: number): void {
    this.trailMaterial.uniforms.uPointScale.value = scale;
  }

  public update(
    dt: number,
    elapsedTime: number,
    worldPos: THREE.Vector3,
    camWorldQuat: THREE.Quaternion,
    radius: number,
    speed: number,
    context: InteractionContext,
    physicsMode: InteractionMode,
    appMode: ModeType,
    active: boolean,
    customColor?: THREE.Color,
  ): void {
    const targetOpacity = active ? 0.9 : 0.0;
    const currentOpacity = THREE.MathUtils.damp(
      this.ringMaterial.uniforms.uOpacity.value as number,
      targetOpacity,
      10.0,
      dt,
    );

    if (!active && currentOpacity < 0.004 && !this.hasAliveTrail) {
      this.ringMaterial.uniforms.uOpacity.value = 0;
      this.group.visible = false;
      return;
    }

    this.group.visible = true;

    const targetColor = customColor
      ? customColor
      : appMode === 'plant'
        ? PLANT_COLOR
        : CONTEXT_COLORS[context];
    this.currentColor.lerp(targetColor, Math.min(1, dt * 8.0));

    const clampedEnergy = THREE.MathUtils.clamp(speed * 0.08, 0, 1);

    const groundLocked =
      appMode === 'plant' ||
      context === 'Ground Only' ||
      context === 'Water Only' ||
      physicsMode === 'Seismic Ripple';

    if (active && worldPos.x < 900) {
      this.ringMesh.position.copy(worldPos);
      if (groundLocked) {
        this.ringMesh.position.y += 0.16;
      }
    }

    if (groundLocked) {
      this.ringMesh.rotation.set(-Math.PI / 2, 0, 0);
    } else {
      this.ringMesh.quaternion.copy(camWorldQuat);
    }

    const scale = appMode === 'plant' ? 1.8 : Math.max(0.8, radius * 0.42);
    this.ringMesh.scale.setScalar(scale);

    this.ringMaterial.uniforms.uTime.value = elapsedTime;
    this.ringMaterial.uniforms.uEnergy.value = clampedEnergy;
    this.ringMaterial.uniforms.uOpacity.value = currentOpacity;
    this.ringMaterial.uniforms.uModeId.value = MODE_MAP[physicsMode];
    this.ringMaterial.uniforms.uIsPlantMode.value = appMode === 'plant' ? 1.0 : 0.0;

    let anyTrailAlive = false;
    for (let i = 0; i < TRAIL_LENGTH; i++) {
      if (this.trailLives[i] > 0) {
        this.trailLives[i] = Math.max(0, this.trailLives[i] - dt * 0.95);
        if (this.trailLives[i] > 0) anyTrailAlive = true;
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
        anyTrailAlive = true;

        this.trailHead = (this.trailHead + 1) % TRAIL_LENGTH;
        this._lastDropPos.copy(worldPos);
        this.trailTimer = 0;
      }
    }

    if (anyTrailAlive || this.hasAliveTrail) {
      (this.trailGeometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.trailGeometry.attributes.aLife as THREE.BufferAttribute).needsUpdate = true;
    }
    this.hasAliveTrail = anyTrailAlive;
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
  private readonly primary: CursorInstance;
  private readonly secondary: CursorInstance;
  private readonly remotePool: CursorInstance[] = [];
  private readonly _secondaryTint = new THREE.Color(0x67e8f9);
  private readonly _idlePos = new THREE.Vector3(999, 999, 999);
  private readonly _camWorldQuat = new THREE.Quaternion();

  constructor(pointScale = 1.0) {
    this.primary = new CursorInstance(0xdbeafe, pointScale);
    this.secondary = new CursorInstance(0x67e8f9, pointScale);
    this.group.add(this.primary.group);
    this.group.add(this.secondary.group);
    for (let i = 0; i < REMOTE_POOL_SIZE; i++) {
      const inst = new CursorInstance(0xfcd34d, pointScale);
      this.remotePool.push(inst);
      this.group.add(inst.group);
    }
  }

  public setPointScale(scale: number): void {
    this.primary.setPointScale(scale);
    this.secondary.setPointScale(scale);
    for (const rc of this.remotePool) rc.setPointScale(scale);
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
    remoteCursors?: IterableIterator<RemoteVisitorCursor>,
  ): void {
    camera.getWorldQuaternion(this._camWorldQuat);

    this.primary.update(
      dt,
      elapsedTime,
      worldPos,
      this._camWorldQuat,
      radius,
      speed,
      context,
      physicsMode,
      appMode,
      active,
    );

    this.secondary.update(
      dt,
      elapsedTime,
      worldPos2 ?? worldPos,
      this._camWorldQuat,
      radius * 0.9,
      speed2,
      context,
      physicsMode,
      appMode,
      active2 && appMode !== 'plant',
      this._secondaryTint,
    );

    let rIdx = 0;
    if (remoteCursors) {
      for (const rc of remoteCursors) {
        if (rIdx >= REMOTE_POOL_SIZE) break;
        const velMag = rc.velocity.length();
        this.remotePool[rIdx].update(
          dt,
          elapsedTime,
          rc.worldPos,
          this._camWorldQuat,
          radius * 0.85,
          velMag,
          context,
          physicsMode,
          'explore',
          rc.active,
          rc.color,
        );
        rIdx++;
      }
    }
    while (rIdx < REMOTE_POOL_SIZE) {
      this.remotePool[rIdx].update(
        dt,
        elapsedTime,
        this._idlePos,
        this._camWorldQuat,
        radius * 0.85,
        0,
        context,
        physicsMode,
        'explore',
        false,
      );
      rIdx++;
    }
  }

  public dispose(): void {
    this.primary.dispose();
    this.secondary.dispose();
    for (const rc of this.remotePool) rc.dispose();
  }
}
