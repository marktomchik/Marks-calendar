import { setIcon } from "obsidian";
import { describe, Forecast, HourPoint, icon, skyClass } from "./weather";
import { ymd } from "./store";

const SVG = "http://www.w3.org/2000/svg";
const dayName = new Intl.DateTimeFormat("uk-UA", { weekday: "short" });
const dayLong = new Intl.DateTimeFormat("uk-UA", { weekday: "long", day: "numeric", month: "long" });
const hm = new Intl.DateTimeFormat("uk-UA", { hour: "2-digit", minute: "2-digit", hour12: false });

const deg = (n: number) => `${Math.round(n)}°`;

function el<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = parent.createEl(tag, { cls });
  if (text !== undefined) e.setText(text);
  return e;
}

function svg<K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.appendChild(e);
  return e;
}

/** Catmull-Rom → cubic Bézier for a smooth temperature curve. */
function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  return d;
}

export class WeatherPanel {
  private root: HTMLElement;
  private data: Forecast | null = null;
  private dayIdx = 0;
  private resize: ResizeObserver;
  private chartHost!: HTMLElement;
  private readout!: HTMLElement;
  private details!: HTMLElement;

  constructor(parent: HTMLElement, private city: () => string, private onRefresh: () => void) {
    this.root = parent.createDiv({ cls: "mc-weather" });
    this.resize = new ResizeObserver(() => this.drawChart());
    this.resize.observe(this.root);
  }

  destroy(): void {
    this.resize.disconnect();
    this.root.remove();
  }

  setVisible(v: boolean): void {
    this.root.toggleClass("is-hidden", !v);
    if (v) this.drawChart();
  }

  showError(msg: string): void {
    this.root.empty();
    this.root.className = "mc-weather mc-sky-cloudy";
    const e = el(this.root, "div", "mc-w-error", `Погода недоступна: ${msg}`);
    e.onclick = () => this.onRefresh();
  }

  update(data: Forecast): void {
    this.data = data;
    this.render();
  }

  private render(): void {
    const f = this.data;
    if (!f) return;
    const r = this.root;
    r.empty();
    r.className = `mc-weather ${skyClass(f.current.code, f.current.isDay)}` + (r.hasClass("is-hidden") ? " is-hidden" : "");

    // ---- left: "now" block (like the top of the iPhone app) ----
    const now = el(r, "div", "mc-w-now");
    el(now, "div", "mc-w-city", this.city());
    el(now, "div", "mc-w-temp", deg(f.current.temp));
    el(now, "div", "mc-w-cond", describe(f.current.code));
    const today = f.days[0];
    if (today) el(now, "div", "mc-w-hl", `Макс.: ${deg(today.max)}  Мін.: ${deg(today.min)}`);

    // ---- right: day chips + scrubbable chart ----
    const card = el(r, "div", "mc-w-card");
    const chips = el(card, "div", "mc-w-days");
    f.days.forEach((d, i) => {
      const c = el(chips, "button", "mc-w-day" + (i === this.dayIdx ? " is-active" : ""));
      el(c, "span", "mc-w-day-name", i === 0 ? "Сьогодні" : dayName.format(new Date(d.date + "T12:00")));
      setIcon(el(c, "span", "mc-w-ico"), icon(d.code));
      el(c, "span", "mc-w-day-t", `${deg(d.max)} ${deg(d.min)}`);
      c.onclick = () => { this.dayIdx = i; this.render(); };
    });

    this.readout = el(card, "div", "mc-w-readout");
    this.chartHost = el(card, "div", "mc-w-chart");
    this.details = el(card, "div", "mc-w-details");
    this.drawChart();
  }

  private hoursOfDay(): HourPoint[] {
    if (!this.data) return [];
    const d = this.data.days[this.dayIdx]?.date;
    return this.data.hours.filter((h) => ymd(h.time) === d);
  }

