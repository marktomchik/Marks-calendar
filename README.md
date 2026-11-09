# Mark Calendar

A fast Google Calendar view for Obsidian — about 10× lighter than general-purpose calendar plugins (~320 KB).

> 🇺🇦 **Коротко українською:** швидкий календар Google для Obsidian. Двостороння синхронізація з Google Calendar, нотатки до подій без дублікатів, нагадування та погода в стилі iPhone. Інтерфейс плагіна — українською.

## Features
- **Google Calendar, two-way sync** — view, create, edit, drag & resize, delete. Several calendars, each with its own colour.
- **Views** — month, week, 3 days, day, list. 24-hour time.
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
The plugin talks to Google directly with your own OAuth client — no third-party server.
1. In [Google Cloud Console](https://console.cloud.google.com/), enable **Google Calendar API**.
2. Create an OAuth client of type **Desktop app**, and add your account to *Test users*.
3. Paste the Client ID and Client Secret into the plugin settings and click **Connect** on a desktop computer (sign-in uses a local `127.0.0.1` redirect).

Credentials and tokens are stored only in your vault's plugin `data.json`.

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
