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

  varying float vDisplacement;
  varying vec3 vPosition;
  varying vec3 vColor;
  varying float vType;
  varying float vRustle;
  varying float vSwirl;
  varying float vAurora;
  varying float vSapGlow;
  varying float vBirthSpark;
  varying float vHint;
  varying vec3 vWorldNormal;
  varying vec3 vVelocity;

  // Simplex 3D Noise
  vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}

  float snoise(vec3 v){
    const vec2  C = vec2(1.0/6.0, 1.0/3.0);
    const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + 1.0 * C.xxx;
    vec3 x2 = x0 - i2 + 2.0 * C.xxx;
    vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;

    i = mod(i, 289.0);
    vec4 p = permute(permute(permute(
               i.z + vec4(0.0, i1.z, i2.z, 1.0))
             + i.y + vec4(0.0, i1.y, i2.y, 1.0))
             + i.x + vec4(0.0, i1.x, i2.x, 1.0));

    float n_ = 1.0/7.0;
    vec3  ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);

    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);

    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  mat2 rotate2d(float _angle){
    return mat2(cos(_angle), -sin(_angle), sin(_angle), cos(_angle));
  }

  void applyCursorForce(
    vec3 cursorPos,
    float cursorForce,
    vec3 cursorVel,
    float contextMask,
    float scatterMult,
    vec3 noiseVec,
    inout vec4 worldPosition,
    inout vec3 displacement,
    inout float swirl,
    inout float auroraOut,
    inout float maxInfluence
  ) {
    float dist = distance(worldPosition.xyz, cursorPos);
    float influence = (1.0 - smoothstep(0.0, uRadius, dist)) * contextMask;
    maxInfluence = max(maxInfluence, influence);

    vec3 toCursor = worldPosition.xyz - cursorPos;
    vec3 dir = length(toCursor) > 0.001 ? normalize(toCursor) : vec3(0.0, 1.0, 0.0);
    dir = normalize(dir + vec3(0.0, 0.2, 0.0));
    float noiseAmp = (cursorForce > 0.0) ? 1.0 : 0.2;

    if (uInteractionType == 1.0 && influence > 0.0) {
      swirl = max(swirl, influence);
      float angle = influence * uTime * 15.0;
      vec3 toParticle = worldPosition.xyz - cursorPos;
      vec2 rotatedXZ = rotate2d(angle) * toParticle.xz;
      worldPosition.x = cursorPos.x + rotatedXZ.x;
      worldPosition.z = cursorPos.z + rotatedXZ.y;
      vec3 newDir = normalize(worldPosition.xyz - cursorPos + vec3(0.0001));
      vec3 d = (newDir * cursorForce * 0.5 + noiseVec * noiseAmp + vec3(0.0, 2.0, 0.0)) * influence * scatterMult;
      worldPosition.xyz += d;
      displacement += d;
    } else if (uInteractionType == 2.0 && influence > 0.0) {
      vec3 d = vec3(dir.x, 0.0, dir.z) * abs(cursorForce) * 2.0 * influence * scatterMult + noiseVec * noiseAmp * influence;
      worldPosition.xyz += d;
      displacement += d;
    } else if (uInteractionType == 3.0 && influence > 0.0) {
      float mouseSpeed = clamp(length(cursorVel), 0.0, 20.0);
      vec3 mouseDir = mouseSpeed > 0.01 ? normalize(cursorVel) : dir;
      vec3 advection = mouseDir * mouseSpeed * influence * 0.3;

      vec3 toParticle = normalize(worldPosition.xyz - cursorPos + vec3(0.0001));
      vec3 vortexAxis = cross(mouseDir, toParticle);
      if (length(vortexAxis) < 0.01) vortexAxis = vec3(0.0, 1.0, 0.0);
      vec3 curl = normalize(cross(vortexAxis, toParticle)) * snoise(position * 2.0 + uTime * 2.0) * abs(cursorForce);

      if (type == 3.0) {
        advection.y += mouseSpeed * influence * 0.5 * sign(cursorForce);
        curl *= 0.5;
      } else if (type == 1.0) {
        curl *= 2.0;
      } else if (type == 2.0) {
        advection = vec3(0.0, cursorForce * influence * 2.0, 0.0);
        curl = vec3(0.0);
      }

      vec3 d = (advection + curl * 2.0 + noiseVec * noiseAmp) * influence * scatterMult;
      worldPosition.xyz += d;
      displacement += d;
    } else if (uInteractionType == 4.0 && contextMask > 0.5) {
      float wave = sin(dist * 3.0 - uTime * 15.0) * exp(-dist * 0.3);
      vec3 d = vec3(0.0, 1.0, 0.0) * wave * abs(cursorForce) * 8.0 * scatterMult;
      d += dir * wave * cursorForce * 2.0 * scatterMult;
      worldPosition.xyz += d;
      displacement += d;
    } else if (uInteractionType == 5.0 && contextMask > 0.5) {
      float lift = smoothstep(uRadius * 1.5, 0.0, dist) * abs(cursorForce) * 8.0;
      vec3 magneticUp = vec3(0.0, 1.0, 0.0) * lift;
      vec3 swirlDir = cross(dir, vec3(0.0, 1.0, 0.0));
      if (length(swirlDir) < 0.01) swirlDir = vec3(1.0, 0.0, 0.0);
      vec3 d = (magneticUp + normalize(swirlDir) * lift * 0.8 + noiseVec * lift * 0.3) * scatterMult;
      worldPosition.xyz += d;
      displacement += d;
      auroraOut = max(auroraOut, influence * smoothstep(0.0, 15.0, d.y));
    } else if (uInteractionType == 0.0 && influence > 0.0) {
      vec3 gustDir = vec3(1.0, 0.2, 0.5);
      vec3 d = (gustDir * cursorForce + noiseVec * noiseAmp) * influence * scatterMult;
      worldPosition.xyz += d;
      displacement += d;
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
      // Elastic ease-out pop
      float ease = 1.0 - pow(1.0 - t, 3.0);
      birthScale = mix(0.05, 1.0, ease);
      worldPosition.y -= (1.0 - ease) * 2.6;
      birthSpark = (1.0 - t) * step(age, 0.9);
    }
    vBirthSpark = birthSpark;

    // Wind & Ambient Motion
    float windSpeed = uTime * 0.5;
    float windStrength = 0.0;
    float rustle = 0.0;

    vec3 windPos = position * 0.05 + uWindDir * uTime * 1.5;
    float windNoise = snoise(windPos) * 0.5 + 0.5;
    float gust = snoise(windPos * 0.2 + vec3(100.0)) * 0.5 + 0.5;
    vec3 windForce = uWindDir * (windNoise + gust * 2.0) * uWindStrength;

    if (type == 1.0) { // Leaf
      rustle = snoise(vec3(position.x * 4.0, position.y * 4.0 + uTime * 3.0, position.z * 4.0));
      worldPosition.x += rustle * 0.08;
      worldPosition.y += rustle * 0.05;
      worldPosition.z += rustle * 0.08;
      windStrength = 0.8;
    } else if (type == 0.0) { // Wood
      windStrength = 0.15;
    } else if (type == 3.0) { // Water
      float ripple = snoise(vec3(position.x * 3.0, uTime * 1.5, position.z * 3.0));
      worldPosition.y += ripple * 0.1;
      worldPosition.x += snoise(vec3(position.x, position.y, uTime)) * 0.05;
      windStrength = 0.05;
    }
    vRustle = rustle;

    if (type < 1.5) { // Only trees sway
      float heightFactor = smoothstep(-5.0, 15.0, position.y);
      worldPosition.xyz += windForce * heightFactor * windStrength * 2.0;

      vec3 perpWind = cross(uWindDir, vec3(0.0, 1.0, 0.0));
      if (length(perpWind) < 0.1) perpWind = vec3(1.0, 0.0, 0.0);
      float sway = snoise(vec3(0.0, position.y * 0.1, windSpeed)) * heightFactor * windStrength;
      worldPosition.xyz += normalize(perpWind) * sway;
    }

    // Context Masking
    bool canInteract = true;
    if (uInteractionContext == 1.0 && type > 1.5) canInteract = false;
    if (uInteractionContext == 2.0 && type != 3.0) canInteract = false;
    if (uInteractionContext == 3.0 && type != 2.0) canInteract = false;
    float contextMask = canInteract ? 1.0 : 0.0;

    vec3 noiseVec = vec3(
      snoise(position * 1.5 + uTime * 0.5),
      snoise(position * 1.5 + uTime * 0.5 + 100.0),
      snoise(position * 1.5 + uTime * 0.5 + 200.0)
    );

    float scatterMult = 1.5;
    if (type == 1.0) scatterMult = 3.0;
    if (type == 3.0) scatterMult = 2.0;
    if (type == 2.0) scatterMult = 0.5;
    if (type == 0.0) scatterMult = 0.2;

    vec3 displacement = vec3(0.0);
    float swirl = 0.0;
    float auroraVal = 0.0;
    float maxInfluence = 0.0;

    // Primary Cursor / Hand / Controller
    applyCursorForce(
      uMouse,
      uForce,
      uMouseVelocity,
      contextMask,
      scatterMult,
      noiseVec,
      worldPosition,
      displacement,
      swirl,
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
        noiseVec,
        worldPosition,
        displacement,
        swirl,
        auroraVal,
        maxInfluence
      );
    }

    // Persistent GPU Ping-Pong Wake Field Coupling
    vec2 wakeUv = clamp((worldPosition.xz / 70.0) + 0.5, vec2(0.002), vec2(0.998));
    vec4 wake = texture2D(uWakeTex, wakeUv);
    vec2 wakeVel = (wake.rg - 0.5) * 2.0;
    float wakeEnergy = wake.b * contextMask;
    float wakeRipple = wake.a * contextMask;

    if (wakeEnergy > 0.01) {
      float wavePhase = sin(wakeRipple * 14.0 - uTime * 5.0);
      vec3 wakeDisp = vec3(wakeVel.x * 4.2, wavePhase * 1.15 * wakeEnergy, wakeVel.y * 4.2) * wakeEnergy * (0.4 + scatterMult * 0.45);
      if (type == 0.0) wakeDisp *= 0.2;
      if (type == 2.0 && uInteractionType != 4.0) wakeDisp.xz *= 0.25;
      if (uInteractionType == 5.0) {
        wakeDisp.y += wakeEnergy * 4.5 * scatterMult * 0.35;
        auroraVal = max(auroraVal, wakeEnergy * 0.85);
      }
      worldPosition.xyz += wakeDisp;
      displacement += wakeDisp;
    }

    // Glowing Tree-Sap Veins (pulse upward along trunk wood when energized)
    float sapPulse = 0.0;
    if (type == 0.0) {
      float veinNoise = sin(position.y * 2.8 - uTime * 3.4 + position.x * 1.7 + aHint * 6.28);
      float activity = clamp(wakeEnergy * 1.4 + maxInfluence * 1.1 + uSeasonWeights.z * 0.35, 0.0, 1.0);
      sapPulse = smoothstep(0.65, 0.98, veinNoise) * activity;
    }
    vSapGlow = sapPulse;

    vAurora = auroraVal;
    vDisplacement = length(displacement);
    vSwirl = swirl;
    vVelocity = displacement;

    vWorldNormal = normalize(worldPosition.xyz - vec3(0.0, worldPosition.y, 0.0) + vec3(0.0001));
    if (type == 1.0) vWorldNormal = normalize(worldPosition.xyz + vec3(0.0, 5.0, 0.0));
    if (type == 2.0 || type == 3.0) vWorldNormal = vec3(0.0, 1.0, 0.0);

    vec4 mvPosition = viewMatrix * worldPosition;
    gl_Position = projectionMatrix * mvPosition;

    float baseSize = 2.0;
    if (type == 1.0) baseSize = 6.0 + rustle * 1.0;
    if (type == 3.0) baseSize = 4.0;
    if (type == 2.0) baseSize = 3.0;
    if (type == 0.0) baseSize = 4.0 + sapPulse * 1.5;

    gl_PointSize = (baseSize + maxInfluence * 2.0 + wakeEnergy * 1.5 + birthSpark * 3.0) * birthScale * (20.0 / max(1.0, -mvPosition.z));
  }
