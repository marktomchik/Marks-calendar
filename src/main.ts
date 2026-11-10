import { App, moment, normalizePath, Notice, Platform, Plugin, PluginSettingTab, Setting, TFile, TFolder } from "obsidian";
import { DEFAULT_SETTINGS, DEFAULT_TEMPLATE, Settings, VIEW_LABELS, CalendarInfo } from "./settings";
import { GoogleClient } from "./google";
import { EventStore, CalEvent } from "./store";
import { LinkedNotes } from "./notes";
import { Reminders } from "./reminders";
import { WeatherService, searchPlaces } from "./weather";
import { CalendarView, VIEW_TYPE } from "./view";
import { EventEditModal, EventModalActions } from "./modal";

export default class MarkCalendarPlugin extends Plugin {
  settings!: Settings;
  google!: GoogleClient;
  store!: EventStore;
  notes!: LinkedNotes;
  weather = new WeatherService();

  async onload(): Promise<void> {
    await this.loadSettings();

    this.google = new GoogleClient({
      getClient: () => ({ clientId: this.settings.clientId, clientSecret: this.settings.clientSecret }),
      getTokens: () => this.settings.tokens,
      setTokens: async (t) => { this.settings.tokens = t; await this.saveSettings(); },
    });
    this.store = new EventStore(this.google, () => this.settings.calendars);
    this.notes = new LinkedNotes(this.app, () => this.settings.notesFolder, () => this.settings.noteTemplate);
    this.notes.register((ref) => this.registerEvent(ref));

    this.registerView(VIEW_TYPE, (leaf) => new CalendarView(leaf, this));
    this.addRibbonIcon("calendar-days", "Відкрити календар", () => this.activateView());

    this.addCommand({ id: "open", name: "Відкрити календар", callback: () => this.activateView() });
    this.addCommand({ id: "open-tab", name: "Відкрити календар у новій вкладці", callback: () => this.activateView(true) });
    this.addCommand({
      id: "new-event", name: "Нова подія",
      callback: () => new EventEditModal(this.app, this.modalActions(), { start: nextHalfHour() }).open(),
    });
    this.addCommand({ id: "refresh", name: "Оновити події", callback: () => this.views().forEach((v) => v.refresh()) });
    this.addCommand({ id: "today", name: "Перейти на сьогодні", callback: () => this.views().forEach((v) => v.today()) });
    this.addCommand({ id: "zoom-in", name: "Масштаб часу: детальніше", callback: () => this.views().forEach((v) => v.zoomIn()) });
    this.addCommand({ id: "zoom-out", name: "Масштаб часу: компактніше", callback: () => this.views().forEach((v) => v.zoomOut()) });
    this.addCommand({ id: "zoom-reset", name: "Масштаб часу: скинути", callback: () => this.views().forEach((v) => v.zoomReset()) });

    this.addSettingTab(new MarkCalendarSettingTab(this.app, this));

    new Reminders(
      this.app, this.store,
      () => ({ enabled: this.settings.remindersEnabled, minutes: this.settings.defaultReminderMinutes }),
      (id) => this.registerInterval(id),
    ).start();

    // Periodic background refresh of open views.
    this.registerInterval(window.setInterval(() => {
      if (this.views().length) this.store.invalidate();
    }, Math.max(1, this.settings.refreshMinutes) * 60_000));
  }

