import * as THREE from 'three';
import { cloudTexture, glowTexture, nebulaTexture, planetTexture, ringTexture, type PlanetStyle } from './textures';

// Distances and sizes are compressed so the whole system is flyable in a minute or two.
interface BodyDef {
  id: string;
  name: string;
  radius: number;
  distance: number;
  orbitSpeed: number; // radians per second
  spin: number;
  tilt: number;
  style: PlanetStyle;
  textureSize?: number;
  parent?: string;
  clouds?: boolean;
  rings?: { inner: number; outer: number };
}

const BODIES: BodyDef[] = [
  { id: 'mercury', name: 'Mercury', radius: 3, distance: 90, orbitSpeed: 0.04, spin: 0.05, tilt: 0.01, textureSize: 256,
    style: { kind: 'rocky', palette: ['#4a4744', '#7d7873', '#a8a29b', '#c9c2b8'], scale: 4, seed: 1 } },
  { id: 'venus', name: 'Venus', radius: 5, distance: 130, orbitSpeed: 0.03, spin: 0.02, tilt: 0.05, textureSize: 256,
    style: { kind: 'gas', palette: ['#b9874a', '#d9b278', '#edd5a3', '#c79a5c'], bands: 6, turbulence: 1.4, seed: 2 } },
  { id: 'earth', name: 'Earth', radius: 5.5, distance: 180, orbitSpeed: 0.024, spin: 0.12, tilt: 0.41, clouds: true,
    style: { kind: 'earth', seed: 3 } },
  { id: 'moon', name: 'The Moon', radius: 1.5, distance: 12, orbitSpeed: 0.2, spin: 0.2, tilt: 0, parent: 'earth', textureSize: 256,
    style: { kind: 'rocky', palette: ['#555555', '#8a8a8a', '#b3b3b3', '#d0d0d0'], scale: 5, seed: 4 } },
  { id: 'mars', name: 'Mars', radius: 4, distance: 230, orbitSpeed: 0.019, spin: 0.11, tilt: 0.44, textureSize: 256,
    style: { kind: 'rocky', palette: ['#5a2414', '#8f3b1f', '#c2643a', '#dc9066'], scale: 3, seed: 5 } },
  { id: 'jupiter', name: 'Jupiter', radius: 18, distance: 420, orbitSpeed: 0.01, spin: 0.25, tilt: 0.05,
    style: { kind: 'gas', palette: ['#8a5a3c', '#d6b48c', '#f1e2c8', '#b9835a', '#e8cfa6'], bands: 22, turbulence: 0.35, seed: 6,
      storm: { lat: -0.38, lon: 1.2, size: 0.22, color: '#b4472c' } } },
  { id: 'saturn', name: 'Saturn', radius: 15, distance: 580, orbitSpeed: 0.0075, spin: 0.22, tilt: 0.47,
    rings: { inner: 19, outer: 36 },
    style: { kind: 'gas', palette: ['#a88b5c', '#d9c08f', '#efe0bb', '#c9aa74'], bands: 16, turbulence: 0.25, seed: 7 } },
  { id: 'uranus', name: 'Uranus', radius: 9, distance: 740, orbitSpeed: 0.0055, spin: 0.15, tilt: 1.7, textureSize: 256,
    rings: { inner: 12, outer: 15 },
    style: { kind: 'gas', palette: ['#86c5d0', '#a6dde3', '#c5eef0', '#93cfd8'], bands: 8, turbulence: 0.15, seed: 8 } },
  { id: 'neptune', name: 'Neptune', radius: 9, distance: 880, orbitSpeed: 0.0045, spin: 0.16, tilt: 0.49, textureSize: 256,
    style: { kind: 'gas', palette: ['#1f3c8f', '#3156b8', '#4f7ad6', '#2a49a3'], bands: 10, turbulence: 0.3, seed: 9,
      storm: { lat: -0.35, lon: 2.4, size: 0.18, color: '#1a2a66' } } },
];

export const SUN_RADIUS = 40;

export interface Body {
  id: string;
  name: string;
  radius: number;
  /** Moves along the orbit; children (mesh, rings, clouds) inherit its position. */
  anchor: THREE.Object3D;
  mesh: THREE.Mesh;
  def?: BodyDef;
}

