import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { loadAdConfig } from './ads';
import { AdAnalytics } from './analytics';
import { BillboardManager, type Billboard } from './billboards';
import { FlightControls } from './flight';
import { SolarSystem } from './solarSystem';
import './style.css';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

async function start(): Promise<void> {
  const config = await loadAdConfig();
  document.title = `${config.siteName} — fly the ad-verse`;
  for (const el of document.querySelectorAll('[data-site-name]')) el.textContent = config.siteName;

  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  $('app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x01020a);
  const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.3, 30000);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.75, 0.5, 0.82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const solar = new SolarSystem(scene);
  const analytics = new AdAnalytics(config.analyticsEndpoint);
  const billboards = new BillboardManager(scene, config, analytics);
  const flight = new FlightControls(camera, renderer.domElement);
  const occluders = [...solar.bodies.values()].map((b) => b.mesh);

  // Start on Earth's sunlit side, a little off-axis so the Sun isn't straight behind it.
  solar.update(0, 0, camera.position);
  const earth = solar.worldPosition('earth', new THREE.Vector3());
  const toSun = earth.clone().negate().normalize();
  const tangent = new THREE.Vector3(-toSun.z, 0, toSun.x);
  camera.position.copy(earth).addScaledVector(toSun, 50).addScaledVector(tangent, 30).add(new THREE.Vector3(0, 12, 0));
  camera.lookAt(earth);

  // --- Navigation / warps ---
  const bodyTarget = (id: string) => () => {
    const body = solar.bodies.get(id)!;
    const center = solar.worldPosition(id, new THREE.Vector3());
    const standoff = body.radius * (id === 'sun' ? 4.5 : 4) + 12;
    // Approach from the sunlit side so the planet isn't a black disc.
    const dir = id === 'sun' ? camera.position.clone().normalize() : center.clone().negate().normalize();
    if (dir.lengthSq() === 0) dir.set(0, 0, 1);
    // Arrive from above the orbital plane so rings aren't edge-on.
    const position = center.clone().addScaledVector(dir, standoff).add(new THREE.Vector3(0, standoff * 0.4, 0));
    return { position, lookAt: center };
  };
  const boardTarget = (board: Billboard) => {
    const approach = camera.position.clone().sub(board.group.position).setY(0).normalize();
    if (approach.lengthSq() === 0) approach.set(0, 0, 1);
    return () => ({
      position: board.group.position.clone().addScaledVector(approach, board.worldHeight * 2.4),
      lookAt: board.group.position.clone(),
    });
  };
  const bodyOrder = ['sun', ...solar.planetIds];
  let nextBoard = 0;
  const warpToNextAd = () => {
    const board = billboards.boards[nextBoard++ % billboards.boards.length];
    flight.flyTo(boardTarget(board));
    flash(`Warping to ${board.label}`);
  };
  const warpToBody = (id: string) => {
    flight.flyTo(bodyTarget(id));
    flash(`Warping to ${solar.bodies.get(id)!.name}`);
  };

  const nav = $('nav');
  const adBtn = document.createElement('button');
  adBtn.className = 'accent';
  adBtn.innerHTML = '<kbd>Tab</kbd>Next ad';
  adBtn.addEventListener('click', warpToNextAd);
  nav.appendChild(adBtn);
  bodyOrder.forEach((id, i) => {
    const btn = document.createElement('button');
    btn.innerHTML = `<kbd>${i}</kbd>${solar.bodies.get(id)!.name.replace('The ', '')}`;
    btn.addEventListener('click', () => warpToBody(id));
    nav.appendChild(btn);
  });

  window.addEventListener('keydown', (e) => {
    const digit = /^Digit(\d)$/.exec(e.code);
    if (digit && +digit[1] < bodyOrder.length) warpToBody(bodyOrder[+digit[1]]);
    if (e.code === 'Tab') {
      e.preventDefault();
      warpToNextAd();
    }
    if (e.code === 'KeyH') $('help').classList.toggle('hidden');
  });

  // --- Pointer / clicking ---
  const mouse = new THREE.Vector2(9, 9); // off-screen until the mouse moves
  const center = new THREE.Vector2(0, 0);
  const toNdc = (x: number, y: number, out: THREE.Vector2) => out.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  renderer.domElement.addEventListener('mousemove', (e) => toNdc(e.clientX, e.clientY, mouse));
  renderer.domElement.addEventListener('mouseleave', () => mouse.set(9, 9));
  renderer.domElement.addEventListener('click', (e) => {
    const board = billboards.pick(flight.locked ? center : toNdc(e.clientX, e.clientY, new THREE.Vector2()), camera, occluders);
    if (board) {
      if (flight.locked) document.exitPointerLock();
      billboards.open(board);
    } else if (!flight.locked && !e.shiftKey) {
      flight.lock();
    }
  });
  flight.onTap = (x, y) => {
    const board = billboards.pick(toNdc(x, y, new THREE.Vector2()), camera, occluders);
    if (board) billboards.open(board);
  };
  const isTouch = matchMedia('(pointer: coarse)').matches;
  document.body.classList.toggle('touch', isTouch);
  const boostBtn = $('boost');
  boostBtn.addEventListener('touchstart', (e) => { e.preventDefault(); flight.setTouchBoost(true); });
  boostBtn.addEventListener('touchend', () => flight.setTouchBoost(false));

  document.addEventListener('pointerlockchange', () => {
    document.body.classList.toggle('locked', document.pointerLockElement === renderer.domElement);
  });

  $('launch').addEventListener('click', () => {
    $('intro').classList.add('hidden');
    if (!isTouch) flight.lock();
  });

  // --- HUD ---
  const speedEl = $('speed');
  const locationEl = $('location');
  const targetEl = $('target');
  const crosshair = $('crosshair');
  const labelsEl = $('labels');
  const labels = new Map<string, HTMLElement>();
  for (const body of solar.bodies.values()) {
    const el = document.createElement('div');
    el.className = 'label';
    el.textContent = body.name;
    labelsEl.appendChild(el);
    labels.set(body.id, el);
  }
  let flashTimer = 0;
  function flash(text: string) {
    const el = $('flash');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => el.classList.remove('show'), 2200);
  }

  const tmp = new THREE.Vector3();
  const projected = new THREE.Vector3();
  function updateHud(hovered: Billboard | null) {
    speedEl.textContent = `${Math.round(flight.speed * 1000).toLocaleString()} km/s`;
    let nearest = '';
    let nearestDist = Infinity;
    for (const body of solar.bodies.values()) {
      solar.worldPosition(body.id, tmp);
      const dist = camera.position.distanceTo(tmp) - body.radius;
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = body.name;
      }
      const el = labels.get(body.id)!;
      projected.copy(tmp).project(camera);
      const maxDist = body.def?.parent ? 250 : Infinity; // moons only label up close
      const show = projected.z < 1 && dist > body.radius * 2 && dist < maxDist && Math.abs(projected.x) < 1.1 && Math.abs(projected.y) < 1.1;
      el.style.display = show ? '' : 'none';
      if (show) {
        const x = (projected.x * 0.5 + 0.5) * window.innerWidth;
        const y = (-projected.y * 0.5 + 0.5) * window.innerHeight;
        el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -150%)`;
        el.style.opacity = String(THREE.MathUtils.clamp(1.6 - dist / 900, 0.35, 1));
      }
    }
    locationEl.textContent = `Near ${nearest} · ${Math.max(0, Math.round(nearestDist * 1e5)).toLocaleString()} km`;

    crosshair.classList.toggle('on-target', !!hovered);
    if (hovered) {
      targetEl.innerHTML = hovered.booking
        ? `<strong>${escapeHtml(hovered.booking.advertiser)}</strong><span>Click to visit</span>`
        : `<strong>Ad space available</strong><span>${escapeHtml(hovered.slot.name)} · click to enquire</span>`;
      targetEl.classList.add('show');
    } else {
      targetEl.classList.remove('show');
    }
    renderer.domElement.style.cursor = hovered && !flight.locked ? 'pointer' : '';
  }

  // --- Loop ---
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
  });

  const clock = new THREE.Clock();
  let elapsed = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    elapsed += dt;
    solar.update(elapsed, dt, camera.position);
    flight.update(dt);
    for (const body of solar.bodies.values()) {
      flight.collide(solar.worldPosition(body.id, tmp), body.radius * 1.15 + 1.5);
    }
    billboards.update(elapsed, dt, camera, solar, window.innerHeight);
    const hovered = billboards.pick(flight.locked ? center : mouse, camera, occluders);
    updateHud(hovered);
    composer.render();
  });

  $('loading').classList.add('hidden');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

start().catch((err) => {
  console.error(err);
  $('loading').textContent = `Failed to start: ${err instanceof Error ? err.message : err}`;
});
