import { App, Modal, Notice, Setting } from "obsidian";
import type { GEvent } from "./google";
import type { CalendarInfo } from "./settings";
import type { CalEvent } from "./store";
import { ymd } from "./store";
import { timeString } from "./notes";

export interface EventModalActions {
  calendars: CalendarInfo[];
  defaultCalendarId: string;
  save(calendarId: string, body: Partial<GEvent>, existing?: CalEvent): Promise<void>;
  remove(ev: CalEvent): Promise<void>;
  openNote(ev: CalEvent): Promise<void>;
}

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

function addDays(s: string, n: number): string {
  const [y, m, d] = s.split("-").map(Number);
  return ymd(new Date(y, m - 1, d + n));
}

/** Details view for an existing event, with buttons for note / edit / delete. */
export class EventDetailsModal extends Modal {
  constructor(app: App, private ev: CalEvent, private calName: string, private color: string, private actions: EventModalActions) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, ev } = this;
    contentEl.addClass("mc-details");
    const head = contentEl.createDiv({ cls: "mc-details-head" });
    head.createSpan({ cls: "mc-dot" }).style.background = this.color;
    head.createEl("h3", { text: ev.g.summary ?? "Без назви" });

    const fmt = new Intl.DateTimeFormat("uk-UA", { weekday: "long", day: "numeric", month: "long" });
    const rows: [string, string][] = [
      ["📅", `${fmt.format(ev.start)} · ${timeString(ev)}`],
      ["🗂", this.calName],
    ];
    if (ev.g.location) rows.push(["📍", ev.g.location]);
    if (ev.g.recurringEventId) rows.push(["🔁", "Повторювана подія (зміни стосуються лише цього разу)"]);
    for (const [i, t] of rows) {
      const r = contentEl.createDiv({ cls: "mc-details-row" });
      r.createSpan({ text: i });
      r.createSpan({ text: t });
    }
    if (ev.g.description) {
      contentEl.createDiv({ cls: "mc-details-desc", text: ev.g.description.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "") });
    }

    const readOnly = this.actions.calendars.find((c) => c.id === ev.calendarId)?.readOnly;
    const s = new Setting(contentEl).setClass("mc-buttons");
    s.addButton((b) => b.setButtonText("📝 Нотатка").setCta().onClick(async () => { this.close(); await this.actions.openNote(ev); }));
    if (!readOnly) {
      s.addButton((b) => b.setButtonText("Редагувати").onClick(() => {
        this.close();
        new EventEditModal(this.app, this.actions, { existing: ev }).open();
      }));
      s.addButton((b) => b.setButtonText("Видалити").setWarning().onClick(async () => {
        b.setDisabled(true);
        try { await this.actions.remove(ev); this.close(); } catch (e: any) { new Notice(e.message); b.setDisabled(false); }
      }));
    }
    if (ev.g.htmlLink) s.addExtraButton((b) => b.setIcon("external-link").setTooltip("Відкрити в Google").onClick(() => window.open(ev.g.htmlLink)));
  }

  onClose(): void { this.contentEl.empty(); }
}

/** Create / edit form. */
export class EventEditModal extends Modal {
  private title = "";
  private location = "";
  private description = "";
  private allDay = false;
  private date = "";
  private endDate = "";
  private start = "09:00";
  private end = "10:00";
  private calendarId: string;

