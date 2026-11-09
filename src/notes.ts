import { App, normalizePath, parseYaml, TFile, TFolder } from "obsidian";
import type { CalEvent } from "./store";
import { ymd } from "./store";

const FM_EVENT = "gcal-event-id";
const FM_CAL = "gcal-calendar-id";

/**
 * Keeps a map event → note for the notes folder. Frontmatter is read straight
 * from the file when Obsidian's metadata cache isn't ready yet, so a note is
 * never created twice for the same event (e.g. right after startup or sync).
 */
export class LinkedNotes {
  private index = new Map<string, string>(); // key -> path
  private built: Promise<void> | null = null;
  private creating = new Map<string, Promise<TFile>>();

  constructor(private app: App, private folder: () => string, private template: () => string) {}

  reset(): void {
    this.index.clear();
    this.built = null;
  }

  private inFolder(f: TFile): boolean {
    const dir = normalizePath(this.folder());
    return f.extension === "md" && (f.path.startsWith(dir + "/"));
  }

  private keysFromFrontmatter(fm: Record<string, unknown> | undefined): string[] {
    if (!fm) return [];
    const s = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
    const keys: string[] = [];
    if (fm[FM_EVENT]) keys.push(`${s(fm[FM_CAL])}::${s(fm[FM_EVENT])}`);
    // Notes created by the previous calendar plugin.
    if (fm["fc-event-uid"]) keys.push(`legacy::${s(fm["fc-event-uid"])}::${s(fm["fc-event-recurrence-id"])}`);
    return keys;
  }

  private async readFrontmatter(f: TFile): Promise<Record<string, unknown> | undefined> {
    const cached = this.app.metadataCache.getFileCache(f);
    if (cached) return cached.frontmatter;
    const text = await this.app.vault.cachedRead(f);
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (!m) return undefined;
    try { return parseYaml(m[1]); } catch { return undefined; }
  }

  private indexFile(f: TFile, fm: Record<string, unknown> | undefined): void {
    for (const [k, p] of this.index) if (p === f.path) this.index.delete(k);
    for (const k of this.keysFromFrontmatter(fm)) this.index.set(k, f.path);
  }

  private ensureIndex(): Promise<void> {
    if (!this.built) {
      this.built = (async () => {
        const files = this.app.vault.getMarkdownFiles().filter((f) => this.inFolder(f));
        await Promise.all(files.map(async (f) => this.indexFile(f, await this.readFrontmatter(f))));
      })();
    }
    return this.built;
  }

  /** Hook into vault events so the index stays current. */
  register(on: (ref: any) => void): void {
    on(this.app.metadataCache.on("changed", (f, _d, cache) => {
      if (this.built && this.inFolder(f)) this.indexFile(f, cache.frontmatter);
    }));
    on(this.app.vault.on("delete", (f) => {
      for (const [k, p] of this.index) if (p === f.path) this.index.delete(k);
    }));
    on(this.app.vault.on("rename", (f, old) => {
      for (const [k, p] of this.index) if (p === old) this.index.set(k, f.path);
      if (f instanceof TFile && this.built && this.inFolder(f)) {
        this.readFrontmatter(f).then((fm) => this.indexFile(f, fm));
      }
    }));
  }

  private candidateKeys(ev: CalEvent): string[] {
    const g = ev.g;
    const keys = [`${ev.calendarId}::${g.id}`];
    const orig = g.originalStartTime?.date ?? g.originalStartTime?.dateTime;
    const recId = g.recurringEventId && orig ? ymd(g.originalStartTime?.date ? new Date(orig + "T00:00") : new Date(orig)) : "";
    const uids = new Set([g.recurringEventId, g.id, g.iCalUID?.replace(/@google\.com$/, "")].filter(Boolean) as string[]);
    for (const u of uids) keys.push(`legacy::${u}::${recId}`);
    return keys;
  }

  /** Synchronous check (used for the note marker on events); may miss until the index is built. */
  hasNote(ev: CalEvent): boolean {
    return this.candidateKeys(ev).some((k) => this.index.has(k));
  }

  async find(ev: CalEvent): Promise<TFile | null> {
    await this.ensureIndex();
    for (const k of this.candidateKeys(ev)) {
      const p = this.index.get(k);
      const f = p ? this.app.vault.getAbstractFileByPath(p) : null;
      if (f instanceof TFile) return f;
      if (p) this.index.delete(k);
    }
    return null;
  }

  async openOrCreate(ev: CalEvent, calendarName: string): Promise<TFile> {
    const existing = await this.find(ev);
    if (existing) return existing;
    const key = `${ev.calendarId}::${ev.g.id}`;
    let p = this.creating.get(key);
    if (!p) {
      p = this.create(ev, calendarName).finally(() => this.creating.delete(key));
      this.creating.set(key, p);
    }
    return p;
  }

  private async create(ev: CalEvent, calendarName: string): Promise<TFile> {
    const dir = normalizePath(this.folder() || "/");
    if (dir !== "/" && !(this.app.vault.getAbstractFileByPath(dir) instanceof TFolder)) {
      await this.app.vault.createFolder(dir);
    }
    const title = (ev.g.summary ?? "Без назви").trim();
    const safe = title.replace(/[\\/:*?"<>|#^[\]]/g, "").slice(0, 80).trim() || "Подія";
    let name = `${safe} ${ymd(ev.start)}`;
    let path = normalizePath(`${dir}/${name}.md`);
    for (let i = 2; this.app.vault.getAbstractFileByPath(path); i++) path = normalizePath(`${dir}/${name} (${i}).md`);

    const fm = `---\n${FM_EVENT}: "${ev.g.id}"\n${FM_CAL}: "${ev.calendarId}"\n---\n`;
    const file = await this.app.vault.create(path, fm + renderTemplate(this.template(), ev, calendarName));
    this.index.set(key(ev), file.path);
    return file;
  }
}

function key(ev: CalEvent): string {
  return `${ev.calendarId}::${ev.g.id}`;
}

const dateFmt = new Intl.DateTimeFormat("uk-UA", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("uk-UA", { hour: "2-digit", minute: "2-digit", hour12: false });

export function timeString(ev: CalEvent): string {
  if (ev.allDay) return "Весь день";
  return `${timeFmt.format(ev.start)} – ${timeFmt.format(ev.end)}`;
}

export function renderTemplate(tpl: string, ev: CalEvent, calendarName: string): string {
  const vars: Record<string, string> = {
    title: ev.g.summary ?? "",
    date: dateFmt.format(ev.start),
    isoDate: ymd(ev.start),
    time: timeString(ev),
    timeString: timeString(ev), // compatibility with old templates
    location: ev.g.location ?? "",
    calendar: calendarName,
    calendarName,
    description: (ev.g.description ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""),
    link: ev.g.htmlLink ?? "",
  };
  return tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}
