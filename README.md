# Mark Calendar

A fast Google Calendar view for Obsidian — much lighter than general-purpose calendar plugins (~490 KB).

> 🇺🇦 **Коротко українською:** швидкий календар Google для Obsidian. Двостороння синхронізація з Google Calendar, нотатки до подій без дублікатів, масштаб годин через Ctrl/Shift + прокрутку, нагадування та погода в стилі iPhone. Інтерфейс плагіна — українською.

## Features
- **Google Calendar, two-way sync** — view, create, edit, drag & resize, delete. Several calendars, each with its own colour.
- **Views** — month, week, 3 days, day, list. 24-hour time.
- **Time zoom** — stretch or squeeze the hours in week / 3-day / day views with **Ctrl/Cmd + scroll**, **Shift + scroll** or a trackpad pinch; the time under the cursor stays in place. Remembered separately for desktop and phone; also available as commands (zoom in / out / reset).
- **Linked notes** — one note per event in a chosen folder, created from a template. Never creates duplicates, even right after startup or a sync. Ctrl/Cmd+click an event to open its note.
- **Daily note** opens when you click a date.
- **Reminders** — in-app pop-up plus a system notification. The event's own Google reminders take priority.
- **iPhone-style weather** — current conditions, a 10-day forecast and an hourly temperature graph you can scrub with a finger or mouse ("feels like", rain, wind, humidity, UV). Weather icons in day headers. Data from [Open-Meteo](https://open-meteo.com), no API key needed.
- **Mobile layout** — 3-day view and compact controls.

The interface language is Ukrainian.

## Installation
### Manual
1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](../../releases/latest).
2. Put them into `<your vault>/.obsidian/plugins/mark-calendar/`.
3. Reload Obsidian and enable **Mark Calendar** in *Settings → Community plugins*.

### BRAT
Add this repository in the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin.

## Connecting Google
The plugin talks to Google directly with your own OAuth client — no third-party server. Credentials and tokens are stored only in your vault's plugin `data.json`.

### 🇺🇦 Як підключити Google Calendar (покроково)

**А. Google Cloud Console** (один раз, зручніше на комп'ютері, але можна й з телефону в браузері)
1. Відкрийте [console.cloud.google.com](https://console.cloud.google.com/) → вгорі **Select a project → New project** → назва будь-яка (напр. `Mark Calendar`) → **Create**.
2. **APIs & Services → Library** → знайдіть **Google Calendar API** → **Enable**.
3. **Google Auth Platform** (раніше *OAuth consent screen*) → **Get started**: назва застосунку, ваша пошта → тип **External** → **Create**.
4. **Audience → Test users → Add users** → додайте **ту саму пошту, з якої будете входити**.
   - Порада: тут же можна натиснути **Publish app** («In production»). Тоді вхід не злітатиме кожні 7 днів (у режимі *Testing* Google видає токен лише на 7 днів). Попередження «Google не перевірив застосунок» залишиться — це нормально для особистого використання.
5. **Clients → Create client** → тип **Desktop app** (⚠️ не *Web application*, інакше буде `redirect_uri_mismatch`) → **Create**.
6. Скопіюйте **Client ID** (закінчується на `.apps.googleusercontent.com`) і **Client Secret**.

**Б. Obsidian на комп'ютері**
1. Налаштування → **Mark Calendar** → вставте Client ID і Client Secret.
2. **Підключити** → у браузері виберіть акаунт → дозвольте доступ → вкладка напише «✅ Календар підключено».

**В. Obsidian на телефоні — через QR (найпростіше)**
1. На комп'ютері, де календар уже підключений: Налаштування → **Mark Calendar** → **QR для телефону**.
2. На телефоні: Налаштування → **Mark Calendar** → **Сканувати QR з комп'ютера** → сфотографуйте код з екрана.
3. Готово — Client ID, Secret і вхід перенесуться автоматично.
   - Можна й звичайною камерою телефону: якщо вона запропонує відкрити посилання `obsidian://…` — натисніть «Відкрити» і підтвердьте.
   - ⚠️ QR дає доступ до вашого календаря — не показуйте його стороннім.

**Г. Obsidian на телефоні — без комп'ютера**
1. Налаштування → **Mark Calendar** → вставте Client ID і Client Secret (без пробілів).
2. **Підключити** → **1. Увійти в Google** → відкриється браузер.
3. Виберіть акаунт. Якщо з'явиться «Google не перевірив цей застосунок» → **Додатково** → **Перейти до … (небезпечно)**. Поставте всі галочки доступу → **Продовжити**.
4. Браузер покаже помилку **«Сайт недоступний» / «127.0.0.1 refused to connect»** — так і має бути.
5. Торкніться рядка адреси й скопіюйте **всю** адресу (вона починається з `http://127.0.0.1:53682/?state=…&code=…`).
6. Поверніться в Obsidian → вставте адресу в поле (або кнопка **Вставити з буфера**) → **2. Готово**.

> Якщо налаштування Obsidian синхронізуються між пристроями (папка `.obsidian` разом із `plugins/mark-calendar/data.json`), достатньо підключитися на одному пристрої.

**Якщо не виходить**
| Повідомлення | Що робити |
|---|---|
| `access_denied` / «Доступ заблоковано» | Вашої пошти немає в **Test users** (крок А4) |
| `redirect_uri_mismatch` | Клієнт створено не як **Desktop app** — створіть новий (крок А5) |
| `invalid_client` | Помилка в Client ID / Secret — скопіюйте ще раз, без пробілів |
| `invalid_grant` | Код уже використано або застарів — пройдіть вхід ще раз і вставте нову адресу |
| «Сесія Google закінчилась» через тиждень | Застосунок у режимі *Testing* — натисніть **Publish app** (крок А4) і підключіться знову |
| Google API 403 | Не увімкнено **Google Calendar API** (крок А2) |

### English (short)
1. In Google Cloud Console enable **Google Calendar API**, configure the consent screen (External), add your account to *Test users* (or publish the app to avoid 7-day token expiry).
2. Create an OAuth client of type **Desktop app**.
3. Paste Client ID and Secret into the plugin settings and click **Connect**.
   - Desktop: sign-in uses a local `127.0.0.1` redirect.
   - Phone: easiest — on a signed-in desktop click **QR для телефону**, then on the phone **Сканувати QR з комп'ютера**. Or: the browser ends on a "can't connect to 127.0.0.1" page — copy that page's full address and paste it back into the plugin.

## Building
```bash
npm install
npm run build        # type-check + main.js
npm run dev          # watch mode
VAULT_PLUGIN_DIR="/path/to/vault/.obsidian/plugins/mark-calendar" npm run install-vault
```

## Credits
Calendar grid by [FullCalendar](https://fullcalendar.io) (MIT, © Adam Shaw). Weather data by [Open-Meteo](https://open-meteo.com) (CC BY 4.0).

## License
[MIT](LICENSE) © 2026 Mark Lysak
