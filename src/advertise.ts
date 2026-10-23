import { activeBooking, formatPrice, loadAdConfig, type Slot } from './ads';
import { createPainter, SCREEN_H, SCREEN_W } from './creatives';
import './advertise.css';

const ANCHOR_NAMES: Record<string, string> = {
  space: 'Deep space', sun: 'The Sun', mercury: 'Mercury', venus: 'Venus', earth: 'Earth', moon: 'The Moon',
  mars: 'Mars', jupiter: 'Jupiter', saturn: 'Saturn', uranus: 'Uranus', neptune: 'Neptune',
};
const TIERS: Slot['tier'][] = ['landmark', 'premium', 'standard'];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

async function start(): Promise<void> {
  const config = await loadAdConfig();
  document.title = `Advertise — ${config.siteName}`;
  for (const n of document.querySelectorAll('[data-site-name]')) n.textContent = config.siteName;

  const container = document.getElementById('slots')!;
  const previews: { canvas: HTMLCanvasElement; paint: (t: number) => void; visible: boolean }[] = [];
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const p = previews.find((x) => x.canvas === entry.target);
      if (p) p.visible = entry.isIntersecting;
    }
  });

  const slots = [...config.slots].sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) || b.pricePerMonth - a.pricePerMonth);
  const cards: { card: HTMLElement; slot: Slot; available: boolean }[] = [];

  for (const slot of slots) {
    const booking = activeBooking(slot);
    const card = el('article', `slot tier-${slot.tier}${booking ? ' booked' : ''}`);
    card.id = slot.id;

    const canvas = el('canvas');
    canvas.width = SCREEN_W;
    canvas.height = SCREEN_H;
    const ctx = canvas.getContext('2d')!;
    const painter = createPainter(config, slot, booking);
    previews.push({ canvas, paint: (t) => painter(ctx, t), visible: false });
    observer.observe(canvas);

    const body = el('div', 'body');
    const top = el('div', 'top');
    top.append(el('span', 'tier', slot.tier), el('span', `status ${booking ? 'is-booked' : 'is-free'}`, booking ? 'Booked' : 'Available'));
    body.append(top, el('h3', '', slot.name));
    const meta = el('p', 'meta', `${ANCHOR_NAMES[slot.anchor] ?? slot.anchor} · ${slot.id} · ${slot.width ?? 40}u wide`);
    body.append(meta);
    if (booking) {
      const until = booking.end ? ` until ${new Date(booking.end).toLocaleDateString()}` : '';
      body.append(el('p', 'meta', `Currently: ${booking.advertiser}${until}`));
    }
    const footer = el('div', 'footer');
    const price = el('div', 'price');
    price.append(el('strong', '', formatPrice(slot.pricePerMonth, config.currency)), el('span', '', ' / month'));
    const subject = encodeURIComponent(`Ad slot enquiry: ${slot.id} (${slot.name})`);
    const mailBody = encodeURIComponent(
      `Hi,\n\nI'm interested in the ${slot.name} slot (${slot.id}).\n\nCompany:\nWebsite:\nPreferred start date:\nDuration (months):\n`,
    );
    const btn = el('a', 'enquire', booking ? 'Join waitlist' : 'Enquire');
    btn.href = `mailto:${config.contactEmail}?subject=${subject}&body=${mailBody}`;
    footer.append(price, btn);
    body.append(footer);
    card.append(canvas, body);
    container.append(card);
    cards.push({ card, slot, available: !booking });
  }

  // Filters
  const filters = document.getElementById('filters')!;
  const options: [string, (c: (typeof cards)[number]) => boolean][] = [
    ['All', () => true],
    ['Available', (c) => c.available],
    ...TIERS.map((t) => [t[0].toUpperCase() + t.slice(1), (c: (typeof cards)[number]) => c.slot.tier === t] as [string, (c: (typeof cards)[number]) => boolean]),
  ];
  for (const [label, test] of options) {
    const b = el('button', label === 'All' ? 'active' : '', label);
    b.addEventListener('click', () => {
      filters.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      for (const c of cards) c.card.hidden = !test(c);
    });
    filters.append(b);
  }

  // Deep links from in-world "click to enquire" land on the matching slot.
  const highlight = () => {
    const id = decodeURIComponent(location.hash.slice(1));
    const target = id && document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('highlight');
  };
  window.addEventListener('hashchange', highlight);
  highlight();

  let last = 0;
  const loop = (now: number) => {
    if (now - last > 1000 / 20) {
      last = now;
      for (const p of previews) if (p.visible) p.paint(now / 1000);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

start().catch((err) => {
  document.getElementById('slots')!.textContent = `Could not load ad slots: ${err instanceof Error ? err.message : err}`;
});
