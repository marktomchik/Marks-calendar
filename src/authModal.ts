import { App, Modal, Notice, Setting } from "obsidian";
import type MarkCalendarPlugin from "./main";
import { importTransfer, parseTransfer, scanQrAndConnect } from "./qrLogin";

/** Phone sign-in: open Google in the browser, then paste back the address of the "page not available" tab. */
export class MobileAuthModal extends Modal {
  private pasted = "";

  constructor(app: App, private plugin: MarkCalendarPlugin, private onDone: () => void) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("mc-auth");
    this.titleEl.setText("Підключення Google на телефоні");

    contentEl.createEl("p", { cls: "mc-auth-lead", text: "Найпростіше — якщо на комп'ютері календар уже підключений: там у налаштуваннях натисніть «QR для телефону» і відскануйте код." });
    new Setting(contentEl).addButton((b) =>
      b.setButtonText("Сканувати QR з комп'ютера").setCta().onClick(() => { this.close(); scanQrAndConnect(this.plugin, this.onDone); }));
    contentEl.createEl("p", { cls: "mc-auth-lead", text: "Або увійдіть прямо з телефону:" });

    const steps = contentEl.createEl("ol", { cls: "mc-auth-steps" });
    steps.createEl("li", { text: "Натисніть «1. Увійти в Google» — відкриється браузер." });
    steps.createEl("li", { text: "Виберіть акаунт. Якщо бачите «Google не перевірив цей застосунок» — «Додатково» → «Перейти до …»." });
    steps.createEl("li", { text: "Дозвольте доступ до календаря (поставте всі галочки)." });
    steps.createEl("li", { text: "Браузер покаже помилку «Сайт недоступний» — це нормально. Торкніться рядка адреси, скопіюйте всю адресу (починається з http://127.0.0.1)." });
    steps.createEl("li", { text: "Поверніться в Obsidian, вставте адресу нижче і натисніть «2. Готово»." });

    new Setting(contentEl).addButton((b) =>
      b.setButtonText("1. Увійти в Google").onClick(async () => {
        try { window.open(await this.plugin.google.beginManualAuth()); } catch (e: any) { new Notice(e.message ?? String(e), 8000); }
      }));

    const area = contentEl.createEl("textarea", { cls: "mc-auth-input", attr: { rows: "4", placeholder: "http://127.0.0.1:53682/?state=…&code=…" } });
    area.addEventListener("input", () => (this.pasted = area.value));

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Вставити з буфера").onClick(async () => {
        try { area.value = this.pasted = await navigator.clipboard.readText(); } catch { new Notice("Не вдалося прочитати буфер — вставте вручну"); }
      }))
      .addButton((b) => b.setButtonText("2. Готово").onClick(async () => {
        b.setDisabled(true).setButtonText("Підключаю…");
        try {
          const text = this.pasted || area.value;
          const transfer = parseTransfer(text);
          if (transfer) await importTransfer(this.plugin, transfer);
          else {
            await this.plugin.google.finishManualAuth(text);
            await this.plugin.refreshCalendarList();
          }
          this.onDone();
          new Notice("Google Calendar підключено ✅");
          this.close();
        } catch (e: any) {
          new Notice(e.message ?? String(e), 10000);
          b.setDisabled(false).setButtonText("2. Готово");
        }
      }));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
