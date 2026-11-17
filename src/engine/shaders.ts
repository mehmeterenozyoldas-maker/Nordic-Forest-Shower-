import * as THREE from 'three';

export const FOREST_VERTEX_SHADER = /* glsl */ `
  attribute vec3 color;
  attribute float type; // 0 = wood, 1 = leaf, 2 = ground, 3 = water
  attribute float aBirthTime;
  attribute float aHint;

  uniform float uTime;
  uniform vec3 uMouse;
  uniform float uRadius;
  uniform float uForce;
  uniform vec3 uMouseVelocity;

  uniform vec3 uMouse2;
  uniform float uForce2;
  uniform vec3 uMouseVelocity2;
  uniform float uActive2;

  uniform float uInteractionType;
  uniform float uInteractionContext;
  uniform vec3 uWindDir;
  uniform float uWindStrength;
  uniform sampler2D uWakeTex;
  uniform vec3 uSeasonWeights; // (autumn, spring, winter)
  uniform float uPointScale;
  uniform float uMaxPointSize;

  varying float vDisplacement;
  varying vec3 vPosition;
  varying vec3 vColor;
  varying float vType;
  varying float vRustle;
  varying float vAurora;
  varying float vSapGlow;
  varying float vBirthSpark;
  varying float vHint;
  varying vec3 vWorldNormal;
  varying vec3 vVelocity;

  float fastNoise(vec3 p) {
    return sin(p.x * 1.15 + sin(p.z * 0.93 + p.y * 0.67)) *
           cos(p.y * 1.07 + cos(p.x * 0.79 - p.z * 1.11));
  }

  vec3 fastTurbulence(vec3 p) {
    return vec3(
      sin(p.y * 1.7 + p.z * 1.3),
      sin(p.z * 1.9 + p.x * 1.1 + 1.57),
      sin(p.x * 1.5 + p.y * 1.4 + 3.14)
    ) * 0.68 + vec3(
      cos(p.z * 2.9 - p.x * 2.1),
      cos(p.x * 2.7 - p.y * 2.3),
      cos(p.y * 3.1 - p.z * 1.9)
    ) * 0.32;
  }

  mat2 rotate2d(float _angle) {
    float c = cos(_angle);
    float s = sin(_angle);
    return mat2(c, -s, s, c);
  }

  void applyCursorForce(
    vec3 cursorPos,
    float cursorForce,
    vec3 cursorVel,
    float contextMask,
    float scatterMult,
    inout vec4 worldPosition,
    inout vec3 displacement,
    inout float auroraOut,
    inout float maxInfluence
  ) {
    if (contextMask < 0.5 || cursorPos.x > 800.0) return;

    vec3 toCursor = worldPosition.xyz - cursorPos;
    float distSq = dot(toCursor, toCursor);
    float maxRange = uInteractionType >= 3.5 ? uRadius * 2.25 : uRadius;
    if (distSq > maxRange * maxRange) return;

    float dist = sqrt(distSq);
    float influence = 1.0 - smoothstep(0.0, uRadius, dist);
    maxInfluence = max(maxInfluence, influence);

    vec3 dir = dist > 0.001 ? (toCursor / dist) : vec3(0.0, 1.0, 0.0);
    dir = normalize(dir + vec3(0.0, 0.2, 0.0));
    float noiseAmp = (cursorForce > 0.0) ? 1.0 : 0.2;
    vec3 noiseVec = fastTurbulence(position * 1.2 + uTime * 0.5);

    if (uInteractionType < 0.5) {
      vec3 gustDir = vec3(1.0, 0.2, 0.5);
      vec3 d = (gustDir * cursorForce + noiseVec * noiseAmp) * influence * scatterMult;
      worldPosition.xyz += d;
      displacement += d;
    } else if (uInteractionType < 1.5) {
      float angle = influence * uTime * 15.0;
      vec2 rotatedXZ = rotate2d(angle) * toCursor.xz;
      worldPosition.x = cursorPos.x + rotatedXZ.x;
      worldPosition.z = cursorPos.z + rotatedXZ.y;
      vec3 newDir = normalize(worldPosition.xyz - cursorPos + vec3(0.0001));
      vec3 d = (newDir * cursorForce * 0.5 + noiseVec * noiseAmp + vec3(0.0, 2.0, 0.0)) * influence * scatterMult;
      worldPosition.xyz += d;
      displacement += d;
    } else if (uInteractionType < 2.5) {
      vec3 d = vec3(dir.x, 0.0, dir.z) * abs(cursorForce) * 2.0 * influence * scatterMult + noiseVec * noiseAmp * influence;
      worldPosition.xyz += d;
      displacement += d;
    } else if (uInteractionType < 3.5) {
      float mouseSpeed = clamp(length(cursorVel), 0.0, 20.0);
      vec3 mouseDir = mouseSpeed > 0.01 ? (cursorVel / mouseSpeed) : dir;
      vec3 advection = mouseDir * mouseSpeed * influence * 0.3;

      vec3 toParticle = dist > 0.001 ? (toCursor / dist) : vec3(0.0, 1.0, 0.0);
      vec3 vortexAxis = cross(mouseDir, toParticle);
      if (dot(vortexAxis, vortexAxis) < 0.0001) vortexAxis = vec3(0.0, 1.0, 0.0);
      vec3 curl = normalize(cross(vortexAxis, toParticle)) * fastNoise(position * 2.0 + uTime * 2.0) * abs(cursorForce);

      if (type > 2.5) {
        advection.y += mouseSpeed * influence * 0.5 * sign(cursorForce);
        curl *= 0.5;
      } else if (type > 0.5 && type < 1.5) {
        curl *= 2.0;
      } else if (type > 1.5 && type < 2.5) {
        advection = vec3(0.0, cursorForce * influence * 2.0, 0.0);
        curl = vec3(0.0);
      }

      vec3 d = (advection + curl * 2.0 + noiseVec * noiseAmp) * influence * scatterMult;
      worldPosition.xyz += d;
      displacement += d;
    } else if (uInteractionType < 4.5) {
      float wave = sin(dist * 3.0 - uTime * 15.0) * exp(-dist * 0.3);
      vec3 d = vec3(0.0, 1.0, 0.0) * wave * abs(cursorForce) * 8.0 * scatterMult;
      d += dir * wave * cursorForce * 2.0 * scatterMult;
      worldPosition.xyz += d;
      displacement += d;
    } else {
      float lift = smoothstep(uRadius * 1.5, 0.0, dist) * abs(cursorForce) * 8.0;
      vec3 magneticUp = vec3(0.0, 1.0, 0.0) * lift;
      vec3 swirlDir = cross(dir, vec3(0.0, 1.0, 0.0));
      if (dot(swirlDir, swirlDir) < 0.0001) swirlDir = vec3(1.0, 0.0, 0.0);
      vec3 d = (magneticUp + normalize(swirlDir) * lift * 0.8 + noiseVec * lift * 0.3) * scatterMult;
      worldPosition.xyz += d;
      displacement += d;
      auroraOut = max(auroraOut, influence * smoothstep(0.0, 15.0, d.y));
    }
  }

  void main() {
    vPosition = position;
    vColor = color;
    vType = type;
    vHint = aHint;

    vec4 worldPosition = modelMatrix * vec4(position, 1.0);

    // Planted Tree Spring Pop-In Growth Animation
    float birthScale = 1.0;
    float birthSpark = 0.0;
    if (aBirthTime >= 0.0) {
      float age = max(0.0, uTime - aBirthTime);
      float t = clamp(age / 0.85, 0.0, 1.0);
      float invT = 1.0 - t;
      float ease = 1.0 - invT * invT * invT;
      birthScale = mix(0.05, 1.0, ease);
      worldPosition.y -= (1.0 - ease) * 2.6;
      birthSpark = invT * step(age, 0.9);
    }
    vBirthSpark = birthSpark;

    // Lightweight Analytical Wind & Ambient Motion
    float windSpeed = uTime * 0.5;
    float windStrength = 0.0;
    float rustle = 0.0;

    if (type < 1.5) {
      vec3 windPos = position * 0.09 + uWindDir * uTime * 1.4;
      float windNoise = fastNoise(windPos) * 0.5 + 0.5;
      float gust = sin(windPos.x * 0.35 + windPos.z * 0.35 + uTime * 0.8) * 0.5 + 0.5;
      vec3 windForce = uWindDir * (windNoise + gust * 1.6) * uWindStrength;

      if (type > 0.5) { // Leaf
        rustle = sin(position.x * 4.0 + position.y * 3.5 + uTime * 3.2) * cos(position.z * 4.0 - uTime * 2.6);
        worldPosition.x += rustle * 0.075;
        worldPosition.y += rustle * 0.045;
        worldPosition.z += rustle * 0.075;
        windStrength = 0.8;
      } else { // Wood
        windStrength = 0.15;
      }

      float heightFactor = smoothstep(-5.0, 15.0, position.y);
      worldPosition.xyz += windForce * heightFactor * windStrength * 2.0;

      vec3 perpWind = vec3(-uWindDir.z, 0.0, uWindDir.x);
      float sway = sin(position.y * 0.16 + windSpeed * 2.0) * heightFactor * uWindStrength;
      worldPosition.xyz += perpWind * sway * 0.85;
    } else if (type > 2.5) { // Water
      float ripple = sin(position.x * 2.6 + uTime * 1.9) * cos(position.z * 2.6 + uTime * 1.5);
      worldPosition.y += ripple * 0.09;
      worldPosition.x += sin(position.z * 1.4 + uTime) * 0.04;
    }
    vRustle = rustle;

    // Context Masking
    bool canInteract = true;
    if (uInteractionContext == 1.0 && type > 1.5) canInteract = false;
    if (uInteractionContext == 2.0 && type != 3.0) canInteract = false;
    if (uInteractionContext == 3.0 && type != 2.0) canInteract = false;
    float contextMask = canInteract ? 1.0 : 0.0;

    float scatterMult = 1.5;
    if (type > 0.5 && type < 1.5) scatterMult = 3.0;
    else if (type > 2.5) scatterMult = 2.0;
    else if (type > 1.5) scatterMult = 0.5;
    else scatterMult = 0.2;

    vec3 displacement = vec3(0.0);
    float auroraVal = 0.0;
    float maxInfluence = 0.0;

    // Primary Cursor / Hand / Controller
    applyCursorForce(
      uMouse,
      uForce,
      uMouseVelocity,
      contextMask,
      scatterMult,
      worldPosition,
      displacement,
      auroraVal,
      maxInfluence
    );

    // Secondary Hand / VR Controller
    if (uActive2 > 0.5) {
      applyCursorForce(
        uMouse2,
        uForce2,
        uMouseVelocity2,
        contextMask,
        scatterMult,
        worldPosition,
        displacement,
        auroraVal,
        maxInfluence
      );
    }

    // Persistent GPU Ping-Pong Wake Field Coupling
    vec2 wakeUv = clamp((worldPosition.xz / 70.0) + 0.5, vec2(0.002), vec2(0.998));
    vec4 wake = texture2D(uWakeTex, wakeUv);
    float wakeEnergy = wake.b * contextMask;

    if (wakeEnergy > 0.015) {
      vec2 wakeVel = (wake.rg - 0.5) * 2.0;
      float wavePhase = sin(wake.a * 14.0 - uTime * 5.0);
      vec3 wakeDisp = vec3(wakeVel.x * 4.2, wavePhase * 1.15 * wakeEnergy, wakeVel.y * 4.2) * wakeEnergy * (0.4 + scatterMult * 0.45);
      if (type < 0.5) wakeDisp *= 0.2;
      if (type > 1.5 && type < 2.5 && uInteractionType != 4.0) wakeDisp.xz *= 0.25;
      if (uInteractionType > 4.5) {
        wakeDisp.y += wakeEnergy * 4.5 * scatterMult * 0.35;
        auroraVal = max(auroraVal, wakeEnergy * 0.85);
      }
      worldPosition.xyz += wakeDisp;
      displacement += wakeDisp;
    }

    // Glowing Tree-Sap Veins
    float sapPulse = 0.0;
    if (type < 0.5) {
      float veinNoise = sin(position.y * 2.8 - uTime * 3.4 + position.x * 1.7 + aHint * 6.28);
      float activity = clamp(wakeEnergy * 1.4 + maxInfluence * 1.1 + uSeasonWeights.z * 0.35, 0.0, 1.0);
      sapPulse = smoothstep(0.65, 0.98, veinNoise) * activity;
    }
    vSapGlow = sapPulse;

    vAurora = auroraVal;
    vDisplacement = length(displacement);
    vVelocity = displacement;

    if (type > 1.5) {
      vWorldNormal = vec3(0.0, 1.0, 0.0);
    } else if (type > 0.5) {
      vWorldNormal = normalize(worldPosition.xyz + vec3(0.0, 5.0, 0.0));
    } else {
      vWorldNormal = normalize(vec3(worldPosition.x, 0.0, worldPosition.z) + vec3(0.0001));
    }

    vec4 mvPosition = viewMatrix * worldPosition;
    gl_Position = projectionMatrix * mvPosition;

    float baseSize = 2.2;
    if (type > 0.5 && type < 1.5) baseSize = 5.8 + rustle * 0.9;
    else if (type > 2.5) baseSize = 3.9;
    else if (type > 1.5) baseSize = 3.1;
    else baseSize = 3.9 + sapPulse * 1.4;

    float ptSize =
      (baseSize + maxInfluence * 1.8 + wakeEnergy * 1.4 + birthSpark * 2.8) *
      birthScale *
      uPointScale *
      (20.0 / max(1.0, -mvPosition.z));

    gl_PointSize = clamp(ptSize, 1.2, uMaxPointSize);
  }
`;

