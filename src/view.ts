import { ItemView, Notice, Platform, setIcon, WorkspaceLeaf } from "obsidian";
import { Calendar, EventInput, EventApi } from "@fullcalendar/core";
import ukLocale from "@fullcalendar/core/locales/uk";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import type MarkCalendarPlugin from "./main";
import { EVENT_COLORS } from "./google";
import type { CalEvent } from "./store";
import { ymd } from "./store";
import { EventDetailsModal, EventEditModal } from "./modal";
import { WeatherPanel } from "./weatherPanel";
import { icon as wIcon } from "./weather";
import { VIEW_LABELS } from "./settings";

export const VIEW_TYPE = "mark-calendar-view";

export class CalendarView extends ItemView {
  private calendar: Calendar | null = null;
  private weather: WeatherPanel | null = null;
  private weatherPill: HTMLElement | null = null;
  private resizeObs: ResizeObserver | null = null;
  private unsub: (() => void) | null = null;
  private byKey = new Map<string, CalEvent>();

  constructor(leaf: WorkspaceLeaf, private plugin: MarkCalendarPlugin) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return "Календар"; }
  getIcon(): string { return "calendar-days"; }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("mc-root");
    root.toggleClass("mc-mobile", Platform.isMobile);

    const s = this.plugin.settings;
    if (s.weatherEnabled) {
      this.weather = new WeatherPanel(root, () => s.weatherCity, () => this.loadWeather(true));
      this.weather.setVisible(s.weatherPanelOpen);
    }

    if (!this.plugin.google.connected) {
      const hint = root.createDiv({ cls: "mc-connect-hint" });
      hint.setText("Google Calendar не підключено. Відкрийте налаштування плагіна «Mark Calendar».");
      hint.onclick = () => this.plugin.openSettings();
    }

    const calEl = root.createDiv({ cls: "mc-calendar" });
    const mobile = Platform.isMobile;
    const views = "dayGridMonth,timeGridWeek,timeGridThreeDay,timeGridDay,listWeek";

    this.calendar = new Calendar(calEl, {
      plugins: [dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin],
      locale: ukLocale,
      timeZone: "local",
      initialView: mobile ? s.mobileView : s.desktopView,
      firstDay: s.firstDay,
      height: "100%",
      nowIndicator: true,
      navLinks: true,
      editable: true,
      selectable: true,
      selectMirror: true,
      dayMaxEvents: true,
      weekNumbers: false,
      slotMinTime: s.slotMinTime,
      slotMaxTime: s.slotMaxTime,
      scrollTime: s.scrollTime,
      slotLabelFormat: { hour: "2-digit", minute: "2-digit", hour12: false },
      eventTimeFormat: { hour: "2-digit", minute: "2-digit", hour12: false },
      longPressDelay: 350,
      views: {
        timeGridThreeDay: { type: "timeGrid", duration: { days: 3 }, buttonText: VIEW_LABELS.timeGridThreeDay },
        dayGridMonth: { buttonText: VIEW_LABELS.dayGridMonth },
        timeGridWeek: { buttonText: VIEW_LABELS.timeGridWeek },
        timeGridDay: { buttonText: VIEW_LABELS.timeGridDay },
        listWeek: { buttonText: VIEW_LABELS.listWeek },
      },
      headerToolbar: mobile
        ? { left: "prev,next", center: "title", right: "today" }
        : { left: "prev,next today", center: "title", right: views },
      footerToolbar: mobile ? { center: "dayGridMonth,timeGridThreeDay,timeGridDay,listWeek" } : false,

      events: (info, ok, fail) => {
        this.plugin.store.range(info.start, info.end).then((list) => {
          this.byKey.clear();
          ok(list.map((e) => this.toInput(e)));
          if (this.plugin.store.lastError) new Notice(`Календар: ${this.plugin.store.lastError}`);
        }, fail);
      },
      eventClassNames: (arg) => {
        const ev = this.byKey.get(arg.event.id);
        return ev && this.plugin.notes.hasNote(ev) ? ["mc-has-note"] : [];
      },
      eventClick: (arg) => {
        arg.jsEvent.preventDefault();
        const ev = this.byKey.get(arg.event.id);
        if (!ev) return;
        if (arg.jsEvent.ctrlKey || arg.jsEvent.metaKey) { this.plugin.openNote(ev); return; }
        const cal = this.plugin.calendarById(ev.calendarId);
        new EventDetailsModal(this.app, ev, cal?.name ?? "", this.colorOf(ev), this.plugin.modalActions()).open();
      },
      select: (arg) => {
        this.calendar?.unselect();
        if (!this.plugin.google.connected) { this.plugin.openSettings(); return; }
        new EventEditModal(this.app, this.plugin.modalActions(), { start: arg.start, end: arg.end, allDay: arg.allDay }).open();
      },
      eventDrop: (arg) => this.moveEvent(arg.event, arg.revert),
      eventResize: (arg) => this.moveEvent(arg.event, arg.revert),
      eventAllow: (_span, ev) => !this.plugin.calendarById(ev?.extendedProps.calendarId)?.readOnly,
      navLinkDayClick: (date) => {
        if (s.openDailyNoteOnDateClick) this.plugin.openDailyNote(date);
        else this.calendar?.changeView("timeGridDay", date);
      },
      dayHeaderContent: (arg) => this.dayHeader(arg.date, arg.text),
    });
    this.calendar.render();
    this.addWeatherButton(calEl);

    this.resizeObs = new ResizeObserver(() => this.calendar?.updateSize());
    this.resizeObs.observe(calEl);
    this.unsub = this.plugin.store.onChange(() => this.calendar?.refetchEvents());

    if (s.weatherEnabled) this.loadWeather(false);
  }

  async onClose(): Promise<void> {
    this.unsub?.();
    this.resizeObs?.disconnect();
    this.calendar?.destroy();
    this.weather?.destroy();
    this.calendar = null;
  }

  refresh(): void {
    this.plugin.store.invalidate(false);
    this.calendar?.refetchEvents();
    if (this.plugin.settings.weatherEnabled) this.loadWeather(true);
  }

  today(): void { this.calendar?.today(); }

  // ---------- helpers ----------

  private colorOf(ev: CalEvent): string {
    return (ev.g.colorId && EVENT_COLORS[ev.g.colorId]) || this.plugin.calendarById(ev.calendarId)?.color || "#4ca8df";
  }

  private toInput(ev: CalEvent): EventInput {
    this.byKey.set(ev.key, ev);
    const color = this.colorOf(ev);
    const ro = this.plugin.calendarById(ev.calendarId)?.readOnly;
    return {
      id: ev.key,
      title: ev.g.summary ?? "(без назви)",
      start: ev.start,
      end: ev.end,
      allDay: ev.allDay,
      backgroundColor: color,
      borderColor: color,
      editable: !ro,
      extendedProps: { calendarId: ev.calendarId },
    };
  }

  private async moveEvent(e: EventApi, revert: () => void): Promise<void> {
    const ev = this.byKey.get(e.id);
    if (!ev || !e.start) { revert(); return; }
    const end = e.end ?? new Date(e.start.getTime() + (e.allDay ? 86_400_000 : 3_600_000));
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const patch: any = e.allDay
      ? { start: { date: ymd(e.start), dateTime: null, timeZone: null }, end: { date: ymd(end), dateTime: null, timeZone: null } }
      : { start: { dateTime: e.start.toISOString(), date: null, timeZone: tz }, end: { dateTime: end.toISOString(), date: null, timeZone: tz } };
    try {
      await this.plugin.google.patchEvent(ev.calendarId, ev.g.id, patch);
      this.plugin.store.invalidate();
    } catch (err: any) {
      revert();
      new Notice(`Не вдалося перемістити: ${err.message ?? err}`);
    }
  }

  private dayHeader(date: Date, text: string): { domNodes: Node[] } {
    const wrap = document.createElement("span");
    wrap.className = "mc-dayhead";
    wrap.createSpan({ text });
    const f = this.plugin.settings.weatherEnabled ? this.plugin.weather.peek() : null;
    const d = f?.days.find((x) => x.date === ymd(date));
    const viewType = this.calendar?.view?.type ?? "";
    if (d && !viewType.startsWith("dayGrid")) {
      const w = wrap.createSpan({ cls: "mc-dayhead-w" });
      setIcon(w.createSpan({ cls: "mc-dayhead-ico" }), wIcon(d.code));
      w.createSpan({ text: `${Math.round(d.max)}°` });
      w.setAttr("title", `${Math.round(d.max)}° / ${Math.round(d.min)}°, опади ${d.precipProb}%`);
    }
    return { domNodes: [wrap] };
  }

  private addWeatherButton(calEl: HTMLElement): void {
    if (!this.plugin.settings.weatherEnabled) return;
    const chunk = calEl.querySelector(".fc-header-toolbar .fc-toolbar-chunk:last-child");
    if (!chunk) return;
    const pill = createEl("button", { cls: "mc-weather-pill" });
    chunk.prepend(pill);
    pill.onclick = async () => {
      const s = this.plugin.settings;
      s.weatherPanelOpen = !s.weatherPanelOpen;
      this.weather?.setVisible(s.weatherPanelOpen);
      pill.toggleClass("is-active", s.weatherPanelOpen);
      await this.plugin.saveSettings();
    };
    pill.toggleClass("is-active", this.plugin.settings.weatherPanelOpen);
    this.weatherPill = pill;
    pill.setText("…");
  }

  private async loadWeather(force: boolean): Promise<void> {
    const s = this.plugin.settings;
    try {
      const f = await this.plugin.weather.get(s.weatherLat, s.weatherLon, force);
      this.weather?.update(f);
      if (this.weatherPill) {
        this.weatherPill.empty();
        setIcon(this.weatherPill.createSpan({ cls: "mc-pill-ico" }), wIcon(f.current.code, f.current.isDay));
        this.weatherPill.createSpan({ text: `${Math.round(f.current.temp)}°` });
      }
      // Re-render day headers with weather icons.
      this.calendar?.setOption("dayHeaderContent", (arg) => this.dayHeader(arg.date, arg.text));
    } catch (e: any) {
      this.weather?.showError(e.message ?? String(e));
    }
  }
}
