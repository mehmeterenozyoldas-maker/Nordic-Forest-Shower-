import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js';
import { WebXRState } from '../types/simulation';
import { terrainHeight } from './environment';

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

export class WebXRManager {
  public readonly cameraGroup = new THREE.Group();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly onStateChange: (state: WebXRState) => void;
  private currentSession: XRSession | null = null;

  private readonly controller0: THREE.XRTargetRaySpace;
  private readonly controller1: THREE.XRTargetRaySpace;
  private readonly controllerGrip0: THREE.XRGripSpace;
  private readonly controllerGrip1: THREE.XRGripSpace;
  private readonly hand0: THREE.XRHandSpace;
  private readonly hand1: THREE.XRHandSpace;

  private readonly ray0Mat: THREE.LineBasicMaterial;
  private readonly ray1Mat: THREE.LineBasicMaterial;

  private selectHeld = [false, false];
  private selectJustPressed = [false, false];
  private connectedCount = 0;

  private readonly _ray = new THREE.Ray();
  private readonly _origin = new THREE.Vector3();
  private readonly _dir = new THREE.Vector3();
  private readonly _mat4 = new THREE.Matrix4();
  private readonly _planeGround = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1.5);
  private readonly _hit = new THREE.Vector3();
  private readonly _forward = new THREE.Vector3();
  private readonly _right = new THREE.Vector3();

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
    onStateChange: (state: WebXRState) => void,
  ) {
    this.renderer = renderer;
    this.onStateChange = onStateChange;

    this.cameraGroup.add(camera);
    scene.add(this.cameraGroup);

    const controllerModelFactory = new XRControllerModelFactory();
    const handModelFactory = new XRHandModelFactory();

    const rayGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -18),
    ]);
    this.ray0Mat = new THREE.LineBasicMaterial({ color: 0xe0f2fe, transparent: true, opacity: 0.65 });
    this.ray1Mat = new THREE.LineBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.65 });

    this.controller0 = this.renderer.xr.getController(0);
    this.controller0.add(new THREE.Line(rayGeo, this.ray0Mat));
    this.bindControllerEvents(this.controller0, 0);
    this.cameraGroup.add(this.controller0);

    this.controller1 = this.renderer.xr.getController(1);
    this.controller1.add(new THREE.Line(rayGeo.clone(), this.ray1Mat));
    this.bindControllerEvents(this.controller1, 1);
    this.cameraGroup.add(this.controller1);

    this.controllerGrip0 = this.renderer.xr.getControllerGrip(0);
    this.controllerGrip0.add(controllerModelFactory.createControllerModel(this.controllerGrip0));
    this.cameraGroup.add(this.controllerGrip0);

    this.controllerGrip1 = this.renderer.xr.getControllerGrip(1);
    this.controllerGrip1.add(controllerModelFactory.createControllerModel(this.controllerGrip1));
    this.cameraGroup.add(this.controllerGrip1);

    this.hand0 = this.renderer.xr.getHand(0);
    this.hand0.add(handModelFactory.createHandModel(this.hand0, 'mesh'));
    this.cameraGroup.add(this.hand0);

    this.hand1 = this.renderer.xr.getHand(1);
    this.hand1.add(handModelFactory.createHandModel(this.hand1, 'mesh'));
    this.cameraGroup.add(this.hand1);

    void this.probeSupport();
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
    ctrl.addEventListener('connected', () => {
      this.connectedCount++;
      this.emitState({ controllersConnected: this.connectedCount });
    });
    ctrl.addEventListener('disconnected', () => {
      this.connectedCount = Math.max(0, this.connectedCount - 1);
      this.selectHeld[index] = false;
      this.emitState({ controllersConnected: this.connectedCount });
    });
    ctrl.addEventListener('selectstart', () => {
      this.selectHeld[index] = true;
      this.selectJustPressed[index] = true;
    });
    ctrl.addEventListener('selectend', () => {
      this.selectHeld[index] = false;
    });
  }

  public async toggleVR(): Promise<void> {
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
        optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers'],
      });
      this.currentSession = session;
      session.addEventListener('end', this.handleSessionEnd);

      this.renderer.xr.enabled = true;
      await this.renderer.xr.setSession(session);
      // Place visitor near scenic overlook facing the birch forest & river
      this.cameraGroup.position.set(0, 1.5, 22);
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
    this.selectHeld = [false, false];
    this.selectJustPressed = [false, false];
    this.emitState({ active: false });
  };

  public update(dt: number, camera: THREE.PerspectiveCamera, terrainRoughness: number): XRFrameReadings {
    if (!this.renderer.xr.isPresenting) {
      this.readings.primary.active = false;
      this.readings.secondary.active = false;
      return this.readings;
    }

    // Thumbstick Locomotion across XR Input Sources
    const session = this.renderer.xr.getSession();
    if (session) {
      for (const source of session.inputSources) {
        const axes = source.gamepad?.axes;
        if (!axes || axes.length < 4) continue;
        const moveX = Math.abs(axes[2]) > 0.14 ? axes[2] : 0;
        const moveZ = Math.abs(axes[3]) > 0.14 ? axes[3] : 0;
        if (moveX !== 0 || moveZ !== 0) {
          camera.getWorldDirection(this._forward);
          this._forward.y = 0;
          if (this._forward.lengthSq() > 0.001) this._forward.normalize();
          this._right.crossVectors(this._forward, camera.up).normalize();

          const speed = 10.0 * dt;
          this.cameraGroup.position.addScaledVector(this._right, moveX * speed);
          this.cameraGroup.position.addScaledVector(this._forward, -moveZ * speed);
          this.cameraGroup.position.x = THREE.MathUtils.clamp(this.cameraGroup.position.x, -34, 34);
          this.cameraGroup.position.z = THREE.MathUtils.clamp(this.cameraGroup.position.z, -34, 34);
        }
      }
    }

    this.sampleController(this.controller0, 0, terrainRoughness, this.readings.primary);
    this.sampleController(this.controller1, 1, terrainRoughness, this.readings.secondary);

    this.ray0Mat.color.setHex(this.selectHeld[0] ? 0x38bdf8 : 0xe0f2fe);
    this.ray1Mat.color.setHex(this.selectHeld[1] ? 0x38bdf8 : 0x67e8f9);

    return this.readings;
  }

  private sampleController(
    ctrl: THREE.XRTargetRaySpace,
    index: 0 | 1,
    terrainRoughness: number,
    out: XRRayReading,
  ): void {
    this._mat4.identity().extractRotation(ctrl.matrixWorld);
    this._origin.setFromMatrixPosition(ctrl.matrixWorld);
    this._dir.set(0, 0, -1).applyMatrix4(this._mat4).normalize();

    this._ray.set(this._origin, this._dir);
    const hit = this._ray.intersectPlane(this._planeGround, this._hit);

    out.justPressed = this.selectJustPressed[index];
    this.selectJustPressed[index] = false;
    out.selecting = this.selectHeld[index];

    if (hit && Math.abs(hit.x) < 42 && Math.abs(hit.z) < 42) {
      out.active = true;
      out.worldPos.set(hit.x, terrainHeight(hit.x, hit.z, terrainRoughness), hit.z);
    } else {
      // Fall back to a point 10m in front of the controller ray
      out.active = true;
      out.worldPos.copy(this._origin).addScaledVector(this._dir, 10.0);
    }
  }

  public dispose(): void {
    if (this.currentSession) {
      void this.currentSession.end();
    }
    this.ray0Mat.dispose();
    this.ray1Mat.dispose();
  }
}