export const FOREST_FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;

  uniform highp float uTime;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform float uFogDensity;
  uniform highp vec3 uSeasonWeights; // (autumn, spring, winter)

  varying float vDisplacement;
  varying highp vec3 vPosition;
  varying vec3 vColor;
  varying float vType;
  varying float vRustle;
  varying float vAurora;
  varying float vSapGlow;
  varying float vBirthSpark;
  varying float vHint;
  varying vec3 vWorldNormal;
  varying vec3 vVelocity;

  void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = vType > 0.5 && vType < 1.5
      ? length(coord * vec2(1.0, 1.45))
      : length(coord);

    float cutoff = (vType > 0.5 && vType < 1.5) ? 0.46 : 0.5;
    if (dist > cutoff) discard;

    // GPU Seasonal Palette Morphing
    vec3 finalBaseColor = vColor;
    if (vType > 0.5 && vType < 1.5) {
      vec3 springLeaf = mix(vec3(0.20, 0.42, 0.14), vec3(0.62, 0.74, 0.48), vHint);
      if (vHint > 0.84) {
        springLeaf = mix(springLeaf, vec3(0.88, 0.91, 0.84), 0.72);
      }
      vec3 winterLeaf = mix(vec3(0.14, 0.24, 0.27), vec3(0.82, 0.90, 0.98), smoothstep(0.45, 0.9, vHint));
      finalBaseColor =
        vColor * uSeasonWeights.x +
        springLeaf * uSeasonWeights.y +
        winterLeaf * uSeasonWeights.z;
    } else if (vType > 1.5 && vType < 2.5) {
      vec3 springGround = mix(vColor, vec3(0.18, 0.34, 0.19), 0.55 * vHint);
      vec3 winterGround = mix(vec3(0.22, 0.26, 0.32), vec3(0.86, 0.92, 0.99), smoothstep(0.35, 0.85, vHint));
      finalBaseColor =
        vColor * uSeasonWeights.x +
        springGround * uSeasonWeights.y +
        winterGround * uSeasonWeights.z;
    } else if (vType > 2.5) {
      vec3 springWater = mix(vColor, vec3(0.08, 0.34, 0.44), 0.45);
      vec3 winterWater = mix(vColor, vec3(0.22, 0.38, 0.52), 0.65);
      finalBaseColor =
        vColor * uSeasonWeights.x +
        springWater * uSeasonWeights.y +
        winterWater * uSeasonWeights.z;
    }

    // Mie Scattering Approximation
    vec3 viewDir = normalize(vPosition - cameraPosition);
    float VoL = max(0.0, dot(viewDir, uSunDirection));
    float VoL4 = VoL * VoL * VoL * VoL;
    float VoL8 = VoL4 * VoL4;
    float scattering = VoL8 * 0.5 + VoL8 * VoL8 * 1.4;
    vec3 scatterColor = uSunColor * scattering;

    float alphaMult = 1.0;
    float light = max(0.0, dot(vWorldNormal, uSunDirection));

    if (vType > 0.5 && vType < 1.5) { // Leaf
      alphaMult = 0.9;
      vec3 sssColor = mix(vec3(0.8, 0.9, 0.3), vec3(0.65, 0.9, 1.0), uSeasonWeights.z);
      float sssIntensity = smoothstep(0.0, 1.0, vRustle) * 0.3 + (1.0 - smoothstep(0.0, 0.45, dist)) * 0.15;
      finalBaseColor = mix(finalBaseColor, sssColor, sssIntensity);
      finalBaseColor *= 0.6 + 0.6 * light;
      finalBaseColor += scatterColor * 0.3;
    } else if (vType > 2.5) { // Water
      alphaMult = 0.86;
      float sparkle = smoothstep(0.8, 1.0, sin(vPosition.x * 20.0 + uTime * 2.0) * cos(vPosition.z * 20.0 + uTime * 1.5));
      finalBaseColor += vec3(sparkle * 0.6);
      finalBaseColor *= 0.5 + 0.7 * light;
      vec3 halfVector = normalize(uSunDirection + viewDir);
      float spec = max(0.0, dot(vWorldNormal, halfVector));
      float spec2 = spec * spec;
      float spec8 = spec2 * spec2 * spec2 * spec2;
      finalBaseColor += uSunColor * (spec8 * spec8) * 0.5;
    } else { // Wood & Ground
      finalBaseColor *= 0.5 + 0.5 * light;
    }

    if (vSapGlow > 0.01) {
      vec3 sapColor = mix(vec3(0.25, 0.95, 0.78), vec3(0.95, 0.72, 0.28), uSeasonWeights.x);
      finalBaseColor += sapColor * vSapGlow * 1.55;
    }

    if (vBirthSpark > 0.01) {
      finalBaseColor += vec3(0.55, 0.98, 0.78) * vBirthSpark * 1.4;
    }

    float alpha = smoothstep(0.5, 0.1, dist) * alphaMult;

    float d = clamp(vDisplacement * 0.1, 0.0, 1.0);
    vec3 dustColor = vec3(0.6, 0.55, 0.45);
    if (vType > 0.5 && vType < 1.5) dustColor = mix(vec3(0.4, 0.5, 0.2), vec3(0.75, 0.88, 1.0), uSeasonWeights.z);
    if (vType > 2.5) dustColor = vec3(0.8, 0.9, 1.0);

    vec3 finalColor = mix(finalBaseColor, dustColor, d * 0.5);

    // Height mist + exponential fog
    float depth = gl_FragCoord.z / gl_FragCoord.w;
    float fogFactor = clamp(exp2(-uFogDensity * uFogDensity * depth * depth * 1.442695), 0.0, 1.0);

    float heightFog = 1.0 - smoothstep(-4.0, 8.0, vPosition.y);
    vec3 mistColor = mix(vec3(0.08, 0.09, 0.14), vec3(0.11, 0.15, 0.22), uSeasonWeights.z);
    vec3 finalFogColor = mistColor * (heightFog * 0.6) + scatterColor * 0.8;

    if (vAurora > 0.0) {
      vec3 auroraGreen = vec3(0.2, 1.0, 0.6);
      vec3 auroraTeal = vec3(0.15, 0.85, 0.95);
      vec3 auroraPurple = vec3(0.72, 0.32, 1.0);
      float ribbonWave = sin(vPosition.x * 0.18 + vPosition.z * 0.12 + uTime * 0.7) * 0.5 + 0.5;
      vec3 aColor = mix(mix(auroraGreen, auroraTeal, 0.4), auroraPurple, ribbonWave);
      finalColor = mix(finalColor, aColor, vAurora);
      alpha = min(1.0, alpha + vAurora * 0.65);
      finalColor += aColor * vAurora * 1.8;
    }

    float speed = length(vVelocity);
    if (speed > 0.05) {
      float speedNorm = clamp((speed - 0.05) * 0.2, 0.0, 1.0);
      vec3 vfcSlow = vec3(0.0, 0.8, 1.0);
      vec3 vfcFast = vec3(1.0, 0.2, 0.6);
      vec3 vfcSuperFast = vec3(1.0, 0.6, 0.0);

      vec3 vfcColor = mix(vfcSlow, vfcFast, smoothstep(0.0, 0.5, speedNorm));
      vfcColor = mix(vfcColor, vfcSuperFast, smoothstep(0.5, 1.0, speedNorm));

      finalColor = mix(finalColor, vfcColor, speedNorm * 0.85);
      finalColor += vfcColor * speedNorm * 1.3;
      alpha = min(1.0, alpha + speedNorm * 0.4);
    }

    gl_FragColor = vec4(mix(finalFogColor, finalColor + scatterColor * 0.3, fogFactor), alpha);
  }
