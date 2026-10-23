// Counts billboard impressions, view time and clicks: the numbers you quote to advertisers.
// If ads.json sets analyticsEndpoint, batches are POSTed there as JSON via sendBeacon.

export interface SlotStats {
  impressions: number;
  clicks: number;
  viewSeconds: number;
}

interface AdEvent {
  type: 'impression' | 'click' | 'view';
  slotId: string;
  advertiser: string | null;
  seconds?: number;
  at: string;
}

export class AdAnalytics {
  readonly totals: Record<string, SlotStats> = {};
  private queue: AdEvent[] = [];
  private pendingView: Record<string, { advertiser: string | null; seconds: number }> = {};
  private readonly session = crypto.randomUUID?.() ?? String(Math.random()).slice(2);

  constructor(private endpoint: string | null | undefined) {
    setInterval(() => this.flush(), 15000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush();
    });
    (window as unknown as { adStats: Record<string, SlotStats> }).adStats = this.totals;
  }

  private stats(slotId: string): SlotStats {
    return (this.totals[slotId] ??= { impressions: 0, clicks: 0, viewSeconds: 0 });
  }

  impression(slotId: string, advertiser: string | null): void {
    this.stats(slotId).impressions++;
    this.queue.push({ type: 'impression', slotId, advertiser, at: new Date().toISOString() });
  }

  click(slotId: string, advertiser: string | null): void {
    this.stats(slotId).clicks++;
    this.queue.push({ type: 'click', slotId, advertiser, at: new Date().toISOString() });
    this.flush();
  }

  view(slotId: string, advertiser: string | null, seconds: number): void {
    this.stats(slotId).viewSeconds += seconds;
    const p = (this.pendingView[slotId] ??= { advertiser, seconds: 0 });
    p.seconds += seconds;
  }

  flush(): void {
    const at = new Date().toISOString();
    for (const [slotId, p] of Object.entries(this.pendingView)) {
      if (p.seconds > 0.05) this.queue.push({ type: 'view', slotId, advertiser: p.advertiser, seconds: +p.seconds.toFixed(2), at });
    }
    this.pendingView = {};
    if (!this.queue.length) return;
    const events = this.queue;
    this.queue = [];
    if (!this.endpoint) {
      console.debug('[ad analytics]', events);
      return;
    }
    const body = JSON.stringify({ session: this.session, events });
    if (!navigator.sendBeacon?.(this.endpoint, new Blob([body], { type: 'application/json' }))) {
      void fetch(this.endpoint, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(() => {});
    }
  }
}
