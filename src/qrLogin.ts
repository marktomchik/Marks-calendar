import { App, Modal, Notice, Setting } from "obsidian";
import qrcode from "qrcode-generator";
import jsQR from "jsqr";
import type MarkCalendarPlugin from "./main";

/**
 * Moving a Google sign-in from one device to another with a QR code.
 * The code holds an obsidian://mark-calendar?connect=… link with the OAuth client and the refresh token.
 */
const PREFIX = "obsidian://mark-calendar?connect=";

interface Transfer { clientId: string; clientSecret: string; refreshToken: string; email?: string }

function b64urlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(text: string): string {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function transferLink(plugin: MarkCalendarPlugin): string {
  const s = plugin.settings;
  if (!s.tokens?.refreshToken) throw new Error("Спочатку підключіть Google на цьому пристрої.");
  return PREFIX + b64urlEncode(JSON.stringify([1, s.clientId, s.clientSecret, s.tokens.refreshToken, s.tokens.email ?? ""]));
}

/** Accepts the full obsidian:// link, the value of its connect= parameter, or text containing either. */
export function parseTransfer(text: string): Transfer | null {
  const t = text.trim();
  const m = t.match(/[?&]connect=([A-Za-z0-9_-]+)/);
  const payload = m ? m[1] : /^[A-Za-z0-9_-]{100,}$/.test(t) ? t : null;
  if (!payload) return null;
  try {
    const a = JSON.parse(b64urlDecode(payload));
    if (!Array.isArray(a) || a[0] !== 1 || !a[1] || !a[2] || !a[3]) return null;
    return { clientId: a[1], clientSecret: a[2], refreshToken: a[3], email: a[4] || undefined };
  } catch {
    return null;
  }
}

export async function importTransfer(plugin: MarkCalendarPlugin, t: Transfer): Promise<void> {
  const s = plugin.settings;
  s.clientId = t.clientId;
  s.clientSecret = t.clientSecret;
  s.tokens = { accessToken: "", refreshToken: t.refreshToken, expiresAt: 0, email: t.email };
  await plugin.saveSettings();
  try {
    await plugin.refreshCalendarList();
  } catch (e) {
    s.tokens = null;
    await plugin.saveSettings();
    throw new Error(`QR прочитано, але Google не прийняв вхід: ${(e as Error).message}. Покажіть свіжий QR з комп'ютера.`);
  }
}

// ---------- Show (on the device that is already signed in) ----------

export class QrShowModal extends Modal {
  private timer = 0;

  constructor(app: App, private plugin: MarkCalendarPlugin) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("mc-qr");
    this.titleEl.setText("Вхід на телефоні через QR");

    let link: string;
    try { link = transferLink(this.plugin); } catch (e: any) { contentEl.setText(e.message); return; }

    const qr = qrcode(0, "L");
    qr.addData(link, "Byte");
    qr.make();
    const box = contentEl.createDiv({ cls: "mc-qr-code" });
    box.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true });

    const steps = contentEl.createEl("ol", { cls: "mc-auth-steps" });
    steps.createEl("li", { text: "На телефоні: Obsidian → Налаштування → Mark Calendar → «Сканувати QR з комп'ютера» → сфотографуйте цей код." });
    steps.createEl("li", { text: "Або наведіть звичайну камеру телефону — якщо вона запропонує відкрити посилання в Obsidian, натисніть «Відкрити»." });

    contentEl.createDiv({
      cls: "setting-item-description",
      text: "⚠️ Код дає доступ до вашого Google Календаря — не показуйте його іншим. Вікно закриється само через 3 хвилини.",
    });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Скопіювати посилання").onClick(async () => {
        await navigator.clipboard.writeText(link);
        new Notice("Посилання скопійовано — можна надіслати собі й вставити на телефоні");
      }))
      .addButton((b) => b.setButtonText("Закрити").onClick(() => this.close()));

    this.timer = window.setTimeout(() => this.close(), 3 * 60_000);
  }

  onClose(): void {
    window.clearTimeout(this.timer);
    this.contentEl.empty();
  }
}

// ---------- Scan (on the phone) ----------

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

async function decodeQr(img: HTMLImageElement): Promise<string | null> {
  // Native detector first (fast, handles photos of screens well).
  const BD = (window as any).BarcodeDetector;
  if (BD) {
    try {
      const codes = await new BD({ formats: ["qr_code"] }).detect(img);
      if (codes?.[0]?.rawValue) return codes[0].rawValue as string;
    } catch { /* fall back to jsQR */ }
  }
  for (const max of [1000, 1600, 700, 2400]) {
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    const res = jsQR(data.data, w, h, { inversionAttempts: "attemptBoth" });
    if (res?.data) return res.data;
  }
  return null;
}

/** Opens the camera (or gallery), reads the QR and signs in. */
export function scanQrAndConnect(plugin: MarkCalendarPlugin, onDone: () => void): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.setAttribute("capture", "environment");
  input.style.display = "none";
  document.body.appendChild(input);
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    const notice = new Notice("Читаю QR…", 0);
    try {
      const text = await decodeQr(await loadImage(file));
      if (!text) throw new Error("QR не знайдено. Сфотографуйте код ближче, рівно і без відблисків.");
      const t = parseTransfer(text);
      if (!t) throw new Error("Це не QR від Mark Calendar.");
      await importTransfer(plugin, t);
      new Notice(`Google Calendar підключено ✅${t.email ? ` (${t.email})` : ""}`);
      onDone();
    } catch (e: any) {
      new Notice(e.message ?? String(e), 10000);
    } finally {
      notice.hide();
    }
  });
  input.click();
}

/** Confirmation when the obsidian:// link is opened from a camera app or a message. */
export class QrConfirmModal extends Modal {
  constructor(app: App, private plugin: MarkCalendarPlugin, private t: Transfer) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("Підключити Google Calendar?");
    this.contentEl.createEl("p", {
      text: this.t.email ? `Акаунт: ${this.t.email}` : "Підключити акаунт Google з іншого пристрою.",
    });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Скасувати").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Підключити").setCta().onClick(async () => {
        b.setDisabled(true);
        try {
          await importTransfer(this.plugin, this.t);
          new Notice("Google Calendar підключено ✅");
          this.close();
        } catch (e: any) {
          new Notice(e.message ?? String(e), 10000);
          b.setDisabled(false);
        }
      }));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
