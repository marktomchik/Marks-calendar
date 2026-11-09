import type { GEvent, GoogleClient } from "./google";
import type { CalendarInfo } from "./settings";

export interface CalEvent {
  key: string; // `${calendarId}::${event.id}`
  calendarId: string;
  g: GEvent;
  start: Date;
  end: Date;
  allDay: boolean;
}

interface CacheEntry { at: number; events: CalEvent[]; pending?: Promise<CalEvent[]> }

const TTL = 4 * 60_000;

export function toCalEvent(calendarId: string, g: GEvent): CalEvent {
  const allDay = !!g.start.date;
  const start = allDay ? localDate(g.start.date!) : new Date(g.start.dateTime!);
  const end = allDay ? localDate(g.end.date ?? g.start.date!) : new Date(g.end.dateTime ?? g.start.dateTime!);
  return { key: `${calendarId}::${g.id}`, calendarId, g, start, end, allDay };
}

/** Parse "YYYY-MM-DD" as local midnight. */
export function localDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Fetches events per (calendar, range) with a short TTL cache, so switching views
 * and reminder checks don't hammer the API. Any write clears the cache.
 */
export class EventStore {
  private cache = new Map<string, CacheEntry>();
  private listeners = new Set<() => void>();
  lastError: string | null = null;

  constructor(private google: GoogleClient, private calendars: () => CalendarInfo[]) {}

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  invalidate(notify = true): void {
    this.cache.clear();
    if (notify) this.listeners.forEach((f) => f());
  }

  async range(start: Date, end: Date, force = false): Promise<CalEvent[]> {
    if (!this.google.connected) return [];
    const cals = this.calendars().filter((c) => c.enabled);
    const parts = await Promise.all(cals.map((c) => this.rangeFor(c.id, start, end, force).catch((e) => {
      this.lastError = String(e.message ?? e);
      console.warn("[mark-calendar]", c.name, e);
      return [] as CalEvent[];
    })));
    return parts.flat();
  }

  private rangeFor(calId: string, start: Date, end: Date, force: boolean): Promise<CalEvent[]> {
    const k = `${calId}|${start.getTime()}|${end.getTime()}`;
    const hit = this.cache.get(k);
    if (hit?.pending) return hit.pending;
    if (hit && !force && Date.now() - hit.at < TTL) return Promise.resolve(hit.events);
    const pending = this.google.listEvents(calId, start, end).then((list) => {
      const events = list.map((g) => toCalEvent(calId, g));
      this.cache.set(k, { at: Date.now(), events });
      this.lastError = null;
      return events;
    });
    this.cache.set(k, { at: hit?.at ?? 0, events: hit?.events ?? [], pending });
    pending.catch(() => this.cache.delete(k));
    return pending;
  }
}
