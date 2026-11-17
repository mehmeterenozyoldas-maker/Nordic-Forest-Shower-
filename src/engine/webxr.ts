import * as THREE from 'three';
import { WebXRState } from '../types/simulation';
import { terrainHeight } from './environment';
import { QualityProfile } from './quality';

export interface XRRayReading {
  active: boolean;
  selecting: boolean;
  justPressed: boolean;
  worldPos: THREE.Vector3;
}

export interface XRFrameReadings {
  primary: XRRayReading;
  secondary: XRRayReading;
}

export interface WebXRActions {
  onToggleMode?: () => void;
  onCycleSecondary?: () => void;
  onClearWakes?: () => void;
}

const KEY_HAND_JOINTS = [
  'wrist',
  'thumb-tip',
  'index-finger-metacarpal',
  'index-finger-tip',
  'middle-finger-tip',
  'ring-finger-tip',
  'pinky-finger-tip',
] as const;

export class WebXRManager {
  public readonly cameraGroup = new THREE.Group();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly profile: QualityProfile;
  private readonly onStateChange: (state: WebXRState) => void;
  private readonly actions: WebXRActions;
  private currentSession: XRSession | null = null;

  private readonly controller0: THREE.XRTargetRaySpace;
  private readonly controller1: THREE.XRTargetRaySpace;
  private readonly controllerGrip0: THREE.XRGripSpace;
  private readonly controllerGrip1: THREE.XRGripSpace;
  private readonly hand0: THREE.XRHandSpace;
  private readonly hand1: THREE.XRHandSpace;

  private readonly ray0Mat: THREE.LineBasicMaterial;
  private readonly ray1Mat: THREE.LineBasicMaterial;
  private readonly sharedGeos: THREE.BufferGeometry[] = [];
  private readonly sharedMats: THREE.Material[] = [];

  private readonly handJointMeshes: [THREE.Mesh[], THREE.Mesh[]] = [[], []];
  private readonly wristHudCanvas: HTMLCanvasElement;
  private readonly wristHudCtx: CanvasRenderingContext2D | null;
  private readonly wristHudTexture: THREE.CanvasTexture;
  private readonly wristHudMesh: THREE.Mesh;
  private lastHudLabel = '';

  private sourceConnected: [boolean, boolean] = [false, false];
  private sourceIsHand: [boolean, boolean] = [false, false];
  private selectHeld: [boolean, boolean] = [false, false];
  private selectJustPressed: [boolean, boolean] = [false, false];
  private handPinchHeld: [boolean, boolean] = [false, false];
  private prevBtnState: Record<string, boolean[]> = {};
  private connectedCount = 0;
  private heightTrim = 0;