`;

export function createForestMaterial(
  wakeTexture: THREE.Texture,
  pointScale = 1.0,
  maxPointSize = 32.0,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: FOREST_VERTEX_SHADER,
    fragmentShader: FOREST_FRAGMENT_SHADER,
    uniforms: {
      uTime: { value: 0 },
      uMouse: { value: new THREE.Vector3(999, 999, 999) },
      uRadius: { value: 5.0 },
      uForce: { value: 0.0 },
      uMouseVelocity: { value: new THREE.Vector3(0, 0, 0) },
      uMouse2: { value: new THREE.Vector3(999, 999, 999) },
      uForce2: { value: 0.0 },
      uMouseVelocity2: { value: new THREE.Vector3(0, 0, 0) },
      uActive2: { value: 0.0 },
      uInteractionType: { value: 0.0 },
      uInteractionContext: { value: 0.0 },
      uWindDir: { value: new THREE.Vector3(1.0, 0.0, 0.0) },
      uWindStrength: { value: 1.0 },
      uSunDirection: { value: new THREE.Vector3(1.0, 0.5, -1.0).normalize() },
      uSunColor: { value: new THREE.Color(1.0, 0.9, 0.8) },
      uFogDensity: { value: 0.018 },
      uWakeTex: { value: wakeTexture },
      uSeasonWeights: { value: new THREE.Vector3(1.0, 0.0, 0.0) },
      uPointScale: { value: pointScale },
      uMaxPointSize: { value: maxPointSize },
    },
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
  });
}
