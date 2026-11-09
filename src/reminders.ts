import { App, Notice, Platform } from "obsidian";
import type { EventStore } from "./store";

const STORE_KEY = "mark-calendar-fired";

export class Reminders {
  private timer: number | null = null;
  private fired: Record<string, number>;

  constructor(
    private app: App,
    private store: EventStore,
    private opts: () => { enabled: boolean; minutes: number },
    private register: (id: number) => void,
  ) {
    try { this.fired = JSON.parse(window.localStorage.getItem(this.storageKey()) ?? "{}"); } catch { this.fired = {}; }
  }

  private storageKey(): string {
    return `${STORE_KEY}:${this.app.vault.getName()}`;
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => this.tick(), 30_000);
    this.register(this.timer);
    window.setTimeout(() => this.tick(), 5_000);
  }

  private async tick(): Promise<void> {
    const o = this.opts();
    if (!o.enabled) return;
    const now = Date.now();
    // Round the window so the store cache key stays stable between ticks.
    const from = new Date(Math.floor(now / 3_600_000) * 3_600_000 - 3_600_000);
    const to = new Date(from.getTime() + 26 * 3_600_000);
    let events;
    try { events = await this.store.range(from, to); } catch { return; }

    for (const ev of events) {
      if (ev.allDay) continue;
      const startMs = ev.start.getTime();
      if (startMs <= now) continue;
      const g = ev.g;
      const mins = g.reminders && !g.reminders.useDefault
        ? (g.reminders.overrides ?? []).filter((r) => r.method === "popup").map((r) => r.minutes)
        : [o.minutes];
      for (const m of mins) {
        const at = startMs - m * 60_000;
        const k = `${ev.key}@${startMs}@${m}`;
        if (now >= at && !this.fired[k]) {
          this.fired[k] = startMs;
          this.notify(g.summary ?? "Подія", Math.round((startMs - now) / 60_000), g.location);
        }
      }
    }
    for (const [k, t] of Object.entries(this.fired)) if (t < now - 86_400_000) delete this.fired[k];
    try { window.localStorage.setItem(this.storageKey(), JSON.stringify(this.fired)); } catch { /* storage unavailable */ }
  }

  private notify(title: string, inMin: number, location?: string): void {
    const when = inMin <= 0 ? "зараз" : `через ${inMin} хв`;
    const body = location ? `${when} · ${location}` : when;
    new Notice(`🔔 ${title} — ${body}`, 15_000);
    if (Platform.isDesktopApp && "Notification" in window) {
      const show = () => new Notification(title, { body, silent: false });
      if (Notification.permission === "granted") show();
      else if (Notification.permission !== "denied") Notification.requestPermission().then((p) => p === "granted" && show());
    }
  }
}