const SUN_VERTEX = /* glsl */ `
  varying vec3 vPos;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vPos = position;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
    #include <logdepthbuf_vertex>
  }
`;

const SUN_FRAGMENT = /* glsl */ `
  uniform float uTime;
  varying vec3 vPos;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  #include <logdepthbuf_pars_fragment>

  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.1; a *= 0.5; }
    return s;
  }
  void main() {
    #include <logdepthbuf_fragment>
    vec3 p = normalize(vPos) * 3.0;
    float n = fbm(p + vec3(uTime * 0.05, uTime * 0.03, 0.0));
    float n2 = fbm(p * 2.0 - vec3(0.0, uTime * 0.07, uTime * 0.04));
    float heat = n * 0.65 + n2 * 0.35;
    vec3 col = mix(vec3(1.0, 0.35, 0.05), vec3(1.0, 0.85, 0.4), smoothstep(0.35, 0.75, heat));
    col = mix(col, vec3(1.0, 1.0, 0.85), smoothstep(0.7, 0.9, heat));
    float rim = 1.0 - max(dot(vNormalW, vViewDir), 0.0);
    col += vec3(1.0, 0.5, 0.15) * pow(rim, 2.0) * 0.8;
    gl_FragColor = vec4(col * 1.6, 1.0);
  }
`;

export class SolarSystem {
  readonly group = new THREE.Group();
  readonly sky = new THREE.Group();
  readonly bodies = new Map<string, Body>();
  private sunMaterial: THREE.ShaderMaterial;
  private belt: THREE.InstancedMesh;
  private clouds: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    scene.add(this.group, this.sky);

