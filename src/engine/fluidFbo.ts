import * as THREE from 'three';

const CLEAR_FRAGMENT = /* glsl */ `
  void main() {
    gl_FragColor = vec4(0.5, 0.5, 0.0, 0.0);
  }
`;

const SIM_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const SIM_FRAGMENT = /* glsl */ `
  precision highp float;

  uniform sampler2D uPrevTex;
  uniform vec2 uTexelSize;
  uniform float uDt;
  uniform float uModeId;

  uniform vec2 uSplatUv;
  uniform vec2 uSplatVel;
  uniform float uSplatRadiusUv;
  uniform float uSplatEnergy;
  uniform float uSplatActive;

  uniform vec2 uSplat2Uv;
  uniform vec2 uSplat2Vel;
  uniform float uSplat2RadiusUv;
  uniform float uSplat2Energy;
  uniform float uSplat2Active;

  varying vec2 vUv;

  void injectSplat(
    vec2 splatUv,
    vec2 splatVel,
    float radiusUv,
    float splatEnergy,
    inout vec2 bVel,
    inout float energy,
    inout float ripple
  ) {
    vec2 diff = vUv - splatUv;
    float d = length(diff);
    float r = max(0.015, radiusUv);
    float splat = exp(-(d * d) / (r * r));

    vec2 radialDir = d > 0.0001 ? normalize(diff) : vec2(0.0);
    vec2 tangentDir = vec2(-radialDir.y, radialDir.x);

    vec2 injectVel = splatVel;
    if (abs(uModeId - 1.0) < 0.25) {
      injectVel += tangentDir * 0.85;
    } else if (abs(uModeId - 2.0) < 0.25) {
      injectVel += radialDir * 0.7;
    } else if (abs(uModeId - 3.0) < 0.25) {
      injectVel += tangentDir * 0.35;
    }

    bVel = clamp(bVel + injectVel * splat * min(uDt * 12.0, 0.65), vec2(-1.0), vec2(1.0));
    energy = clamp(energy + splat * clamp(splatEnergy, 0.15, 1.5) * min(uDt * 5.0, 0.55), 0.0, 1.0);

    float ring = exp(-pow((d - r * 0.65) / (r * 0.35), 2.0));
    ripple = clamp(ripple + ring * clamp(splatEnergy, 0.2, 1.2) * min(uDt * 4.5, 0.5), 0.0, 1.0);
  }

  void main() {
    vec4 center = texture2D(uPrevTex, vUv);
    vec2 vel = (center.rg - 0.5) * 2.0;

    vec2 advUv = clamp(vUv - vel * uDt * 0.16, vec2(0.002), vec2(0.998));
    vec4 advected = texture2D(uPrevTex, advUv);

    vec4 n = texture2D(uPrevTex, clamp(advUv + vec2(0.0, uTexelSize.y), 0.002, 0.998));
    vec4 s = texture2D(uPrevTex, clamp(advUv - vec2(0.0, uTexelSize.y), 0.002, 0.998));
    vec4 e = texture2D(uPrevTex, clamp(advUv + vec2(uTexelSize.x, 0.0), 0.002, 0.998));
    vec4 w = texture2D(uPrevTex, clamp(advUv - vec2(uTexelSize.x, 0.0), 0.002, 0.998));

    vec4 blurred = mix(advected, (n + s + e + w) * 0.25, clamp(uDt * 4.5, 0.0, 0.65));

    vec2 bVel = (blurred.rg - 0.5) * 2.0;
    float energy = blurred.b;
    float ripple = blurred.a;

    float curlAngle = (e.b - w.b - n.b + s.b) * uDt * 2.8;
    float ca = cos(curlAngle);
    float sa = sin(curlAngle);
    bVel = vec2(bVel.x * ca - bVel.y * sa, bVel.x * sa + bVel.y * ca);

    bVel *= exp(-uDt * 0.85);
    energy *= exp(-uDt * 0.65);
    ripple *= exp(-uDt * 1.15);

    if (uSplatActive > 0.5) {
      injectSplat(uSplatUv, uSplatVel, uSplatRadiusUv, uSplatEnergy, bVel, energy, ripple);
    }
    if (uSplat2Active > 0.5) {
      injectSplat(uSplat2Uv, uSplat2Vel, uSplat2RadiusUv, uSplat2Energy, bVel, energy, ripple);
    }

    gl_FragColor = vec4(bVel * 0.5 + 0.5, energy, ripple);
  }
`;

export interface WakeSplatInput {
  worldPos: THREE.Vector3;
  velocity: THREE.Vector3;
  radiusWorld: number;
  force: number;
  active: boolean;
}

/**
 * Dual-splat GPU Ping-Pong FBO simulation covering the 70x70 world XZ footprint.
 */
export class FluidWakeSimulation {
  private targetA: THREE.WebGLRenderTarget;
  private targetB: THREE.WebGLRenderTarget;
  private readTarget: THREE.WebGLRenderTarget;
  private writeTarget: THREE.WebGLRenderTarget;

  private simScene: THREE.Scene;
  private simCamera: THREE.OrthographicCamera;
  private simQuad: THREE.Mesh;
  private simMaterial: THREE.ShaderMaterial;
  private clearMaterial: THREE.ShaderMaterial;

  private readonly worldSize = 70.0;