`;

export const FOREST_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform float uFogDensity;
  uniform vec3 uSeasonWeights; // (autumn, spring, winter)

  varying float vDisplacement;
  varying vec3 vPosition;
  varying vec3 vColor;
  varying float vType;
  varying float vRustle;
  varying float vSwirl;
  varying float vAurora;
  varying float vSapGlow;
  varying float vBirthSpark;
  varying float vHint;
  varying vec3 vWorldNormal;
  varying vec3 vVelocity;

  void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    float alphaMult = 1.0;

    // GPU Seasonal Palette Morphing (Zero CPU Buffer Regeneration Stall)
    vec3 finalBaseColor = vColor;
    if (vType == 1.0) {
      // Foliage shifts smoothly: Autumn (base) -> Spring verdant/blossom -> Winter frost/slate
      vec3 springLeaf = mix(vec3(0.20, 0.42, 0.14), vec3(0.62, 0.74, 0.48), vHint);
      if (vHint > 0.84) {
        springLeaf = mix(springLeaf, vec3(0.88, 0.91, 0.84), 0.72); // Pale birch blossom highlights
      }
      vec3 winterLeaf = mix(vec3(0.14, 0.24, 0.27), vec3(0.82, 0.90, 0.98), smoothstep(0.45, 0.9, vHint));
      finalBaseColor =
        vColor * uSeasonWeights.x +
        springLeaf * uSeasonWeights.y +
        winterLeaf * uSeasonWeights.z;
    } else if (vType == 2.0) {
      // Ground shifts smoothly: Autumn earth -> Spring moss -> Winter snow crust
      vec3 springGround = mix(vColor, vec3(0.18, 0.34, 0.19), 0.55 * vHint);
      vec3 winterGround = mix(vec3(0.22, 0.26, 0.32), vec3(0.86, 0.92, 0.99), smoothstep(0.35, 0.85, vHint));
      finalBaseColor =
        vColor * uSeasonWeights.x +
        springGround * uSeasonWeights.y +
        winterGround * uSeasonWeights.z;
    } else if (vType == 3.0) {
      // River water warms slightly in spring and takes icy steel reflections in winter
      vec3 springWater = mix(vColor, vec3(0.08, 0.34, 0.44), 0.45);
      vec3 winterWater = mix(vColor, vec3(0.22, 0.38, 0.52), 0.65);
      finalBaseColor =
        vColor * uSeasonWeights.x +
        springWater * uSeasonWeights.y +
        winterWater * uSeasonWeights.z;
    }

    // Volumetric Lighting / Mie Scattering Approximation
    vec3 viewDir = normalize(vPosition - cameraPosition);
    float VoL = max(0.0, dot(viewDir, uSunDirection));
    float scattering = pow(VoL, 8.0) * 0.5 + pow(VoL, 32.0) * 1.5;
    vec3 scatterColor = uSunColor * scattering;

    if (vType == 1.0) { // Leaf
      dist = length(coord * vec2(1.0, 1.5));
      if (dist > 0.45) discard;
      alphaMult = 0.9;

      vec3 sssColor = mix(vec3(0.8, 0.9, 0.3), vec3(0.65, 0.9, 1.0), uSeasonWeights.z);
      float sssIntensity = smoothstep(0.0, 1.0, vRustle) * 0.3 + (1.0 - smoothstep(0.0, 0.45, dist)) * 0.15;
      finalBaseColor = mix(finalBaseColor, sssColor, sssIntensity);

      float light = dot(vWorldNormal, uSunDirection);
      finalBaseColor *= 0.6 + 0.6 * max(0.0, light);
      finalBaseColor += scatterColor * 0.3;
    } else if (vType == 3.0) { // Water
      if (dist > 0.5) discard;
      alphaMult = 0.85;

      float sparkle = smoothstep(0.8, 1.0, sin(vPosition.x * 20.0 + uTime * 2.0) * cos(vPosition.z * 20.0 + uTime * 1.5));
      finalBaseColor += vec3(sparkle * 0.6);

      float light = dot(vWorldNormal, uSunDirection);
      finalBaseColor *= 0.5 + 0.7 * max(0.0, light);

      vec3 halfVector = normalize(uSunDirection + viewDir);
      float specular = pow(max(0.0, dot(vWorldNormal, halfVector)), 32.0);
      finalBaseColor += uSunColor * specular * 0.5;
    } else { // Wood & Ground
      if (dist > 0.5) discard;
      float light = dot(vWorldNormal, uSunDirection);
      finalBaseColor *= 0.5 + 0.5 * max(0.0, light);
    }

    // Glowing Tree-Sap Veins along wood trunk particles
    if (vSapGlow > 0.01) {
      vec3 sapColor = mix(vec3(0.25, 0.95, 0.78), vec3(0.95, 0.72, 0.28), uSeasonWeights.x);
      finalBaseColor += sapColor * vSapGlow * 1.55;
    }

    // Newly planted tree golden-emerald birth shimmer
    if (vBirthSpark > 0.01) {
      finalBaseColor += vec3(0.55, 0.98, 0.78) * vBirthSpark * 1.4;
    }

    // Soft volumetric radial fade
    float alpha = smoothstep(0.5, 0.1, dist) * alphaMult;

    float d = clamp(vDisplacement * 0.1, 0.0, 1.0);
    vec3 dustColor = vec3(0.6, 0.55, 0.45);
    if (vType == 1.0) dustColor = mix(vec3(0.4, 0.5, 0.2), vec3(0.75, 0.88, 1.0), uSeasonWeights.z);
    if (vType == 3.0) dustColor = vec3(0.8, 0.9, 1.0);

    vec3 finalColor = mix(finalBaseColor, dustColor, d * 0.5);

    // Height mist + exponential fog
    float depth = gl_FragCoord.z / gl_FragCoord.w;
    float fogFactor = exp2(-uFogDensity * uFogDensity * depth * depth * 1.442695);
    fogFactor = clamp(fogFactor, 0.0, 1.0);

    vec3 baseFogColor = vec3(0.0);
    float heightFog = 1.0 - smoothstep(-4.0, 8.0, vPosition.y);
    vec3 mistColor = mix(vec3(0.08, 0.09, 0.14), vec3(0.11, 0.15, 0.22), uSeasonWeights.z);
    vec3 finalFogColor = mix(baseFogColor, mistColor, heightFog * 0.6) + scatterColor * 0.8;

    // Aurora Ribbon Trails Coloring
    if (vAurora > 0.0) {
      vec3 auroraGreen = vec3(0.2, 1.0, 0.6);
      vec3 auroraTeal = vec3(0.15, 0.85, 0.95);
      vec3 auroraPurple = vec3(0.72, 0.32, 1.0);
      float ribbonWave = sin(vPosition.x * 0.18 + vPosition.z * 0.12 + uTime * 0.7) * 0.5 + 0.5;
      vec3 aColor = mix(mix(auroraGreen, auroraTeal, 0.4), auroraPurple, ribbonWave);
      finalColor = mix(finalColor, aColor, vAurora);
      alpha = min(1.0, alpha + vAurora * 0.65);
      finalColor += aColor * vAurora * 2.0;
    }

    // Velocity Field Color (VFC)
    float speed = length(vVelocity);
    if (speed > 0.05) {
      float speedNorm = clamp((speed - 0.05) * 0.2, 0.0, 1.0);
      vec3 vfcSlow = vec3(0.0, 0.8, 1.0);
      vec3 vfcFast = vec3(1.0, 0.2, 0.6);
      vec3 vfcSuperFast = vec3(1.0, 0.6, 0.0);

      vec3 vfcColor = mix(vfcSlow, vfcFast, smoothstep(0.0, 0.5, speedNorm));
      vfcColor = mix(vfcColor, vfcSuperFast, smoothstep(0.5, 1.0, speedNorm));

      finalColor = mix(finalColor, vfcColor, speedNorm * 0.85);
      finalColor += vfcColor * speedNorm * 1.35;
      alpha = min(1.0, alpha + speedNorm * 0.4);
    }

    gl_FragColor = vec4(mix(finalFogColor, finalColor + scatterColor * 0.3, fogFactor), alpha);
  }
`;

export function createForestMaterial(wakeTexture: THREE.Texture): THREE.ShaderMaterial {
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
    },
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
  });
}
