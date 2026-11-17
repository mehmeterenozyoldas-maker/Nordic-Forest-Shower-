export type DeviceTier = 'quest' | 'desktop' | 'software';

export interface QualityProfile {
  tier: DeviceTier;
  isSoftwareGl: boolean;
  isQuestOrMobile: boolean;
  maxParticles: number;
  terrainParticles: number;
  treeDensity: number;
  treeDepth: number;
  pointScale: number;
  vrPointScale: number;
  maxPointSize: number;
  ambientVfxCount: number;
  burstCapacity: number;
  fboResolution: number;
  useComposer: boolean;
  maxPixelRatio: number;
  xrFramebufferScaleFactor: number;
  xrFoveation: number;
  audioPanningModel: 'HRTF' | 'equalpower';
}

export function detectSoftwareWebGL(): boolean {
  try {
    const probeCanvas = document.createElement('canvas');
    const gl = probeCanvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

export function detectQuestOrMobileGpu(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/OculusBrowser|Quest|Meta Quest|Pico|Android|iPhone|iPad|Mobile/i.test(ua)) {
    return true;
  }
  try {
    const probeCanvas = document.createElement('canvas');
    const gl = probeCanvas.getContext('webgl2');
    if (!gl) return false;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /Adreno|Mali|PowerVR|Apple GPU/i.test(gpu);
  } catch {
    return false;
  }
}

export function buildQualityProfile(): QualityProfile {
  const isSoftwareGl = detectSoftwareWebGL();
  if (isSoftwareGl) {
    return {
      tier: 'software',
      isSoftwareGl: true,
      isQuestOrMobile: false,
      maxParticles: 180_000,
      terrainParticles: 70_000,
      treeDensity: 16,
      treeDepth: 4,
      pointScale: 1.45,
      vrPointScale: 1.45,
      maxPointSize: 22.0,
      ambientVfxCount: 1_000,
      burstCapacity: 600,
      fboResolution: 128,
      useComposer: false,
      maxPixelRatio: 1,
      xrFramebufferScaleFactor: 0.75,
      xrFoveation: 1.0,
      audioPanningModel: 'equalpower',
    };
  }

  const isQuestOrMobile = detectQuestOrMobileGpu();
  if (isQuestOrMobile) {
    return {
      tier: 'quest',
      isSoftwareGl: false,
      isQuestOrMobile: true,
      maxParticles: 240_000,
      terrainParticles: 88_000,
      treeDensity: 20,
      treeDepth: 5,
      pointScale: 1.38,
      vrPointScale: 1.48,
      maxPointSize: 22.0,
      ambientVfxCount: 1_500,
      burstCapacity: 900,
      fboResolution: 128,
      useComposer: false,
      maxPixelRatio: 1.25,
      xrFramebufferScaleFactor: 0.78,
      xrFoveation: 1.0,
      audioPanningModel: 'equalpower',
    };
  }

  return {
    tier: 'desktop',
    isSoftwareGl: false,
    isQuestOrMobile: false,
    maxParticles: 680_000,
    terrainParticles: 220_000,
    treeDensity: 30,
    treeDepth: 5,
    pointScale: 1.12,
    vrPointScale: 1.45,
    maxPointSize: 32.0,
    ambientVfxCount: 3_200,
    burstCapacity: 1_800,
    fboResolution: 256,
    useComposer: true,
    maxPixelRatio: 1.75,
    xrFramebufferScaleFactor: 0.85,
    xrFoveation: 0.8,
    audioPanningModel: 'HRTF',
  };
}
