// The ad inventory lives in public/ads.json so slots can be sold and swapped
// without touching code. These types document its shape.

export type Creative =
  | {
      type: 'animated';
      template: 'neon' | 'marquee' | 'pulse';
      headline: string;
      tagline?: string;
      cta?: string;
      /** [background, foreground, accent] */
      colors?: [string, string, string];
    }
  | { type: 'image'; src: string }
  /** MP4/WebM. Animated GIFs only show their first frame, so convert them to video. */
  | { type: 'video'; src: string };

export interface Booking {
  advertiser: string;
  url: string;
  creative: Creative;
  /** ISO dates. Outside this window the slot shows as available again. */
  start?: string;
  end?: string;
}

export interface Slot {
  id: string;
  name: string;
  tier: 'standard' | 'premium' | 'landmark';
  pricePerMonth: number;
  /** Body the billboard orbits ('sun', 'earth', 'jupiter', ...) or 'space' for a fixed position. */
  anchor: string;
  orbitRadius?: number;
  orbitSpeed?: number;
  /** Starting angle around the anchor, in degrees. */
  phase?: number;
  height?: number;
  position?: [number, number, number];
  /** Billboard width in world units; height follows the 16:9 screen. */
  width?: number;
  booking?: Booking | null;
}

export interface AdConfig {
  siteName: string;
  contactEmail: string;
  currency: string;
  /** Optional URL that receives impression/click batches via navigator.sendBeacon. */
  analyticsEndpoint?: string | null;
  slots: Slot[];
}

export async function loadAdConfig(): Promise<AdConfig> {
  const res = await fetch(`${import.meta.env.BASE_URL}ads.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load ads.json (${res.status})`);
  return res.json();
}

export function activeBooking(slot: Slot, now = new Date()): Booking | null {
  const b = slot.booking;
  if (!b) return null;
  if (b.start && now < new Date(b.start)) return null;
  if (b.end && now > new Date(b.end)) return null;
  return b;
}

export function formatPrice(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}

export function enquiryLink(slot: Slot): string {
  return `${import.meta.env.BASE_URL}advertise.html#${encodeURIComponent(slot.id)}`;
}