    // --- Sun ---
    this.sunMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: SUN_VERTEX,
      fragmentShader: SUN_FRAGMENT,
      toneMapped: false,
    });
    const sun = new THREE.Mesh(new THREE.SphereGeometry(SUN_RADIUS, 64, 48), this.sunMaterial);
    const sunAnchor = new THREE.Object3D();
    sunAnchor.add(sun);
    this.group.add(sunAnchor);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture('rgba(255,220,150,0.9)', 'rgba(255,110,20,0.25)'),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }));
    glow.scale.setScalar(SUN_RADIUS * 7);
    sunAnchor.add(glow);
    this.bodies.set('sun', { id: 'sun', name: 'The Sun', radius: SUN_RADIUS, anchor: sunAnchor, mesh: sun });

    const sunLight = new THREE.PointLight(0xfff1dd, 3.2, 0, 0);
    this.group.add(sunLight);
    this.group.add(new THREE.AmbientLight(0x334466, 0.35));

    // --- Planets & moons ---
    const orbitMaterial = new THREE.LineBasicMaterial({ color: 0x5577aa, transparent: true, opacity: 0.22 });
    for (const def of BODIES) {
      const anchor = new THREE.Object3D();
      const material = new THREE.MeshStandardMaterial({
        map: planetTexture(def.style, def.textureSize ?? 512),
        roughness: 0.95,
        metalness: 0,
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(def.radius, 64, 48), material);
      mesh.rotation.z = def.tilt;
      anchor.add(mesh);

      if (def.clouds) {
        const clouds = new THREE.Mesh(
          new THREE.SphereGeometry(def.radius * 1.02, 64, 48),
          new THREE.MeshStandardMaterial({ map: cloudTexture(def.style.seed + 50), transparent: true, depthWrite: false }),
        );
        clouds.rotation.z = def.tilt;
        anchor.add(clouds);
        this.clouds.push(clouds);
        const atmosphere = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowTexture('rgba(90,160,255,0)', 'rgba(90,160,255,0.35)'),
          blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
        }));
        atmosphere.scale.setScalar(def.radius * 3.2);
        anchor.add(atmosphere);
      }

      if (def.rings) anchor.add(this.makeRings(def));

      const parent = def.parent ? this.bodies.get(def.parent)!.anchor : this.group;
      parent.add(anchor);

      parent.add(new THREE.LineLoop(this.circleGeometry(def.distance), orbitMaterial));

      this.bodies.set(def.id, { id: def.id, name: def.name, radius: def.radius, anchor, mesh, def });
    }

    this.belt = this.makeAsteroidBelt();
    this.group.add(this.belt);
    this.makeSky();
  }

  get planetIds(): string[] {
    return BODIES.filter((b) => !b.parent).map((b) => b.id);
  }

  update(elapsed: number, dt: number, cameraPosition: THREE.Vector3): void {
    this.sunMaterial.uniforms.uTime.value = elapsed;
    for (const body of this.bodies.values()) {
      const def = body.def;
      if (!def) continue;
      // Offset each planet's starting angle so they don't line up.
      const angle = elapsed * def.orbitSpeed + def.distance * 0.37;
      body.anchor.position.set(Math.cos(angle) * def.distance, 0, Math.sin(angle) * def.distance);
      body.mesh.rotation.y += def.spin * dt;
    }
    for (const c of this.clouds) c.rotation.y += 0.015 * dt;
    this.belt.rotation.y += 0.004 * dt;
    // Keep the far-away sky centred on the viewer so it behaves like it is infinitely distant.
    this.sky.position.copy(cameraPosition);
  }

  worldPosition(id: string, target: THREE.Vector3): THREE.Vector3 {
    const body = this.bodies.get(id);
    if (!body) return target.set(0, 0, 0);
    return body.anchor.getWorldPosition(target);
  }

  private circleGeometry(radius: number): THREE.BufferGeometry {
    const pts: THREE.Vector3[] = [];
    const segments = Math.max(64, Math.floor(radius));
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  }

  private makeRings(def: BodyDef): THREE.Object3D {
    const { inner, outer } = def.rings!;
    const geo = new THREE.RingGeometry(inner, outer, 128, 1);
    // RingGeometry's UVs are planar; remap so u runs from the inner to the outer edge.
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      uv.setXY(i, (v.length() - inner) / (outer - inner), 0.5);
    }
    const mat = new THREE.MeshStandardMaterial({
      map: ringTexture(),
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      roughness: 1,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    const tilted = new THREE.Group();
    tilted.rotation.z = def.tilt;
    tilted.add(ring);
    return tilted;
  }

  private makeAsteroidBelt(): THREE.InstancedMesh {
    const count = 1400;
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a7f72, roughness: 1, flatShading: true });
    const belt = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const e = new THREE.Euler();
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 285 + (Math.random() + Math.random() - 1) * 30;
      p.set(Math.cos(a) * r, (Math.random() - 0.5) * 14, Math.sin(a) * r);
      q.setFromEuler(e.set(Math.random() * 6, Math.random() * 6, Math.random() * 6));
      const size = 0.3 + Math.random() ** 3 * 2.6;
      s.set(size, size * (0.6 + Math.random() * 0.6), size * (0.7 + Math.random() * 0.5));
      belt.setMatrixAt(i, m.compose(p, q, s));
    }
    return belt;
  }

  private makeSky(): void {
    const starLayer = (count: number, size: number, radius: number) => {
      const positions = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);
      const c = new THREE.Color();
      for (let i = 0; i < count; i++) {
        const u = Math.random() * 2 - 1;
        const theta = Math.random() * Math.PI * 2;
        const r = Math.sqrt(1 - u * u);
        positions.set([r * Math.cos(theta) * radius, u * radius, r * Math.sin(theta) * radius], i * 3);
        c.setHSL(0.55 + Math.random() * 0.15 - (Math.random() < 0.2 ? 0.45 : 0), 0.5, 0.75 + Math.random() * 0.25);
        colors.set([c.r, c.g, c.b], i * 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      return new THREE.Points(geo, new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, depthWrite: false }));
    };
    this.sky.add(starLayer(9000, 1.2, 9000), starLayer(1200, 2.2, 9000), starLayer(150, 3.4, 9000));

    const nebulae: [number, number, THREE.Vector3, number][] = [
      [11, 0.75, new THREE.Vector3(-0.6, 0.35, -0.7), 5200],
      [23, 0.55, new THREE.Vector3(0.8, -0.2, 0.4), 4200],
      [37, 0.92, new THREE.Vector3(0.1, 0.8, 0.5), 3600],
      [51, 0.08, new THREE.Vector3(-0.3, -0.6, 0.75), 3000],
    ];
    for (const [seed, hue, dir, scale] of nebulae) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: nebulaTexture(seed, hue),
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }));
      sprite.position.copy(dir.normalize().multiplyScalar(8500));
      sprite.scale.setScalar(scale);
      this.sky.add(sprite);
    }
  }
}
