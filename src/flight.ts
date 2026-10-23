import * as THREE from 'three';

const THRUST = 90;
const BOOST_MULTIPLIER = 6;
const DRAG = 1.4; // top speed ≈ THRUST / DRAG
const BRAKE_DRAG = 6;
const MOUSE_SENSITIVITY = 0.0022;
const TOUCH_SENSITIVITY = 0.005;
const ROLL_RATE = 1.4;
const WARP_SECONDS = 3;

interface Warp {
  from: THREE.Vector3;
  fromQuat: THREE.Quaternion;
  /** Re-evaluated every frame because the destination keeps orbiting. */
  target: () => { position: THREE.Vector3; lookAt: THREE.Vector3 };
  t: number;
}

/** Six-degrees-of-freedom spaceship flight: mouse/touch to steer, keys to thrust. */
export class FlightControls {
  readonly velocity = new THREE.Vector3();
  private keys = new Set<string>();
  private look = new THREE.Vector2();
  private warp: Warp | null = null;
  private touchMove = new THREE.Vector2();
  private touchBoost = false;
  private moveTouchId: number | null = null;
  private lookTouchId: number | null = null;
  private moveOrigin = new THREE.Vector2();
  private lastLook = new THREE.Vector2();
  private tmpV = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private tmpM = new THREE.Matrix4();
  private dragging = false;
  private skipMouse = 0;
  private tapStarts = new Map<number, { x: number; y: number; time: number }>();
  locked = false;
  /** Called for a quick tap on touch screens (touch events suppress the click event). */
  onTap: ((x: number, y: number) => void) | null = null;

