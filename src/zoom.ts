import type { Calendar } from "@fullcalendar/core";

/** Limits for the vertical (time) zoom of week / 3-day / day views. 1 = default height. */
export const ZOOM_MIN = 0.3;
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 1.25;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface ZoomOptions {
  /** Element that receives the `--mc-zoom` CSS variable. */
  host: HTMLElement;
  /** FullCalendar container (wheel events are captured here). */
  calEl: HTMLElement;
  getCalendar: () => Calendar | null;
  get: () => number;
  /** Called on every change; persist (debounced) on the caller side. */
  set: (zoom: number) => void;
}

/**
 * Vertical zoom of the time grid: Ctrl/Cmd + scroll, Shift + scroll or a trackpad pinch.
 * Keeps the time under the cursor in place while zooming.
 */
export class TimeZoom {
  private factor = 1;
  private anchorY: number | null = null;
  private raf = 0;
  private badge: HTMLElement;
  private badgeTimer = 0;
  private tick = 0;

  constructor(private o: ZoomOptions) {
    this.badge = o.calEl.ownerDocument.createElement("div");
    this.badge.className = "mc-zoom-badge";
    o.calEl.appendChild(this.badge);
    this.apply(o.get());
  }

  /** Wheel handler — register with `{ passive: false }`. */
  onWheel = (e: WheelEvent): void => {
    if (!(e.ctrlKey || e.metaKey || e.shiftKey) || !this.isTimeGrid()) return;
    e.preventDefault();
    e.stopPropagation();
    // Shift+wheel is turned into horizontal scrolling by the OS, so read whichever axis moved.
    let d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (e.deltaMode === 1) d *= 16;
    else if (e.deltaMode === 2) d *= 400;
    // Trackpads (and pinch) send many small deltas; a mouse wheel sends ~100 per notch.
    const k = Math.abs(d) < 50 ? 0.01 : 0.0025;
    this.factor *= Math.exp(-clamp(d, -240, 240) * k);
    this.anchorY = e.clientY;
    this.schedule();
  };

  /** Zoom by a factor around the middle of the visible area (used by commands). */
  zoomBy(factor: number): void {
    this.factor *= factor;
    this.anchorY = null;
    this.schedule();
  }

  reset(): void {
    this.factor *= 1 / this.o.get();
    this.anchorY = null;
    this.schedule();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.badgeTimer);
    this.badge.remove();
  }

  // ---------- internals ----------

  private isTimeGrid(): boolean {
    return (this.o.getCalendar()?.view?.type ?? "").startsWith("timeGrid");
  }

  private apply(z: number): void {
    this.o.host.style.setProperty("--mc-zoom", String(z));
  }

  private schedule(): void {
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.flush(); });
  }

  private flush(): void {
    const old = this.o.get();
    const next = clamp(Math.round(old * this.factor * 1000) / 1000, ZOOM_MIN, ZOOM_MAX);
    this.factor = 1;
    this.showBadge(next);
    if (next === old) return;

    const slots = this.o.calEl.querySelector<HTMLElement>(".fc-timegrid-slots");
    const scroller = slots?.closest<HTMLElement>(".fc-scroller") ?? null;

    // Remember which point of the time axis sits under the cursor (or the middle of the view).
    let anchor = 0, offset = 0, h0 = 1;
    if (slots && scroller) {
      const sr = scroller.getBoundingClientRect();
      const y = this.anchorY ?? sr.top + sr.height / 2;
      anchor = clamp(y, sr.top, sr.bottom);
      const r0 = slots.getBoundingClientRect();
      offset = anchor - r0.top;
      h0 = r0.height || 1;
    }

    this.apply(next);
    this.o.set(next);
    this.relayout();

    if (slots && scroller) {
      const r1 = slots.getBoundingClientRect();
      const wantTop = anchor - offset * (r1.height / h0);
      scroller.scrollTop += r1.top - wantTop;
    }
  }

  /**
   * FullCalendar measures slot positions only when the time grid re-renders, and updateSize()
   * alone does not re-render it. Changing a harmless option forces that re-render, so events,
   * the now-indicator and drag targets move to the new slot heights.
   */
  private relayout(): void {
    const cal = this.o.getCalendar();
    if (!cal) return;
    this.tick ^= 1;
    cal.setOption("slotLaneClassNames", this.tick ? ["mc-z1"] : ["mc-z0"]);
    cal.updateSize();
  }

  private showBadge(z: number): void {
    this.badge.textContent = `${Math.round(z * 100)}%`;
    this.badge.classList.add("is-visible");
    window.clearTimeout(this.badgeTimer);
    this.badgeTimer = window.setTimeout(() => this.badge.classList.remove("is-visible"), 900);
  }
}