  private readonly _ray = new THREE.Ray();
  private readonly _origin = new THREE.Vector3();
  private readonly _dir = new THREE.Vector3();
  private readonly _mat4 = new THREE.Matrix4();
  private readonly _planeGround = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1.5);
  private readonly _hit = new THREE.Vector3();
  private readonly _forward = new THREE.Vector3();
  private readonly _right = new THREE.Vector3();
  private readonly _indexPos = new THREE.Vector3();
  private readonly _thumbPos = new THREE.Vector3();

  private state: WebXRState = {
    supported: false,
    active: false,
    controllersConnected: 0,
    error: null,
  };

  private readonly readings: XRFrameReadings = {
    primary: { active: false, selecting: false, justPressed: false, worldPos: new THREE.Vector3(999, 999, 999) },
    secondary: { active: false, selecting: false, justPressed: false, worldPos: new THREE.Vector3(999, 999, 999) },
  };

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    profile: QualityProfile,
    onStateChange: (state: WebXRState) => void,
    actions: WebXRActions = {},
  ) {
    this.renderer = renderer;
    this.profile = profile;
    this.onStateChange = onStateChange;
    this.actions = actions;

    this.cameraGroup.add(camera);
    scene.add(this.cameraGroup);

    const rayGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -16),
    ]);
    this.sharedGeos.push(rayGeo);

    this.ray0Mat = new THREE.LineBasicMaterial({ color: 0xe0f2fe, transparent: true, opacity: 0.6 });
    this.ray1Mat = new THREE.LineBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.6 });

    this.controller0 = this.renderer.xr.getController(0);
    this.controller0.visible = false;
    this.controller0.add(new THREE.Line(rayGeo, this.ray0Mat));
    this.bindControllerEvents(this.controller0, 0);
    this.cameraGroup.add(this.controller0);

    this.controller1 = this.renderer.xr.getController(1);
    this.controller1.visible = false;
    this.controller1.add(new THREE.Line(rayGeo, this.ray1Mat));
    this.bindControllerEvents(this.controller1, 1);
    this.cameraGroup.add(this.controller1);

    // Lightweight procedural Quest wands (zero CDN GLTF fetches)
    const wandGeo = new THREE.CylinderGeometry(0.012, 0.016, 0.11, 8);
    wandGeo.rotateX(Math.PI / 2);
    const ringGeo = new THREE.TorusGeometry(0.032, 0.004, 6, 16);
    const wandMat = new THREE.MeshBasicMaterial({ color: 0x1c1917 });
    const emitterMat0 = new THREE.MeshBasicMaterial({ color: 0xe0f2fe });
    const emitterMat1 = new THREE.MeshBasicMaterial({ color: 0x67e8f9 });
    this.sharedGeos.push(wandGeo, ringGeo);
    this.sharedMats.push(wandMat, emitterMat0, emitterMat1);

    this.controllerGrip0 = this.renderer.xr.getControllerGrip(0);
    this.controllerGrip0.visible = false;
    this.controllerGrip0.add(this.buildControllerWand(wandGeo, ringGeo, wandMat, emitterMat0));
    this.cameraGroup.add(this.controllerGrip0);

    this.controllerGrip1 = this.renderer.xr.getControllerGrip(1);
    this.controllerGrip1.visible = false;
    this.controllerGrip1.add(this.buildControllerWand(wandGeo, ringGeo, wandMat, emitterMat1));
    this.cameraGroup.add(this.controllerGrip1);

    // Lightweight procedural hand joint spheres (zero CDN GLTF or 52-bone skinning overhead)
    const jointGeo = new THREE.SphereGeometry(0.01, 6, 5);
    const jointMat0 = new THREE.MeshBasicMaterial({ color: 0xe0f2fe, transparent: true, opacity: 0.78 });
    const jointMat1 = new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.78 });
    this.sharedGeos.push(jointGeo);
    this.sharedMats.push(jointMat0, jointMat1);

    this.hand0 = this.renderer.xr.getHand(0);
    this.hand0.visible = false;
    this.populateHandJoints(this.hand0, 0, jointGeo, jointMat0);
    this.cameraGroup.add(this.hand0);

    this.hand1 = this.renderer.xr.getHand(1);
    this.hand1.visible = false;
    this.populateHandJoints(this.hand1, 1, jointGeo, jointMat1);
    this.cameraGroup.add(this.hand1);

    // Compact Diegetic Wrist HUD Card attached to primary controller/hand
    this.wristHudCanvas = document.createElement('canvas');
    this.wristHudCanvas.width = 320;
    this.wristHudCanvas.height = 96;
    this.wristHudCtx = this.wristHudCanvas.getContext('2d');
    this.wristHudTexture = new THREE.CanvasTexture(this.wristHudCanvas);
    this.wristHudTexture.colorSpace = THREE.SRGBColorSpace;

    const hudGeo = new THREE.PlaneGeometry(0.16, 0.048);
    const hudMat = new THREE.MeshBasicMaterial({
      map: this.wristHudTexture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.sharedGeos.push(hudGeo);
    this.sharedMats.push(hudMat);

    this.wristHudMesh = new THREE.Mesh(hudGeo, hudMat);
    this.wristHudMesh.position.set(0, 0.06, -0.04);
    this.wristHudMesh.rotation.set(-0.65, 0, 0);
    this.wristHudMesh.visible = false;
    this.controller0.add(this.wristHudMesh);

    this.updateWristHud('EXPLORE', 'Fluid Push/Pull');
    void this.probeSupport();
  }

  private buildControllerWand(
    wandGeo: THREE.BufferGeometry,
    ringGeo: THREE.BufferGeometry,
    wandMat: THREE.Material,
    emitterMat: THREE.Material,
  ): THREE.Group {
    const g = new THREE.Group();
    const grip = new THREE.Mesh(wandGeo, wandMat);
    const ring = new THREE.Mesh(ringGeo, emitterMat);
    ring.position.z = -0.055;
    ring.rotation.x = Math.PI / 2;
    g.add(grip, ring);
    return g;
  }

  private populateHandJoints(
    hand: THREE.XRHandSpace,
    index: 0 | 1,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
  ): void {
    for (let i = 0; i < KEY_HAND_JOINTS.length; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      hand.add(m);
      this.handJointMeshes[index].push(m);
    }
  }

  public updateWristHud(modeLabel: string, detailLabel: string): void {
    const key = `${modeLabel}|${detailLabel}`;
    if (key === this.lastHudLabel || !this.wristHudCtx) return;
    this.lastHudLabel = key;

    const ctx = this.wristHudCtx;
    ctx.clearRect(0, 0, 320, 96);
    ctx.fillStyle = 'rgba(12, 10, 9, 0.88)';
    ctx.strokeStyle = 'rgba(103, 232, 249, 0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(2, 2, 316, 92, 12);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = modeLabel === 'PLANT' ? '#86efac' : '#67e8f9';
    ctx.font = '600 20px system-ui, sans-serif';
    ctx.fillText(`${modeLabel} · ${detailLabel}`.slice(0, 26), 16, 38);

    ctx.fillStyle = '#a8a29e';
    ctx.font = '400 15px system-ui, sans-serif';
    ctx.fillText('Grip/A: Mode · B: Cycle · Stick: Move', 16, 70);

    this.wristHudTexture.needsUpdate = true;
  }

  public get status(): WebXRState {
    return this.state;
  }

  private emitState(patch: Partial<WebXRState>): void {
    this.state = { ...this.state, ...patch };
    this.onStateChange({ ...this.state });
  }

  private async probeSupport(): Promise<void> {
    try {
      if (typeof navigator !== 'undefined' && 'xr' in navigator && navigator.xr) {
        const supported = await navigator.xr.isSessionSupported('immersive-vr');
        this.emitState({ supported });
      }
    } catch {
      this.emitState({ supported: false });
    }
  }

  private bindControllerEvents(ctrl: THREE.XRTargetRaySpace, index: 0 | 1): void {
    const grip = index === 0 ? this.controllerGrip0 : this.controllerGrip1;
    const hand = index === 0 ? this.hand0 : this.hand1;

    ctrl.addEventListener('connected', (ev) => {
      const inputSource = (ev as unknown as { data?: XRInputSource }).data;
      const isHand = Boolean(inputSource?.hand);
      this.sourceConnected[index] = true;
      this.sourceIsHand[index] = isHand;

      ctrl.visible = true;
      grip.visible = !isHand;
      hand.visible = isHand;
      if (index === 0) this.wristHudMesh.visible = true;

      this.connectedCount = (this.sourceConnected[0] ? 1 : 0) + (this.sourceConnected[1] ? 1 : 0);
      this.emitState({ controllersConnected: this.connectedCount });
    });

    ctrl.addEventListener('disconnected', () => {
      this.sourceConnected[index] = false;
      this.sourceIsHand[index] = false;
      this.selectHeld[index] = false;
      this.handPinchHeld[index] = false;

      ctrl.visible = false;
      grip.visible = false;
      hand.visible = false;
      if (index === 0) this.wristHudMesh.visible = false;

      this.connectedCount = (this.sourceConnected[0] ? 1 : 0) + (this.sourceConnected[1] ? 1 : 0);
      this.emitState({ controllersConnected: this.connectedCount });
    });

    ctrl.addEventListener('selectstart', () => {
      this.selectHeld[index] = true;
      this.selectJustPressed[index] = true;
    });
    ctrl.addEventListener('selectend', () => {
      this.selectHeld[index] = false;
    });
    ctrl.addEventListener('squeezestart', () => {
      if (index === 0) {
        this.actions.onToggleMode?.();
      } else {
        this.actions.onCycleSecondary?.();
      }
    });
  }

  public async toggleVR(terrainRoughness = 2.0): Promise<void> {
    if (this.currentSession) {
      await this.currentSession.end();
      return;
    }
    if (!navigator.xr) {
      this.emitState({ error: 'WebXR is unavailable in this browser.' });
      return;
    }

    try {
      const session = await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
      });
      this.currentSession = session;
      session.addEventListener('end', this.handleSessionEnd);

      this.renderer.xr.enabled = true;
      this.renderer.xr.setReferenceSpaceType('local-floor');
      if (typeof this.renderer.xr.setFramebufferScaleFactor === 'function') {
        this.renderer.xr.setFramebufferScaleFactor(this.profile.xrFramebufferScaleFactor);
      }
      if (typeof this.renderer.xr.setFoveation === 'function') {
        this.renderer.xr.setFoveation(this.profile.xrFoveation);
      }

      await this.renderer.xr.setSession(session);

      // Ground user on scenic overlook using local-floor reference (real head is already +1.6m)
      this.heightTrim = 0;
      const startGroundY = Math.max(-1.6, terrainHeight(0, 22, terrainRoughness) + 0.05);
      this.cameraGroup.position.set(0, startGroundY, 22);
      this.cameraGroup.rotation.set(0, 0, 0);
      this.emitState({ active: true, error: null });
    } catch (err) {
      this.emitState({
        active: false,
        error: err instanceof Error ? err.message : 'Unable to start immersive VR session.',
      });
    }
  }

  private handleSessionEnd = (): void => {
    this.currentSession?.removeEventListener('end', this.handleSessionEnd);
    this.currentSession = null;
    this.renderer.xr.enabled = false;
    this.cameraGroup.position.set(0, 0, 0);
    this.cameraGroup.rotation.set(0, 0, 0);
    this.heightTrim = 0;
    this.sourceConnected = [false, false];
    this.sourceIsHand = [false, false];
    this.selectHeld = [false, false];
    this.selectJustPressed = [false, false];
    this.handPinchHeld = [false, false];
    this.prevBtnState = {};
    this.controller0.visible = false;
    this.controller1.visible = false;
    this.controllerGrip0.visible = false;
    this.controllerGrip1.visible = false;
    this.hand0.visible = false;
    this.hand1.visible = false;
    this.wristHudMesh.visible = false;
    this.emitState({ active: false, controllersConnected: 0 });
  };

  public update(dt: number, camera: THREE.PerspectiveCamera, terrainRoughness: number): XRFrameReadings {
    if (!this.renderer.xr.isPresenting) {
      this.readings.primary.active = false;
      this.readings.secondary.active = false;
      return this.readings;
    }

    const session = this.renderer.xr.getSession();
    if (session) {
      for (const source of session.inputSources) {
        const gp = source.gamepad;
        if (!gp) continue;

        const axes = gp.axes;
        if (axes && axes.length >= 4) {
          if (source.handedness === 'right') {
            // Right stick X: smooth yaw rotation for seated Quest 3S exploration
            const turnX = Math.abs(axes[2]) > 0.16 ? axes[2] : 0;
            const elevY = Math.abs(axes[3]) > 0.22 ? axes[3] : 0;
            if (turnX !== 0) {
              this.cameraGroup.rotation.y -= turnX * 1.65 * dt;
            }
            if (elevY !== 0) {
              this.heightTrim = THREE.MathUtils.clamp(this.heightTrim - elevY * 4.0 * dt, -0.4, 10.0);
            }
          } else {
            // Left (or single) stick: head-relative planar locomotion
            const moveX = Math.abs(axes[2]) > 0.14 ? axes[2] : 0;
            const moveZ = Math.abs(axes[3]) > 0.14 ? axes[3] : 0;
            if (moveX !== 0 || moveZ !== 0) {
              camera.getWorldDirection(this._forward);
              this._forward.y = 0;
              if (this._forward.lengthSq() > 0.001) this._forward.normalize();
              this._right.crossVectors(this._forward, camera.up).normalize();

              const speed = 9.0 * dt;
              this.cameraGroup.position.addScaledVector(this._right, moveX * speed);
              this.cameraGroup.position.addScaledVector(this._forward, -moveZ * speed);
              this.cameraGroup.position.x = THREE.MathUtils.clamp(this.cameraGroup.position.x, -33, 33);
              this.cameraGroup.position.z = THREE.MathUtils.clamp(this.cameraGroup.position.z, -33, 33);
            }
          }
        }

        // Edge-triggered Quest A/X, B/Y, Thumbstick-Click bindings
        const key = source.handedness || 'none';
        const prev = this.prevBtnState[key] ?? [];
        const pressedAt = (idx: number) => Boolean(gp.buttons[idx]?.pressed);
        const justClicked = (idx: number) => pressedAt(idx) && !prev[idx];

        if (justClicked(4)) {
          this.actions.onToggleMode?.();
          gp.hapticActuators?.[0]?.pulse?.(0.35, 45);
        }
        if (justClicked(5)) {
          this.actions.onCycleSecondary?.();
          gp.hapticActuators?.[0]?.pulse?.(0.25, 35);
        }
        if (justClicked(3)) {
          this.actions.onClearWakes?.();
          gp.hapticActuators?.[0]?.pulse?.(0.4, 55);
        }

        this.prevBtnState[key] = gp.buttons.map((b) => b.pressed);
      }
    }

    // Smoothly ground cameraGroup over terrain hills & river valley
    const targetGroundY =
      Math.max(-1.6, terrainHeight(this.cameraGroup.position.x, this.cameraGroup.position.z, terrainRoughness) + 0.05) +
      this.heightTrim;
    this.cameraGroup.position.y = THREE.MathUtils.damp(this.cameraGroup.position.y, targetGroundY, 8.0, dt);

    this.sampleInput(this.controller0, this.hand0, 0, terrainRoughness, this.readings.primary);
    this.sampleInput(this.controller1, this.hand1, 1, terrainRoughness, this.readings.secondary);

    this.ray0Mat.color.setHex(this.readings.primary.selecting ? 0x38bdf8 : 0xe0f2fe);
    this.ray1Mat.color.setHex(this.readings.secondary.selecting ? 0x38bdf8 : 0x67e8f9);

    return this.readings;
  }

  private sampleInput(
    ctrl: THREE.XRTargetRaySpace,
    hand: THREE.XRHandSpace,
    index: 0 | 1,
    terrainRoughness: number,
    out: XRRayReading,
  ): void {
    if (!this.sourceConnected[index]) {
      out.active = false;
      out.selecting = false;
      out.justPressed = false;
      return;
    }

    // Update lightweight procedural hand joint spheres & direct thumb-index pinch when hand-tracking is active
    let handPinching = false;
    let handPinchJustPressed = false;
    if (this.sourceIsHand[index] && hand.joints) {
      const meshes = this.handJointMeshes[index];
      for (let i = 0; i < KEY_HAND_JOINTS.length; i++) {
        const joint = hand.joints[KEY_HAND_JOINTS[i]];
        const mesh = meshes[i];
        if (joint && joint.visible) {
          mesh.visible = true;
          mesh.position.copy(joint.position);
        } else {
          mesh.visible = false;
        }
      }

      const indexJoint = hand.joints['index-finger-tip'];
      const thumbJoint = hand.joints['thumb-tip'];
      if (indexJoint?.visible && thumbJoint?.visible) {
        indexJoint.getWorldPosition(this._indexPos);
        thumbJoint.getWorldPosition(this._thumbPos);
        const pinchDist = this._indexPos.distanceTo(this._thumbPos);
        handPinching = pinchDist < 0.028;
        handPinchJustPressed = handPinching && !this.handPinchHeld[index];
        this.handPinchHeld[index] = handPinching;
      } else {
        this.handPinchHeld[index] = false;
      }
    }

    this._mat4.identity().extractRotation(ctrl.matrixWorld);
    this._origin.setFromMatrixPosition(ctrl.matrixWorld);
    this._dir.set(0, 0, -1).applyMatrix4(this._mat4).normalize();

    this._ray.set(this._origin, this._dir);
    const hit = this._ray.intersectPlane(this._planeGround, this._hit);

    out.justPressed = this.selectJustPressed[index] || handPinchJustPressed;
    this.selectJustPressed[index] = false;
    out.selecting = this.selectHeld[index] || handPinching;

    if (hit && Math.abs(hit.x) < 42 && Math.abs(hit.z) < 42) {
      out.active = true;
      out.worldPos.set(hit.x, terrainHeight(hit.x, hit.z, terrainRoughness), hit.z);
    } else {
      out.active = true;
      out.worldPos.copy(this._origin).addScaledVector(this._dir, 9.0);
    }
  }

  public dispose(): void {
    if (this.currentSession) {
      void this.currentSession.end();
    }
    this.ray0Mat.dispose();
    this.ray1Mat.dispose();
    this.wristHudTexture.dispose();
    for (const g of this.sharedGeos) g.dispose();
    for (const m of this.sharedMats) m.dispose();
  }
}