  constructor(renderer: THREE.WebGLRenderer, isSoftwareGl: boolean) {
    const resolution = isSoftwareGl ? 128 : 256;
    const gl = renderer.getContext();
    const supportsHalfFloat =
      renderer.capabilities.isWebGL2 &&
      (Boolean(gl.getExtension('EXT_color_buffer_half_float')) ||
        Boolean(gl.getExtension('EXT_color_buffer_float')));

    const targetOptions: THREE.RenderTargetOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      format: THREE.RGBAFormat,
      type: supportsHalfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
    };

    this.targetA = new THREE.WebGLRenderTarget(resolution, resolution, targetOptions);
    this.targetB = new THREE.WebGLRenderTarget(resolution, resolution, targetOptions);
    this.readTarget = this.targetA;
    this.writeTarget = this.targetB;

    this.simScene = new THREE.Scene();
    this.simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.clearMaterial = new THREE.ShaderMaterial({
      vertexShader: SIM_VERTEX,
      fragmentShader: CLEAR_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });

    this.simMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uPrevTex: { value: this.readTarget.texture },
        uTexelSize: { value: new THREE.Vector2(1 / resolution, 1 / resolution) },
        uDt: { value: 0.016 },
        uModeId: { value: 3.0 },
        uSplatUv: { value: new THREE.Vector2(0.5, 0.5) },
        uSplatVel: { value: new THREE.Vector2(0.0, 0.0) },
        uSplatRadiusUv: { value: 0.08 },
        uSplatEnergy: { value: 0.0 },
        uSplatActive: { value: 0.0 },
        uSplat2Uv: { value: new THREE.Vector2(0.5, 0.5) },
        uSplat2Vel: { value: new THREE.Vector2(0.0, 0.0) },
        uSplat2RadiusUv: { value: 0.08 },
        uSplat2Energy: { value: 0.0 },
        uSplat2Active: { value: 0.0 },
      },
      vertexShader: SIM_VERTEX,
      fragmentShader: SIM_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });

    const plane = new THREE.PlaneGeometry(2, 2);
    this.simQuad = new THREE.Mesh(plane, this.clearMaterial);
    this.simScene.add(this.simQuad);

    this.clear(renderer);
  }

  public get texture(): THREE.Texture {
    return this.readTarget.texture;
  }

  public clear(renderer: THREE.WebGLRenderer): void {
    const prevTarget = renderer.getRenderTarget();
    const prevXr = renderer.xr.enabled;
    renderer.xr.enabled = false;

    this.simQuad.material = this.clearMaterial;

    renderer.setRenderTarget(this.targetA);
    renderer.render(this.simScene, this.simCamera);

    renderer.setRenderTarget(this.targetB);
    renderer.render(this.simScene, this.simCamera);

    renderer.setRenderTarget(prevTarget);
    renderer.xr.enabled = prevXr;
    this.simQuad.material = this.simMaterial;
  }

  public step(
    renderer: THREE.WebGLRenderer,
    dt: number,
    modeId: number,
    splatA: WakeSplatInput,
    splatB?: WakeSplatInput,
  ): void {
    const clampedDt = Math.min(Math.max(dt, 0.001), 0.05);
    const uniforms = this.simMaterial.uniforms;
    uniforms.uPrevTex.value = this.readTarget.texture;
    uniforms.uDt.value = clampedDt;
    uniforms.uModeId.value = modeId;

    this.assignSplat(splatA, 'uSplat');
    if (splatB) {
      this.assignSplat(splatB, 'uSplat2');
    } else {
      uniforms.uSplat2Active.value = 0.0;
    }

    const prevTarget = renderer.getRenderTarget();
    const prevXr = renderer.xr.enabled;
    renderer.xr.enabled = false;

    this.simQuad.material = this.simMaterial;
    renderer.setRenderTarget(this.writeTarget);
    renderer.render(this.simScene, this.simCamera);
    renderer.setRenderTarget(prevTarget);
    renderer.xr.enabled = prevXr;

    const temp = this.readTarget;
    this.readTarget = this.writeTarget;
    this.writeTarget = temp;
  }

  private assignSplat(splat: WakeSplatInput, prefix: 'uSplat' | 'uSplat2'): void {
    const uniforms = this.simMaterial.uniforms;
    const u = splat.worldPos.x / this.worldSize + 0.5;
    const v = splat.worldPos.z / this.worldSize + 0.5;
    (uniforms[`${prefix}Uv`].value as THREE.Vector2).set(u, v);

    const vx = THREE.MathUtils.clamp(splat.velocity.x / 22.0, -1.0, 1.0);
    const vz = THREE.MathUtils.clamp(splat.velocity.z / 22.0, -1.0, 1.0);
    (uniforms[`${prefix}Vel`].value as THREE.Vector2).set(vx, vz);

    uniforms[`${prefix}RadiusUv`].value = THREE.MathUtils.clamp(
      splat.radiusWorld / this.worldSize,
      0.02,
      0.35,
    );
    const velMag = Math.hypot(splat.velocity.x, splat.velocity.z);
    uniforms[`${prefix}Energy`].value = THREE.MathUtils.clamp(
      Math.abs(splat.force) * 0.4 + velMag * 0.04,
      0.15,
      1.5,
    );
    uniforms[`${prefix}Active`].value =
      splat.active && u >= -0.1 && u <= 1.1 && v >= -0.1 && v <= 1.1 ? 1.0 : 0.0;
  }

  public dispose(): void {
    this.targetA.dispose();
    this.targetB.dispose();
    this.simQuad.geometry.dispose();
    this.simMaterial.dispose();
    this.clearMaterial.dispose();
  }
}
