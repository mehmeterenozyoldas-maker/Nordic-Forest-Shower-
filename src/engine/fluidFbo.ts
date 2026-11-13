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
  uniform vec2 uSplatUv;
  uniform vec2 uSplatVel;
  uniform float uSplatRadiusUv;
  uniform float uSplatEnergy;
  uniform float uSplatActive;
  uniform float uModeId;

  varying vec2 vUv;

  void main() {
    vec4 center = texture2D(uPrevTex, vUv);
    vec2 vel = (center.rg - 0.5) * 2.0;

    // Semi-Lagrangian self-advection along stored wake velocity
    vec2 advUv = clamp(vUv - vel * uDt * 0.16, vec2(0.002), vec2(0.998));
    vec4 advected = texture2D(uPrevTex, advUv);

    // 4-neighbor Laplacian diffusion for smooth vortex spread
    vec4 n = texture2D(uPrevTex, clamp(advUv + vec2(0.0, uTexelSize.y), 0.002, 0.998));
    vec4 s = texture2D(uPrevTex, clamp(advUv - vec2(0.0, uTexelSize.y), 0.002, 0.998));
    vec4 e = texture2D(uPrevTex, clamp(advUv + vec2(uTexelSize.x, 0.0), 0.002, 0.998));
    vec4 w = texture2D(uPrevTex, clamp(advUv - vec2(uTexelSize.x, 0.0), 0.002, 0.998));

    vec4 blurred = mix(advected, (n + s + e + w) * 0.25, clamp(uDt * 4.5, 0.0, 0.65));

    vec2 bVel = (blurred.rg - 0.5) * 2.0;
    float energy = blurred.b;
    float ripple = blurred.a;

    // Slight vorticity curl rotation so wakes curve organically
    float curlAngle = (e.b - w.b - n.b + s.b) * uDt * 2.8;
    float ca = cos(curlAngle);
    float sa = sin(curlAngle);
    bVel = vec2(bVel.x * ca - bVel.y * sa, bVel.x * sa + bVel.y * ca);

    // Exponential dissipation
    float velDecay = exp(-uDt * 0.85);
    float energyDecay = exp(-uDt * 0.65);
    float rippleDecay = exp(-uDt * 1.15);

    bVel *= velDecay;
    energy *= energyDecay;
    ripple *= rippleDecay;

    // Inject cursor / hand / sensor splat
    if (uSplatActive > 0.5) {
      vec2 diff = vUv - uSplatUv;
      float d = length(diff);
      float r = max(0.015, uSplatRadiusUv);
      float splat = exp(-(d * d) / (r * r));

      vec2 radialDir = d > 0.0001 ? normalize(diff) : vec2(0.0);
      vec2 tangentDir = vec2(-radialDir.y, radialDir.x);

      vec2 injectVel = uSplatVel;
      // Add subtle swirl in Tornado or Fluid modes
      if (abs(uModeId - 1.0) < 0.25) {
        injectVel += tangentDir * 0.85;
      } else if (abs(uModeId - 2.0) < 0.25) {
        injectVel += radialDir * 0.7;
      } else if (abs(uModeId - 3.0) < 0.25) {
        injectVel += tangentDir * 0.35;
      }

      bVel = clamp(bVel + injectVel * splat * min(uDt * 12.0, 0.65), vec2(-1.0), vec2(1.0));
      energy = clamp(energy + splat * clamp(uSplatEnergy, 0.15, 1.5) * min(uDt * 5.0, 0.55), 0.0, 1.0);

      // Ring wave injection for Seismic / Fluid
      float ring = exp(-pow((d - r * 0.65) / (r * 0.35), 2.0));
      ripple = clamp(ripple + ring * clamp(uSplatEnergy, 0.2, 1.2) * min(uDt * 4.5, 0.5), 0.0, 1.0);
    }

    gl_FragColor = vec4(bVel * 0.5 + 0.5, energy, ripple);
  }
`;

/**
 * GPU Ping-Pong FBO simulation covering the 70x70 world XZ footprint.
 * Stores persistent velocity (R, G), wake energy (B), and wave ripple (A).
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
        uSplatUv: { value: new THREE.Vector2(0.5, 0.5) },
        uSplatVel: { value: new THREE.Vector2(0.0, 0.0) },
        uSplatRadiusUv: { value: 0.08 },
        uSplatEnergy: { value: 0.0 },
        uSplatActive: { value: 0.0 },
        uModeId: { value: 3.0 },
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
    this.simQuad.material = this.clearMaterial;

    renderer.setRenderTarget(this.targetA);
    renderer.render(this.simScene, this.simCamera);

    renderer.setRenderTarget(this.targetB);
    renderer.render(this.simScene, this.simCamera);

    renderer.setRenderTarget(prevTarget);
    this.simQuad.material = this.simMaterial;
  }

  public step(
    renderer: THREE.WebGLRenderer,
    dt: number,
    worldPos: THREE.Vector3,
    velocity: THREE.Vector3,
    radiusWorld: number,
    force: number,
    modeId: number,
    active: boolean,
  ): void {
    const clampedDt = Math.min(Math.max(dt, 0.001), 0.05);
    const u = worldPos.x / this.worldSize + 0.5;
    const v = worldPos.z / this.worldSize + 0.5;

    const uniforms = this.simMaterial.uniforms;
    uniforms.uPrevTex.value = this.readTarget.texture;
    uniforms.uDt.value = clampedDt;
    uniforms.uSplatUv.value.set(u, v);

    // Normalize velocity into [-1, 1] range for stable advection
    const vx = THREE.MathUtils.clamp(velocity.x / 22.0, -1.0, 1.0);
    const vz = THREE.MathUtils.clamp(velocity.z / 22.0, -1.0, 1.0);
    uniforms.uSplatVel.value.set(vx, vz);

    uniforms.uSplatRadiusUv.value = THREE.MathUtils.clamp(radiusWorld / this.worldSize, 0.02, 0.35);
    const velMag = Math.hypot(velocity.x, velocity.z);
    const energy = THREE.MathUtils.clamp(Math.abs(force) * 0.4 + velMag * 0.04, 0.15, 1.5);
    uniforms.uSplatEnergy.value = energy;
    uniforms.uSplatActive.value = active && u >= -0.1 && u <= 1.1 && v >= -0.1 && v <= 1.1 ? 1.0 : 0.0;
    uniforms.uModeId.value = modeId;

    const prevTarget = renderer.getRenderTarget();
    this.simQuad.material = this.simMaterial;
    renderer.setRenderTarget(this.writeTarget);
    renderer.render(this.simScene, this.simCamera);
    renderer.setRenderTarget(prevTarget);

    // Swap ping-pong buffers
    const temp = this.readTarget;
    this.readTarget = this.writeTarget;
    this.writeTarget = temp;
  }

  public dispose(): void {
    this.targetA.dispose();
    this.targetB.dispose();
    this.simQuad.geometry.dispose();
    this.simMaterial.dispose();
    this.clearMaterial.dispose();
  }
}