  constructor(private camera: THREE.PerspectiveCamera, private dom: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === dom;
      this.skipMouse = 2;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked && !this.dragging) return;
      // Chrome reports a huge bogus movement right after locking; drop it.
      if (this.skipMouse > 0 || Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) {
        this.skipMouse = Math.max(0, this.skipMouse - 1);
        return;
      }
      this.look.x += e.movementX * MOUSE_SENSITIVITY;
      this.look.y += e.movementY * MOUSE_SENSITIVITY;
    });
    // Without pointer lock (or on browsers that refuse it) you can still steer by dragging.
    dom.addEventListener('mousedown', (e) => {
      if (e.button === 2 || (!this.locked && e.button === 0 && e.shiftKey)) this.dragging = true;
    });
    window.addEventListener('mouseup', () => (this.dragging = false));
    dom.addEventListener('contextmenu', (e) => e.preventDefault());

    dom.addEventListener('touchstart', (e) => this.onTouch(e), { passive: false });
    dom.addEventListener('touchmove', (e) => this.onTouch(e), { passive: false });
    dom.addEventListener('touchend', (e) => this.onTouchEnd(e));
    dom.addEventListener('touchcancel', (e) => this.onTouchEnd(e));
  }

  lock(): void {
    const req = this.dom.requestPointerLock() as unknown;
    if (req instanceof Promise) req.catch(() => {});
  }

  setTouchBoost(on: boolean): void {
    this.touchBoost = on;
  }

  get speed(): number {
    return this.velocity.length();
  }

  get warping(): boolean {
    return this.warp !== null;
  }

  flyTo(target: Warp['target']): void {
    this.velocity.set(0, 0, 0);
    this.warp = { from: this.camera.position.clone(), fromQuat: this.camera.quaternion.clone(), target, t: 0 };
  }

  update(dt: number): void {
    if (this.warp) {
      this.updateWarp(dt);
      return;
    }
    const cam = this.camera;
    const k = this.keys;

    // Rotation: mouse/touch pitch & yaw, Q/E roll, arrow keys as a keyboard fallback.
    const keyYaw = (k.has('ArrowLeft') ? 1 : 0) - (k.has('ArrowRight') ? 1 : 0);
    const keyPitch = (k.has('ArrowUp') ? 1 : 0) - (k.has('ArrowDown') ? 1 : 0);
    const roll = (k.has('KeyQ') ? 1 : 0) - (k.has('KeyE') ? 1 : 0);
    cam.rotateY(-this.look.x + keyYaw * dt * 1.2);
    cam.rotateX(-this.look.y + keyPitch * dt * 1.2);
    cam.rotateZ(roll * ROLL_RATE * dt);
    this.look.set(0, 0);

    // Thrust in the ship's local frame.
    const dir = this.tmpV.set(
      (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) + this.touchMove.x,
      (k.has('Space') ? 1 : 0) - (k.has('KeyC') || k.has('ControlLeft') ? 1 : 0),
      (k.has('KeyS') ? 1 : 0) - (k.has('KeyW') ? 1 : 0) + this.touchMove.y,
    );
    if (dir.lengthSq() > 1) dir.normalize();
    const boost = k.has('ShiftLeft') || k.has('ShiftRight') || this.touchBoost ? BOOST_MULTIPLIER : 1;
    dir.applyQuaternion(cam.quaternion).multiplyScalar(THRUST * boost * dt);
    this.velocity.add(dir);

    const drag = k.has('KeyX') ? BRAKE_DRAG : DRAG;
    this.velocity.multiplyScalar(Math.exp(-drag * dt));
    cam.position.addScaledVector(this.velocity, dt);
  }

  /** Keeps the ship from flying through solid bodies. */
  collide(center: THREE.Vector3, radius: number): void {
    const offset = this.tmpV.subVectors(this.camera.position, center);
    const dist = offset.length();
    if (dist >= radius || dist === 0) return;
    offset.divideScalar(dist);
    this.camera.position.copy(center).addScaledVector(offset, radius);
    const inward = this.velocity.dot(offset);
    if (inward < 0) this.velocity.addScaledVector(offset, -inward);
  }

  private updateWarp(dt: number): void {
    const w = this.warp!;
    w.t = Math.min(1, w.t + dt / WARP_SECONDS);
    const e = w.t < 0.5 ? 4 * w.t ** 3 : 1 - (-2 * w.t + 2) ** 3 / 2;
    const { position, lookAt } = w.target();
    this.camera.position.lerpVectors(w.from, position, e);
    this.tmpM.lookAt(this.camera.position, lookAt, THREE.Object3D.DEFAULT_UP);
    this.tmpQ.setFromRotationMatrix(this.tmpM);
    this.camera.quaternion.slerpQuaternions(w.fromQuat, this.tmpQ, Math.min(1, e * 1.6));
    if (w.t >= 1) this.warp = null;
  }

  // Touch: left half of the screen is a virtual thrust stick, right half steers.
  private onTouch(e: TouchEvent): void {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      const leftSide = t.clientX < window.innerWidth / 2;
      if (e.type === 'touchstart') {
        this.tapStarts.set(t.identifier, { x: t.clientX, y: t.clientY, time: performance.now() });
        if (leftSide && this.moveTouchId === null) {
          this.moveTouchId = t.identifier;
          this.moveOrigin.set(t.clientX, t.clientY);
        } else if (!leftSide && this.lookTouchId === null) {
          this.lookTouchId = t.identifier;
          this.lastLook.set(t.clientX, t.clientY);
        }
      } else if (t.identifier === this.moveTouchId) {
        this.touchMove.set((t.clientX - this.moveOrigin.x) / 60, (t.clientY - this.moveOrigin.y) / 60).clampLength(0, 1);
      } else if (t.identifier === this.lookTouchId) {
        this.look.x += (t.clientX - this.lastLook.x) * TOUCH_SENSITIVITY;
        this.look.y += (t.clientY - this.lastLook.y) * TOUCH_SENSITIVITY;
        this.lastLook.set(t.clientX, t.clientY);
      }
    }
  }

  private onTouchEnd(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
      const start = this.tapStarts.get(t.identifier);
      this.tapStarts.delete(t.identifier);
      if (start && performance.now() - start.time < 350 && Math.hypot(t.clientX - start.x, t.clientY - start.y) < 12) {
        this.onTap?.(t.clientX, t.clientY);
      }
      if (t.identifier === this.moveTouchId) {
        this.moveTouchId = null;
        this.touchMove.set(0, 0);
      }
      if (t.identifier === this.lookTouchId) this.lookTouchId = null;
    }
  }
}
