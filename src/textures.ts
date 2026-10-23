import * as THREE from 'three';

// Procedural textures so the whole universe ships without any image assets.

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 144269504) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = smooth(x - xi), yf = smooth(y - yi), zf = smooth(z - zi);
  const c000 = hash3(xi, yi, zi, seed), c100 = hash3(xi + 1, yi, zi, seed);
  const c010 = hash3(xi, yi + 1, zi, seed), c110 = hash3(xi + 1, yi + 1, zi, seed);
  const c001 = hash3(xi, yi, zi + 1, seed), c101 = hash3(xi + 1, yi, zi + 1, seed);
  const c011 = hash3(xi, yi + 1, zi + 1, seed), c111 = hash3(xi + 1, yi + 1, zi + 1, seed);
  return lerp(
    lerp(lerp(c000, c100, xf), lerp(c010, c110, xf), yf),
    lerp(lerp(c001, c101, xf), lerp(c011, c111, xf), yf),
    zf,
  );
}

export function fbm3(x: number, y: number, z: number, seed: number, octaves = 5): number {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise3(x * freq, y * freq, z * freq, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function samplePalette(palette: RGB[], t: number): RGB {
  const clamped = Math.min(0.9999, Math.max(0, t));
  const scaled = clamped * (palette.length - 1);
  const i = Math.floor(scaled);
  const f = scaled - i;
  const a = palette[i], b = palette[i + 1];
  return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
}

export type PlanetStyle =
  | { kind: 'rocky'; palette: string[]; scale: number; seed: number }
  | { kind: 'gas'; palette: string[]; bands: number; turbulence: number; seed: number; storm?: { lat: number; lon: number; size: number; color: string } }
  | { kind: 'earth'; seed: number };

// Paints an equirectangular texture by sampling 3D noise on the unit sphere,
// so there is no seam at the date line and no pinching at the poles.
export function planetTexture(style: PlanetStyle, width = 512): THREE.CanvasTexture {
  const height = width / 2;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(width, height);
  const palette = 'palette' in style ? style.palette.map(hexToRgb) : [];

  for (let py = 0; py < height; py++) {
    const lat = (0.5 - py / height) * Math.PI;
    const cosLat = Math.cos(lat);
    const sy = Math.sin(lat);
    for (let px = 0; px < width; px++) {
      const lon = (px / width) * Math.PI * 2;
      const sx = cosLat * Math.cos(lon);
      const sz = cosLat * Math.sin(lon);
      let rgb: RGB;

      if (style.kind === 'rocky') {
        const n = fbm3(sx * style.scale, sy * style.scale, sz * style.scale, style.seed);
        const craters = fbm3(sx * 9, sy * 9, sz * 9, style.seed + 99, 3);
        rgb = samplePalette(palette, n * 1.1 - 0.05 + (craters > 0.68 ? -0.15 : 0));
      } else if (style.kind === 'gas') {
        const warp = fbm3(sx * 2.2, sy * 2.2, sz * 2.2, style.seed, 4) * style.turbulence;
        const band = 0.5 + 0.5 * Math.sin((sy + warp) * style.bands);
        const detail = fbm3(sx * 6, sy * 18, sz * 6, style.seed + 3, 3);
        rgb = samplePalette(palette, band * 0.8 + detail * 0.2);
        if (style.storm) {
          const dLat = lat - style.storm.lat;
          const dLon = Math.atan2(Math.sin(lon - style.storm.lon), Math.cos(lon - style.storm.lon));
          const d = Math.sqrt((dLat * 2.2) ** 2 + dLon ** 2) / style.storm.size;
          if (d < 1) {
            const s = hexToRgb(style.storm.color);
            const k = smooth(1 - d);
            rgb = [lerp(rgb[0], s[0], k), lerp(rgb[1], s[1], k), lerp(rgb[2], s[2], k)];
          }
        }
      } else {
        const n = fbm3(sx * 1.8, sy * 1.8, sz * 1.8, style.seed, 6);
        const ice = Math.abs(sy) > 0.82 + (n - 0.5) * 0.2;
        if (ice) rgb = [235, 242, 250];
        else if (n > 0.53) {
          const h = (n - 0.53) / 0.47;
          rgb = h > 0.35 ? [128, 110, 82] : samplePalette([[54, 110, 52], [92, 128, 64], [140, 124, 80]], h / 0.35);
        } else {
          const depth = n / 0.53;
          rgb = samplePalette([[8, 28, 82], [18, 64, 140], [40, 110, 170]], depth);
        }
      }

      const i = (py * width + px) * 4;
      img.data[i] = rgb[0];
      img.data[i + 1] = rgb[1];
      img.data[i + 2] = rgb[2];
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function cloudTexture(seed: number, width = 512): THREE.CanvasTexture {
  const height = width / 2;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(width, height);
  for (let py = 0; py < height; py++) {
    const lat = (0.5 - py / height) * Math.PI;
    const cosLat = Math.cos(lat);
    const sy = Math.sin(lat);
    for (let px = 0; px < width; px++) {
      const lon = (px / width) * Math.PI * 2;
      const n = fbm3(cosLat * Math.cos(lon) * 3, sy * 3, cosLat * Math.sin(lon) * 3, seed, 5);
      const a = Math.max(0, (n - 0.5) * 3.2);
      const i = (py * width + px) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.min(255, a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function ringTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 4;
  const ctx = canvas.getContext('2d')!;
  for (let x = 0; x < 512; x++) {
    const t = x / 512;
    const n = fbm3(t * 40, 0.5, 0.5, 7, 4);
    const gap = t > 0.62 && t < 0.67 ? 0.1 : 1;
    const edge = Math.min(1, t * 8, (1 - t) * 6);
    const alpha = Math.max(0, (0.25 + n * 0.85) * gap * edge);
    const c = 180 + n * 60;
    ctx.fillStyle = `rgba(${c | 0},${(c * 0.9) | 0},${(c * 0.75) | 0},${alpha.toFixed(3)})`;
    ctx.fillRect(x, 0, 1, 4);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function glowTexture(inner: string, outer: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, inner);
  g.addColorStop(0.2, inner);
  g.addColorStop(0.45, outer);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function nebulaTexture(seed: number, hue: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const color = new THREE.Color().setHSL(hue, 0.7, 0.55);
  const color2 = new THREE.Color().setHSL((hue + 0.12) % 1, 0.8, 0.6);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size - 0.5, v = y / size - 0.5;
      const r = Math.sqrt(u * u + v * v) * 2;
      const n = fbm3(u * 4, v * 4, seed, seed, 6);
      const falloff = Math.max(0, 1 - r) ** 1.6;
      const a = Math.max(0, n - 0.38) * 2.2 * falloff;
      const mix = fbm3(u * 3 + 10, v * 3, seed, seed + 5, 3);
      const i = (y * size + x) * 4;
      img.data[i] = (lerp(color.r, color2.r, mix) * 255) | 0;
      img.data[i + 1] = (lerp(color.g, color2.g, mix) * 255) | 0;
      img.data[i + 2] = (lerp(color.b, color2.b, mix) * 255) | 0;
      img.data[i + 3] = Math.min(255, a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