  private drawChart(): void {
    if (!this.data || !this.chartHost || this.root.hasClass("is-hidden")) return;
    const hours = this.hoursOfDay();
    const host = this.chartHost;
    host.empty();
    const W = Math.max(host.clientWidth, 200);
    const compact = !!this.root.closest(".mc-mobile");
    const H = compact ? 92 : 120, top = 16, bottom = 20, barH = compact ? 14 : 22;
    if (hours.length < 2) return;

    const temps = hours.map((h) => h.temp);
    const lo = Math.floor(Math.min(...temps)) - 1, hi = Math.ceil(Math.max(...temps)) + 1;
    const x = (i: number) => 10 + (i / (hours.length - 1)) * (W - 20);
    const y = (t: number) => top + (1 - (t - lo) / (hi - lo || 1)) * (H - top - bottom - barH);
    const pts = hours.map((h, i) => [x(i), y(h.temp)] as [number, number]);

    const s = svg(host, "svg", { width: W, height: H, class: "mc-w-svg" });
    const defs = svg(s, "defs", {});
    const grad = svg(defs, "linearGradient", { id: "mcTempGrad", x1: 0, y1: 0, x2: 0, y2: 1 });
    svg(grad, "stop", { offset: "0%", "stop-color": "#ffd166", "stop-opacity": 0.55 });
    svg(grad, "stop", { offset: "100%", "stop-color": "#ffd166", "stop-opacity": 0 });
    const line = svg(defs, "linearGradient", { id: "mcLineGrad", x1: 0, y1: 0, x2: 0, y2: 1 });
    svg(line, "stop", { offset: "0%", "stop-color": "#ffb347" });
    svg(line, "stop", { offset: "100%", "stop-color": "#7fd3ff" });

    // Grid lines at 0/6/12/18 h
    for (const hh of [0, 6, 12, 18]) {
      const i = hours.findIndex((h) => h.time.getHours() === hh);
      if (i < 0) continue;
      svg(s, "line", { x1: x(i), x2: x(i), y1: top - 6, y2: H - bottom, class: "mc-w-grid" });
      const t = svg(s, "text", { x: x(i), y: H - 6, class: "mc-w-axis", "text-anchor": i === 0 ? "start" : "middle" });
      t.textContent = `${String(hh).padStart(2, "0")}:00`;
    }

    // Precipitation probability bars
    const bw = Math.max((W - 20) / hours.length - 2, 2);
    hours.forEach((h, i) => {
      if (h.precipProb <= 0) return;
      const bh = (h.precipProb / 100) * barH;
      svg(s, "rect", { x: x(i) - bw / 2, y: H - bottom - bh, width: bw, height: bh, rx: 1.5, class: "mc-w-bar" });
    });

    // Past part of today is dimmed, like the iPhone app
    const nowIdx = this.dayIdx === 0 ? hours.findIndex((h) => h.time.getHours() === new Date().getHours()) : -1;
    const area = smoothPath(pts) + ` L${x(hours.length - 1)},${H - bottom} L${x(0)},${H - bottom} Z`;
    svg(s, "path", { d: area, fill: "url(#mcTempGrad)" });
    const curve = svg(s, "path", { d: smoothPath(pts), fill: "none", stroke: "url(#mcLineGrad)", "stroke-width": 3, "stroke-linecap": "round" });
    if (nowIdx > 0) {
      const clip = svg(defs, "clipPath", { id: "mcPast" });
      svg(clip, "rect", { x: 0, y: 0, width: x(nowIdx), height: H });
      svg(s, "path", { d: smoothPath(pts), fill: "none", stroke: "rgba(0,0,0,.35)", "stroke-width": 3.5, "clip-path": "url(#mcPast)" });
    }
    void curve;

    // Min / max markers
    const iMax = temps.indexOf(Math.max(...temps)), iMin = temps.indexOf(Math.min(...temps));
    for (const [i, lbl] of [[iMax, "В"], [iMin, "Н"]] as [number, string][]) {
      const t = svg(s, "text", { x: x(i), y: lbl === "В" ? y(temps[i]) - 7 : y(temps[i]) + 14, class: "mc-w-ext", "text-anchor": "middle" });
      t.textContent = `${lbl} ${deg(temps[i])}`;
    }

    // Scrubber
    const cursor = svg(s, "line", { y1: top - 6, y2: H - bottom, class: "mc-w-cursor" });
    const dot = svg(s, "circle", { r: 6, class: "mc-w-dot" });
    const show = (i: number) => {
      const h = hours[Math.max(0, Math.min(hours.length - 1, i))];
      const idx = hours.indexOf(h);
      cursor.setAttribute("x1", String(x(idx)));
      cursor.setAttribute("x2", String(x(idx)));
      dot.setAttribute("cx", String(x(idx)));
      dot.setAttribute("cy", String(y(h.temp)));
      this.showHour(h);
    };
    const defaultIdx = nowIdx >= 0 ? nowIdx : hours.findIndex((h) => h.time.getHours() === 12);
    show(defaultIdx);

    const pick = (ev: PointerEvent) => {
      const rect = s.getBoundingClientRect();
      const px = ev.clientX - rect.left;
      show(Math.round(((px - 10) / (W - 20)) * (hours.length - 1)));
    };
    let dragging = false;
    s.addEventListener("pointerdown", (ev) => { dragging = true; s.setPointerCapture(ev.pointerId); pick(ev); });
    s.addEventListener("pointermove", (ev) => { if (dragging || ev.pointerType === "mouse") pick(ev); });
    const end = (ev: PointerEvent) => {
      dragging = false;
      if (ev.pointerType !== "mouse") show(defaultIdx);
    };
    s.addEventListener("pointerup", end);
    s.addEventListener("pointercancel", end);
    s.addEventListener("pointerleave", () => { if (!dragging) show(defaultIdx); });
  }

  private showHour(h: HourPoint): void {
    const r = this.readout;
    r.empty();
    setIcon(el(r, "span", "mc-w-ico"), icon(h.code, h.isDay));
    el(r, "span", "mc-w-ro-temp", deg(h.temp));
    const t = this.dayIdx === 0 && h.time.getHours() === new Date().getHours() ? "Зараз" : hm.format(h.time);
    el(r, "span", "mc-w-ro-text", `${t} · ${describe(h.code)}`);
    if (this.dayIdx > 0) el(r, "span", "mc-w-ro-day", dayLong.format(h.time));

    const d = this.details;
    d.empty();
    const day = this.data!.days[this.dayIdx];
    const tile = (ico: string, label: string, value: string) => {
      const c = el(d, "div", "mc-w-tile");
      const head = el(c, "div", "mc-w-tile-h");
      setIcon(el(head, "span", "mc-w-ico-s"), ico);
      el(head, "span", undefined, label);
      el(c, "div", "mc-w-tile-v", value);
    };
    tile("thermometer", "Відчувається", deg(h.feels));
    tile("umbrella", "Опади", `${h.precipProb}%`);
    tile("wind", "Вітер", `${Math.round(h.wind)} км/год`);
    tile("droplets", "Вологість", `${h.humidity}%`);
    tile("sun", "УФ-індекс", `${Math.round(h.uv)}`);
    if (day) tile("sunset", "Схід / захід", `${hm.format(day.sunrise)} / ${hm.format(day.sunset)}`);
  }
}