  constructor(app: App, private actions: EventModalActions, private init: { existing?: CalEvent; start?: Date; end?: Date; allDay?: boolean }) {
    super(app);
    const ex = init.existing;
    this.calendarId = ex?.calendarId ?? actions.defaultCalendarId ?? actions.calendars[0]?.id;
    if (ex) {
      this.title = ex.g.summary ?? "";
      this.location = ex.g.location ?? "";
      this.description = ex.g.description ?? "";
      this.allDay = ex.allDay;
      this.date = ymd(ex.start);
      this.endDate = ex.allDay ? addDays(ymd(ex.end), -1) : ymd(ex.end);
      this.start = hhmm(ex.start);
      this.end = hhmm(ex.end);
    } else {
      const s = init.start ?? new Date();
      const e = init.end ?? new Date(s.getTime() + 3_600_000);
      this.allDay = !!init.allDay;
      this.date = ymd(s);
      this.endDate = this.allDay ? addDays(ymd(e), -1) : ymd(e);
      if (this.endDate < this.date) this.endDate = this.date;
      this.start = hhmm(s);
      this.end = hhmm(e);
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("mc-edit");
    this.titleEl.setText(this.init.existing ? "Редагувати подію" : "Нова подія");

    new Setting(contentEl).setName("Назва").addText((t) => {
      t.setValue(this.title).onChange((v) => (this.title = v));
      window.setTimeout(() => t.inputEl.focus(), 50);
      t.inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") this.submit(); });
    });

    const writable = this.actions.calendars.filter((c) => !c.readOnly && (c.enabled || c.id === this.calendarId));
    if (writable.length > 1 && !this.init.existing) {
      new Setting(contentEl).setName("Календар").addDropdown((d) => {
        writable.forEach((c) => d.addOption(c.id, c.name));
        d.setValue(this.calendarId).onChange((v) => (this.calendarId = v));
      });
    }

    new Setting(contentEl).setName("Весь день").addToggle((t) => t.setValue(this.allDay).onChange((v) => { this.allDay = v; this.renderTimes(); }));
    this.timesEl = contentEl.createDiv();
    this.renderTimes();

    new Setting(contentEl).setName("Місце").addText((t) => t.setValue(this.location).onChange((v) => (this.location = v)));
    new Setting(contentEl).setName("Опис").addTextArea((t) => {
      t.setValue(this.description).onChange((v) => (this.description = v));
      t.inputEl.rows = 3;
    });

    new Setting(contentEl).addButton((b) => b.setButtonText("Зберегти").setCta().onClick(() => this.submit()));
  }

  private timesEl!: HTMLElement;

  private renderTimes(): void {
    const el = this.timesEl;
    el.empty();
    const input = (s: Setting, type: string, value: string, set: (v: string) => void) =>
      s.addText((t) => { t.inputEl.type = type; t.setValue(value).onChange(set); });
    const a = new Setting(el).setName(this.allDay ? "Від" : "Початок");
    input(a, "date", this.date, (v) => { if (this.endDate < v) this.endDate = v; this.date = v; });
    if (!this.allDay) input(a, "time", this.start, (v) => (this.start = v));
    const b = new Setting(el).setName(this.allDay ? "До" : "Кінець");
    input(b, "date", this.endDate, (v) => (this.endDate = v));
    if (!this.allDay) input(b, "time", this.end, (v) => (this.end = v));
  }

  private saving = false;

  private async submit(): Promise<void> {
    if (this.saving) return;
    if (!this.title.trim()) { new Notice("Вкажіть назву"); return; }
    let body: Partial<GEvent>;
    if (this.allDay) {
      body = { start: { date: this.date }, end: { date: addDays(this.endDate < this.date ? this.date : this.endDate, 1) } };
    } else {
      const s = new Date(`${this.date}T${this.start}`);
      let e = new Date(`${this.endDate}T${this.end}`);
      if (e <= s) e = new Date(s.getTime() + 3_600_000);
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      body = { start: { dateTime: s.toISOString(), timeZone: tz }, end: { dateTime: e.toISOString(), timeZone: tz } };
    }
    body.summary = this.title.trim();
    body.location = this.location;
    body.description = this.description;
    this.saving = true;
    try {
      await this.actions.save(this.calendarId, body, this.init.existing);
      this.close();
    } catch (e: any) {
      console.error("[mark-calendar] save failed", e);
      new Notice(`Подію не збережено: ${e.message ?? String(e)}`, 10000);
    } finally {
      this.saving = false;
    }
  }

  onClose(): void { this.contentEl.empty(); }
}
