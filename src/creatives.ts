import { formatPrice, type AdConfig, type Booking, type Slot } from './ads';

export const SCREEN_W = 1024;
export const SCREEN_H = 576;

/** Draws one frame of a billboard's creative onto its canvas. */
export type Painter = (ctx: CanvasRenderingContext2D, t: number) => void;

const FONT = '"Inter", "Segoe UI", system-ui, sans-serif';

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, size: number, weight = 800): number {
  let s = size;
  do {
    ctx.font = `${weight} ${s}px ${FONT}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    s -= 4;
  } while (s > 16);
  return s;
}

function glowText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, blur: number) {
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
}

function scanlines(ctx: CanvasRenderingContext2D, t: number) {
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y = (t * 40) % 6; y < SCREEN_H; y += 6) ctx.fillRect(0, y, SCREEN_W, 2);
  // A slow bright sweep sells the "screen in space" look.
  const sweep = ((t * 0.25) % 1.4) * SCREEN_H * 1.2 - SCREEN_H * 0.2;
  const g = ctx.createLinearGradient(0, sweep - 60, 0, sweep + 60);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.07)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, sweep - 60, SCREEN_W, 120);
}

function animatedPainter(booking: Booking): Painter {
  const c = booking.creative;
  if (c.type !== 'animated') throw new Error('not animated');
  const [bg, fg, accent] = c.colors ?? ['#0b0820', '#ffffff', '#ff3df2'];
  const cx = SCREEN_W / 2;

  if (c.template === 'marquee') {
    return (ctx, t) => {
      const g = ctx.createLinearGradient(0, 0, SCREEN_W, SCREEN_H);
      g.addColorStop(0, bg);
      g.addColorStop(0.5 + Math.sin(t * 0.7) * 0.3, accent);
      g.addColorStop(1, bg);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const size = fitText(ctx, c.headline, SCREEN_W * 0.88, 130);
      ctx.font = `900 ${size}px ${FONT}`;
      glowText(ctx, c.headline, cx, SCREEN_H * 0.4 + Math.sin(t * 2) * 6, fg, 30);
      // Scrolling ticker along the bottom.
      const ticker = `${c.tagline ?? ''}   ★   ${c.cta ?? booking.advertiser}   ★   `;
      ctx.font = `700 44px ${FONT}`;
      const w = ctx.measureText(ticker).width;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, SCREEN_H - 110, SCREEN_W, 80);
      ctx.fillStyle = fg;
      ctx.textAlign = 'left';
      const offset = -((t * 160) % w);
      for (let x = offset; x < SCREEN_W; x += w) ctx.fillText(ticker, x, SCREEN_H - 70);
      scanlines(ctx, t);
    };
  }

  if (c.template === 'pulse') {
    return (ctx, t) => {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
      for (let i = 0; i < 6; i++) {
        const r = ((t * 120 + i * 90) % 540) + 10;
        ctx.strokeStyle = accent;
        ctx.globalAlpha = Math.max(0, 1 - r / 540) * 0.7;
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.arc(SCREEN_W * 0.22, SCREEN_H / 2, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const beat = 1 + Math.max(0, Math.sin(t * 4)) ** 8 * 0.12;
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(SCREEN_W * 0.22, SCREEN_H / 2, 95 * beat, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = bg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `900 92px ${FONT}`;
      ctx.fillText(booking.advertiser.slice(0, 1).toUpperCase(), SCREEN_W * 0.22, SCREEN_H / 2 + 4);
      ctx.textAlign = 'left';
      const left = SCREEN_W * 0.42;
      const size = fitText(ctx, c.headline, SCREEN_W * 0.54, 96);
      ctx.font = `900 ${size}px ${FONT}`;
      glowText(ctx, c.headline, left, SCREEN_H * 0.4, fg, 18);
      if (c.tagline) {
        ctx.font = `500 ${fitText(ctx, c.tagline, SCREEN_W * 0.54, 40, 500)}px ${FONT}`;
        ctx.fillStyle = fg;
        ctx.globalAlpha = 0.85;
        ctx.fillText(c.tagline, left, SCREEN_H * 0.56);
        ctx.globalAlpha = 1;
      }
      if (c.cta) {
        ctx.font = `800 34px ${FONT}`;
        const w = ctx.measureText(c.cta).width + 48;
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.75 + Math.sin(t * 3) * 0.25;
        ctx.fillRect(left, SCREEN_H * 0.67, w, 60);
        ctx.globalAlpha = 1;
        ctx.fillStyle = bg;
        ctx.fillText(c.cta, left + 24, SCREEN_H * 0.67 + 32);
      }
      scanlines(ctx, t);
    };
  }

  // 'neon'
  return (ctx, t) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    // Perspective grid floor.
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 2;
    const horizon = SCREEN_H * 0.62;
    for (let i = 0; i < 12; i++) {
      const y = horizon + ((i + ((t * 0.8) % 1)) / 12) ** 2 * (SCREEN_H - horizon);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(SCREEN_W, y);
      ctx.stroke();
    }
    for (let i = -10; i <= 10; i++) {
      ctx.beginPath();
      ctx.moveTo(cx + i * 30, horizon);
      ctx.lineTo(cx + i * 160, SCREEN_H);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Occasional neon flicker.
    const flicker = Math.sin(t * 37) > 0.97 || Math.sin(t * 13.3) > 0.985 ? 0.35 : 1;
    ctx.globalAlpha = flicker;
    const size = fitText(ctx, c.headline, SCREEN_W * 0.86, 120);
    ctx.font = `900 ${size}px ${FONT}`;
    glowText(ctx, c.headline, cx, SCREEN_H * 0.3, accent, 40);
    glowText(ctx, c.headline, cx, SCREEN_H * 0.3, fg, 8);
    ctx.globalAlpha = 1;
    if (c.tagline) {
      ctx.font = `600 ${fitText(ctx, c.tagline, SCREEN_W * 0.8, 44, 600)}px ${FONT}`;
      glowText(ctx, c.tagline, cx, SCREEN_H * 0.5, fg, 10);
    }
    if (c.cta) {
      ctx.font = `800 32px ${FONT}`;
      glowText(ctx, c.cta.toUpperCase(), cx, SCREEN_H * 0.88, accent, 16 + Math.sin(t * 4) * 10);
    }
    scanlines(ctx, t);
  };
}

function mediaPainter(source: CanvasImageSource, ready: () => boolean, fit: () => [number, number]): Painter {
  return (ctx, t) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    if (ready()) {
      // "Cover" fit so any aspect ratio fills the screen.
      const [w, h] = fit();
      const scale = Math.max(SCREEN_W / w, SCREEN_H / h);
      ctx.drawImage(source, (SCREEN_W - w * scale) / 2, (SCREEN_H - h * scale) / 2, w * scale, h * scale);
    }
    scanlines(ctx, t);
  };
}

export function availablePainter(config: AdConfig, slot: Slot): Painter {
  const price = `from ${formatPrice(slot.pricePerMonth, config.currency)} / month`;
  const tierColor = slot.tier === 'landmark' ? '#ffd23d' : slot.tier === 'premium' ? '#3dffd8' : '#7aa7ff';
  return (ctx, t) => {
    ctx.fillStyle = '#05060f';
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    // Moving hazard stripes top and bottom.
    ctx.fillStyle = tierColor;
    for (const y of [0, SCREEN_H - 40]) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, y, SCREEN_W, 40);
      ctx.clip();
      for (let x = -80 + ((t * 60) % 80); x < SCREEN_W + 80; x += 80) {
        ctx.beginPath();
        ctx.moveTo(x, y + 40);
        ctx.lineTo(x + 40, y);
        ctx.lineTo(x + 80, y);
        ctx.lineTo(x + 40, y + 40);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 30px ${FONT}`;
    ctx.fillStyle = tierColor;
    ctx.fillText(`${slot.tier.toUpperCase()} SLOT · ${slot.id}`, SCREEN_W / 2, 100);
    const pulse = 0.6 + 0.4 * Math.sin(t * 3);
    ctx.globalAlpha = 0.6 + pulse * 0.4;
    ctx.font = `900 ${fitText(ctx, 'YOUR AD HERE', SCREEN_W * 0.85, 128)}px ${FONT}`;
    glowText(ctx, 'YOUR AD HERE', SCREEN_W / 2, 220, '#ffffff', 20 + pulse * 25);
    ctx.globalAlpha = 1;
    ctx.font = `600 40px ${FONT}`;
    ctx.fillStyle = '#d9e2ff';
    ctx.fillText(slot.name, SCREEN_W / 2, 320);
    ctx.font = `800 46px ${FONT}`;
    glowText(ctx, price, SCREEN_W / 2, 395, tierColor, 14);
    ctx.font = `500 30px ${FONT}`;
    ctx.fillStyle = '#9aa6c8';
    ctx.fillText(`Click to enquire · ${config.contactEmail}`, SCREEN_W / 2, 470);
    scanlines(ctx, t);
  };
}

export function createPainter(config: AdConfig, slot: Slot, booking: Booking | null): Painter {
  if (!booking) return availablePainter(config, slot);
  const c = booking.creative;
  if (c.type === 'animated') return animatedPainter(booking);
  if (c.type === 'image') {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = c.src;
    return mediaPainter(img, () => img.complete && img.naturalWidth > 0, () => [img.naturalWidth, img.naturalHeight]);
  }
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.src = c.src;
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = 'auto';
  void video.play().catch(() => {
    // Autoplay can be blocked until the first user gesture; retry then.
    window.addEventListener('pointerdown', () => void video.play(), { once: true });
  });
  return mediaPainter(video, () => video.readyState >= 2, () => [video.videoWidth, video.videoHeight]);
}
