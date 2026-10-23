import * as THREE from 'three';
import { activeBooking, enquiryLink, type AdConfig, type Booking, type Slot } from './ads';
import { AdAnalytics } from './analytics';
import { createPainter, SCREEN_H, SCREEN_W, type Painter } from './creatives';
import type { SolarSystem } from './solarSystem';

const TIER_COLORS: Record<Slot['tier'], number> = {
  standard: 0x7aa7ff,
  premium: 0x3dffd8,
  landmark: 0xffd23d,
};

// Canvas repainting is the expensive part, so only the nearest few boards animate at full rate.
const FULL_RATE_BOARDS = 4;
const FULL_RATE_FPS = 30;
const LOW_RATE_FPS = 4;
const PAINT_DISTANCE = 1500;
// A board must be at least this tall on screen, for this long, to count as an impression.
const IMPRESSION_MIN_PX = 48;
const IMPRESSION_SECONDS = 1;
// After looking away this long, seeing the board again counts as a new impression.
const IMPRESSION_RESET_SECONDS = 5;

const FRAME_VERTEX = /* glsl */ `
  varying vec2 vUv;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

// A border of chasing marquee bulbs around the screen.
const FRAME_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uHover;
  uniform vec3 uColor;
  uniform vec2 uSize;
  uniform float uBorder;
  varying vec2 vUv;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    vec2 p = vUv * uSize;
    vec2 edge = min(p, uSize - p);
    if (min(edge.x, edge.y) > uBorder) discard;
    // Distance travelled around the perimeter, used to space the bulbs.
    float perim = p.y < uBorder ? p.x
      : p.x > uSize.x - uBorder ? uSize.x + p.y
      : p.y > uSize.y - uBorder ? uSize.x + uSize.y + (uSize.x - p.x)
      : 2.0 * uSize.x + uSize.y + (uSize.y - p.y);
    float spacing = uBorder * 1.6;
    float speed = mix(1.5, 6.0, uHover);
    float cell = fract(perim / spacing - uTime * speed);
    vec2 local = vec2(cell * spacing - spacing * 0.5, min(edge.x, edge.y) - uBorder * 0.5);
    float bulb = smoothstep(uBorder * 0.42, uBorder * 0.15, length(local));
    float chase = 0.35 + 0.65 * step(0.5, fract(floor(perim / spacing - uTime * speed) / 3.0));
    vec3 col = uColor * (0.25 + bulb * chase * mix(2.2, 3.5, uHover));
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Billboard {
  readonly group = new THREE.Group();
  readonly screen: THREE.Mesh;
  readonly booking: Booking | null;
  readonly worldHeight: number;
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private painter: Painter;
  private frameMaterial: THREE.ShaderMaterial;
  private navLights: { material: THREE.MeshBasicMaterial; base: THREE.Color }[] = [];
  private lastPaint = -Infinity;
  private visibleFor = 0;
  private hiddenFor = Infinity;
  private counted = false;
  private faced = false;
  hovered = false;

  constructor(readonly slot: Slot, config: AdConfig) {
    this.booking = activeBooking(slot);
    const width = slot.width ?? 40;
    const height = (width * SCREEN_H) / SCREEN_W;
    this.worldHeight = height;
    const border = width * 0.035;

    this.canvas.width = SCREEN_W;
    this.canvas.height = SCREEN_H;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.painter = createPainter(config, slot, this.booking);

    this.screen = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false, color: new THREE.Color(0.92, 0.92, 0.92) }),
    );
    this.screen.position.z = 0.6;
    this.screen.userData.billboard = this;

    const fw = width + border * 2, fh = height + border * 2;
    this.frameMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uHover: { value: 0 },
        uColor: { value: new THREE.Color(TIER_COLORS[slot.tier]) },
        uSize: { value: new THREE.Vector2(fw, fh) },
        uBorder: { value: border },
      },
      vertexShader: FRAME_VERTEX,
      fragmentShader: FRAME_FRAGMENT,
      toneMapped: false,
    });
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(fw, fh), this.frameMaterial);
    frame.position.z = 0.55;

    const hull = new THREE.MeshStandardMaterial({ color: 0x1b2030, metalness: 0.8, roughness: 0.4 });
    const back = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, 1), hull);
    // A little spine and side pods so the board reads as a structure from behind too.
    const spine = new THREE.Mesh(new THREE.CylinderGeometry(border * 0.6, border * 0.6, fh * 1.25, 12), hull);
    spine.position.z = -0.5 - border * 0.6;
    this.group.add(this.screen, frame, back, spine);

    for (const [side, color] of [[-1, 0xff3344], [1, 0x33ff66]] as const) {
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(border * 0.9, border * 1.3, border * 3, 12), hull);
      pod.rotation.z = Math.PI / 2;
      pod.position.set(side * (fw / 2 + border * 1.4), 0, -0.3);
      const material = new THREE.MeshBasicMaterial({ color, toneMapped: false });
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(border * 0.55, 12, 8), material);
      bulb.position.set(side * (fw / 2 + border * 3), 0, -0.3);
      this.navLights.push({ material, base: new THREE.Color(color) });
      this.group.add(pod, bulb);
    }
  }

  get label(): string {
    return this.booking ? this.booking.advertiser : `${this.slot.name} — available`;
  }

  get href(): string {
    return this.booking ? this.booking.url : enquiryLink(this.slot);
  }

  place(elapsed: number, solar: SolarSystem, tmp: THREE.Vector3): void {
    const s = this.slot;
    if (s.anchor === 'space' || !solar.bodies.has(s.anchor)) {
      const [x, y, z] = s.position ?? [0, 0, 0];
      this.group.position.set(x, y, z);
      return;
    }
    solar.worldPosition(s.anchor, tmp);
    const angle = THREE.MathUtils.degToRad(s.phase ?? 0) + elapsed * (s.orbitSpeed ?? 0.05);
    const r = s.orbitRadius ?? 30;
    this.group.position.set(tmp.x + Math.cos(angle) * r, tmp.y + (s.height ?? 0), tmp.z + Math.sin(angle) * r);
  }

  /** Smoothly turns the screen toward the viewer, staying upright. */
  face(camera: THREE.Camera, dt: number, m: THREE.Matrix4, q: THREE.Quaternion): void {
    m.lookAt(camera.position, this.group.position, THREE.Object3D.DEFAULT_UP);
    q.setFromRotationMatrix(m);
    if (this.faced) this.group.quaternion.slerp(q, 1 - Math.exp(-dt * 2.5));
    else this.group.quaternion.copy(q);
    this.faced = true;
  }

  animate(elapsed: number, dt: number): void {
    const u = this.frameMaterial.uniforms;
    u.uTime.value = elapsed;
    u.uHover.value += ((this.hovered ? 1 : 0) - u.uHover.value) * Math.min(1, dt * 8);
    const blink = Math.sin(elapsed * 3 + this.slot.id.length) > 0.6 ? 1 : 0.08;
    for (const l of this.navLights) l.material.color.copy(l.base).multiplyScalar(blink);
  }

  paint(elapsed: number, fps: number): void {
    if (elapsed - this.lastPaint < 1 / fps) return;
    this.lastPaint = elapsed;
    this.painter(this.ctx, elapsed);
    this.texture.needsUpdate = true;
  }

  /** Returns true when this frame completes a new impression. */
  trackVisibility(visible: boolean, dt: number): boolean {
    if (!visible) {
      this.hiddenFor += dt;
      this.visibleFor = 0;
      if (this.hiddenFor > IMPRESSION_RESET_SECONDS) this.counted = false;
      return false;
    }
    this.hiddenFor = 0;
    this.visibleFor += dt;
    if (!this.counted && this.visibleFor >= IMPRESSION_SECONDS) {
      this.counted = true;
      return true;
    }
    return false;
  }
}

export class BillboardManager {
  readonly boards: Billboard[] = [];
  private readonly screens: THREE.Object3D[] = [];
  private readonly frustum = new THREE.Frustum();
  private readonly projScreen = new THREE.Matrix4();
  private readonly tmp = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly raycaster = new THREE.Raycaster();
  private readonly sphere = new THREE.Sphere();
  private readonly ray = new THREE.Ray();

  constructor(scene: THREE.Scene, config: AdConfig, readonly analytics: AdAnalytics) {
    for (const slot of config.slots) {
      const board = new Billboard(slot, config);
      this.boards.push(board);
      this.screens.push(board.screen);
      scene.add(board.group);
    }
  }

  update(elapsed: number, dt: number, camera: THREE.PerspectiveCamera, solar: SolarSystem, viewportHeight: number): void {
    camera.updateMatrixWorld();
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    const pxPerUnitAtOne = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));

    const visible: { board: Billboard; dist: number }[] = [];
    for (const board of this.boards) {
      board.place(elapsed, solar, this.tmp);
      board.face(camera, dt, this.m, this.q);
      board.animate(elapsed, dt);
      const dist = camera.position.distanceTo(board.group.position);
      this.sphere.set(board.group.position, board.worldHeight);
      const inView = this.frustum.intersectsSphere(this.sphere);
      if (inView && dist < PAINT_DISTANCE) visible.push({ board, dist });

      const onScreenPx = (board.worldHeight / Math.max(dist, 0.001)) * pxPerUnitAtOne;
      const seen = inView && onScreenPx >= IMPRESSION_MIN_PX && document.visibilityState === 'visible'
        && !this.occluded(camera.position, board.group.position, dist, solar);
      const advertiser = board.booking?.advertiser ?? null;
      if (seen) this.analytics.view(board.slot.id, advertiser, dt);
      if (board.trackVisibility(seen, dt)) this.analytics.impression(board.slot.id, advertiser);
    }

    visible.sort((a, b) => a.dist - b.dist);
    visible.forEach(({ board }, i) => board.paint(elapsed, i < FULL_RATE_BOARDS ? FULL_RATE_FPS : LOW_RATE_FPS));
  }

  /** True when a planet or the Sun sits between the viewer and the board. */
  private occluded(from: THREE.Vector3, to: THREE.Vector3, dist: number, solar: SolarSystem): boolean {
    this.ray.origin.copy(from);
    this.ray.direction.subVectors(to, from).normalize();
    for (const body of solar.bodies.values()) {
      this.sphere.center.copy(solar.worldPosition(body.id, this.tmp));
      this.sphere.radius = body.radius;
      const hit = this.ray.intersectSphere(this.sphere, this.tmp);
      if (hit && from.distanceTo(hit) < dist) return true;
    }
    return false;
  }

  /**
   * Finds the board under a normalised device coordinate (0,0 is the screen centre).
   * Occluders (planets) block the ray so you can't click an ad hidden behind Jupiter.
   */
  pick(ndc: THREE.Vector2, camera: THREE.Camera, occluders: THREE.Object3D[]): Billboard | null {
    this.raycaster.setFromCamera(ndc, camera);
    const hit = this.raycaster.intersectObjects([...this.screens, ...occluders], false)[0];
    for (const b of this.boards) b.hovered = false;
    const board = (hit?.object.userData.billboard as Billboard | undefined) ?? null;
    if (board) board.hovered = true;
    return board;
  }

  open(board: Billboard): void {
    this.analytics.click(board.slot.id, board.booking?.advertiser ?? null);
    window.open(board.href, '_blank', 'noopener');
  }
}