  onunload(): void { /* views are detached by Obsidian */ }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  views(): CalendarView[] {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE).map((l) => l.view).filter((v): v is CalendarView => v instanceof CalendarView);
  }

  async activateView(newTab = false): Promise<void> {
    const ws = this.app.workspace;
    const existing = ws.getLeavesOfType(VIEW_TYPE)[0];
    if (existing && !newTab) { ws.revealLeaf(existing); return; }
    const leaf = ws.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    ws.revealLeaf(leaf);
  }

  openSettings(): void {
    const setting = (this.app as any).setting;
    setting?.open();
    setting?.openTabById(this.manifest.id);
  }

  calendarById(id: string | undefined): CalendarInfo | undefined {
    return this.settings.calendars.find((c) => c.id === id);
  }

  async openNote(ev: CalEvent): Promise<void> {
    try {
      const file = await this.notes.openOrCreate(ev, this.calendarById(ev.calendarId)?.name ?? "");
      await this.app.workspace.getLeaf(Platform.isMobile ? false : "tab").openFile(file);
    } catch (e: any) {
      new Notice(`Не вдалося відкрити нотатку: ${e.message ?? e}`);
    }
  }

  /** Opens (or creates) the daily note using the core Daily notes settings. */
  async openDailyNote(date: Date): Promise<void> {
    const opts = (this.app as any).internalPlugins?.getPluginById?.("daily-notes")?.instance?.options ?? {};
    const format: string = opts.format || "YYYY-MM-DD";
    const folder: string = (opts.folder || "").trim();
    const mo = moment as unknown as (d?: Date) => any;
    const m = mo(date);
    const path = normalizePath(`${folder ? folder + "/" : ""}${m.format(format)}.md`);
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      let content = "";
      if (opts.template) {
        const tpl = this.app.metadataCache.getFirstLinkpathDest(opts.template, "");
        if (tpl) {
          content = (await this.app.vault.read(tpl))
            .replace(/\{\{\s*date\s*(?::(.+?))?\}\}/gi, (_x, f) => m.format(f?.trim() || format))
            .replace(/\{\{\s*title\s*\}\}/gi, m.format(format))
            .replace(/\{\{\s*time\s*(?::(.+?))?\}\}/gi, (_x, f) => mo().format(f?.trim() || "HH:mm"));
        }
      }
      const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      if (dir && !(this.app.vault.getAbstractFileByPath(dir) instanceof TFolder)) await this.app.vault.createFolder(dir);
      file = await this.app.vault.create(path, content);
    }
    await this.app.workspace.getLeaf(Platform.isMobile ? false : "tab").openFile(file as TFile);
  }

  modalActions(): EventModalActions {
    return {
      calendars: this.settings.calendars,
      defaultCalendarId: this.settings.defaultCalendarId || this.settings.calendars.find((c) => !c.readOnly)?.id || "",
      save: async (calendarId, body, existing) => {
        if (existing) {
          const patch: any = { ...body };
          if (body.start?.date) { patch.start = { ...body.start, dateTime: null, timeZone: null }; patch.end = { ...body.end, dateTime: null, timeZone: null }; }
          else { patch.start = { ...body.start, date: null }; patch.end = { ...body.end, date: null }; }
          await this.google.patchEvent(existing.calendarId, existing.g.id, patch);
        } else {
          if (!calendarId) throw new Error("Немає календаря для запису — підключіть Google у налаштуваннях");
          await this.google.insertEvent(calendarId, body);
        }
        this.store.invalidate();
      },
      remove: async (ev) => {
        await this.google.deleteEvent(ev.calendarId, ev.g.id);
        this.store.invalidate();
      },
      openNote: (ev) => this.openNote(ev),
    };
  }

  async refreshCalendarList(): Promise<void> {
    const fresh = await this.google.listCalendars();
    const old = new Map(this.settings.calendars.map((c) => [c.id, c]));
    this.settings.calendars = fresh.map((c) => {
      const o = old.get(c.id);
      return o ? { ...c, enabled: o.enabled, color: o.color } : c;
    });
    if (!this.calendarById(this.settings.defaultCalendarId)) {
      this.settings.defaultCalendarId = this.settings.calendars.find((c) => !c.readOnly)?.id ?? "";
    }
    await this.saveSettings();
    this.store.invalidate();
  }
}

function nextHalfHour(): Date {
  const d = new Date();
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return d;
}

class MarkCalendarSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: MarkCalendarPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    const p = this.plugin;
    const s = p.settings;
    const save = async () => { await p.saveSettings(); };
    containerEl.empty();

    // ---------- Google ----------
    new Setting(containerEl).setName("Google Calendar").setHeading();
    const help = containerEl.createDiv({ cls: "setting-item-description mc-help" });
    help.innerHTML =
      "1. У <a href=\"https://console.cloud.google.com/apis/credentials\">Google Cloud Console</a> увімкніть <b>Google Calendar API</b>.<br>" +
      "2. Створіть OAuth Client ID типу <b>Desktop app</b>, додайте себе в Test users.<br>" +
      "3. Вставте Client ID і Secret нижче та натисніть «Підключити» (на комп'ютері). На телефоні вхід підхопиться з синхронізованих налаштувань.";

    new Setting(containerEl).setName("Client ID").addText((t) =>
      t.setPlaceholder("…apps.googleusercontent.com").setValue(s.clientId).onChange(async (v) => { s.clientId = v.trim(); await save(); }));
    new Setting(containerEl).setName("Client Secret").addText((t) => {
      t.inputEl.type = "password";
      t.setValue(s.clientSecret).onChange(async (v) => { s.clientSecret = v.trim(); await save(); });
    });

    const acc = new Setting(containerEl)
      .setName(p.google.connected ? `Підключено${s.tokens?.email ? `: ${s.tokens.email}` : ""}` : "Не підключено");
    if (p.google.connected) {
      acc.addButton((b) => b.setButtonText("Оновити список календарів").onClick(async () => {
        try { await p.refreshCalendarList(); this.display(); } catch (e: any) { new Notice(e.message); }
      }));
      acc.addButton((b) => b.setButtonText("Відключити").setWarning().onClick(async () => {
        await p.google.disconnect(); s.calendars = []; await save(); p.store.invalidate(); this.display();
      }));
    } else {
      acc.addButton((b) => b.setButtonText("Підключити").setCta().onClick(async () => {
        b.setDisabled(true).setButtonText("Чекаю на браузер…");
        try {
          await p.google.connect();
          await p.refreshCalendarList();
          new Notice("Google Calendar підключено ✅");
        } catch (e: any) { new Notice(e.message ?? String(e)); }
        this.display();
      }));
    }

    if (s.calendars.length) {
      new Setting(containerEl).setName("Календарі").setHeading();
      for (const c of s.calendars) {
        new Setting(containerEl)
          .setName(c.name)
          .setDesc(c.readOnly ? "лише перегляд" : "")
          .addColorPicker((cp) => cp.setValue(c.color).onChange(async (v) => { c.color = v; await save(); p.store.invalidate(); }))
          .addToggle((t) => t.setValue(c.enabled).onChange(async (v) => { c.enabled = v; await save(); p.store.invalidate(); }));
      }
      new Setting(containerEl).setName("Календар для нових подій").addDropdown((d) => {
        s.calendars.filter((c) => !c.readOnly).forEach((c) => d.addOption(c.id, c.name));
        d.setValue(s.defaultCalendarId).onChange(async (v) => { s.defaultCalendarId = v; await save(); });
      });
    }

    // ---------- View ----------
    new Setting(containerEl).setName("Вигляд").setHeading();
    const viewDropdown = (name: string, get: () => string, set: (v: string) => void) =>
      new Setting(containerEl).setName(name).addDropdown((d) => {
        Object.entries(VIEW_LABELS).forEach(([k, v]) => d.addOption(k, v));
        d.setValue(get()).onChange(async (v) => { set(v); await save(); });
      });
    viewDropdown("Початковий вигляд (комп'ютер)", () => s.desktopView, (v) => (s.desktopView = v));
    viewDropdown("Початковий вигляд (телефон)", () => s.mobileView, (v) => (s.mobileView = v));
    new Setting(containerEl).setName("Перший день тижня").addDropdown((d) => {
      d.addOption("1", "Понеділок").addOption("0", "Неділя").setValue(String(s.firstDay))
        .onChange(async (v) => { s.firstDay = Number(v); await save(); });
    });
    const timeSetting = (name: string, get: () => string, set: (v: string) => void) =>
      new Setting(containerEl).setName(name).addText((t) => {
        t.inputEl.type = "time";
        t.setValue(get()).onChange(async (v) => { set(v); await save(); });
      });
    timeSetting("Показувати з", () => s.slotMinTime, (v) => (s.slotMinTime = v || "00:00"));
    timeSetting("Показувати до", () => s.slotMaxTime === "24:00" ? "23:59" : s.slotMaxTime, (v) => (s.slotMaxTime = !v || v === "23:59" ? "24:00" : v));
    timeSetting("Прокрутити до", () => s.scrollTime, (v) => (s.scrollTime = v || "08:00"));
    new Setting(containerEl).setName("Оновлювати події кожні (хв)").addSlider((sl) =>
      sl.setLimits(1, 30, 1).setValue(s.refreshMinutes).setDynamicTooltip().onChange(async (v) => { s.refreshMinutes = v; await save(); }));
    containerEl.createDiv({ cls: "setting-item-description", text: "Зміни вигляду застосуються після повторного відкриття календаря." });

    // ---------- Notes ----------
    new Setting(containerEl).setName("Нотатки").setHeading();
    new Setting(containerEl).setName("Папка для нотаток подій").addText((t) =>
      t.setValue(s.notesFolder).onChange(async (v) => { s.notesFolder = v.trim(); p.notes.reset(); await save(); }));
    new Setting(containerEl)
      .setName("Шаблон нотатки")
      .setDesc("Змінні: {{title}} {{date}} {{isoDate}} {{time}} {{location}} {{calendar}} {{description}} {{link}}")
      .addTextArea((t) => {
        t.setValue(s.noteTemplate).onChange(async (v) => { s.noteTemplate = v; await save(); });
        t.inputEl.rows = 7;
        t.inputEl.addClass("mc-template");
      })
      .addExtraButton((b) => b.setIcon("rotate-ccw").setTooltip("Скинути").onClick(async () => {
        s.noteTemplate = DEFAULT_TEMPLATE; await save(); this.display();
      }));
    new Setting(containerEl)
      .setName("Клік на дату відкриває щоденну нотатку")
      .setDesc("Використовує налаштування базового плагіна «Щоденні нотатки». Ctrl/Cmd + клік на подію — одразу її нотатка.")
      .addToggle((t) => t.setValue(s.openDailyNoteOnDateClick).onChange(async (v) => { s.openDailyNoteOnDateClick = v; await save(); }));

    // ---------- Reminders ----------
    new Setting(containerEl).setName("Нагадування").setHeading();
    new Setting(containerEl).setName("Увімкнути нагадування").addToggle((t) =>
      t.setValue(s.remindersEnabled).onChange(async (v) => { s.remindersEnabled = v; await save(); }));
    new Setting(containerEl)
      .setName("За скільки хвилин")
      .setDesc("Для подій зі своїми нагадуваннями в Google використовуються вони.")
      .addText((t) => {
        t.inputEl.type = "number";
        t.setValue(String(s.defaultReminderMinutes)).onChange(async (v) => { s.defaultReminderMinutes = Math.max(0, Number(v) || 0); await save(); });
      });

    // ---------- Weather ----------
    new Setting(containerEl).setName("Погода").setHeading();
    new Setting(containerEl).setName("Показувати погоду").addToggle((t) =>
      t.setValue(s.weatherEnabled).onChange(async (v) => { s.weatherEnabled = v; await save(); }));
    const city = new Setting(containerEl).setName("Місто").setDesc(`${s.weatherCity} (${s.weatherLat.toFixed(2)}, ${s.weatherLon.toFixed(2)})`);
    const results = containerEl.createDiv({ cls: "mc-city-results" });
    let timer: number | null = null;
    city.addText((t) => t.setPlaceholder("Пошук міста…").onChange((q) => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        results.empty();
        try {
          for (const pl of await searchPlaces(q)) {
            const b = results.createEl("button", { text: `${pl.name}${pl.admin ? ", " + pl.admin : ""}, ${pl.country}` });
            b.onclick = async () => {
              s.weatherCity = pl.name; s.weatherLat = pl.lat; s.weatherLon = pl.lon;
              await save(); this.display();
            };
          }
        } catch (e: any) { results.setText(e.message); }
      }, 350);
    }));
  }
}
