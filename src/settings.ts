export interface CalendarInfo {
  id: string;
  name: string;
  color: string;
  enabled: boolean;
  readOnly: boolean;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email?: string;
}

export interface Settings {
  clientId: string;
  clientSecret: string;
  tokens: GoogleTokens | null;
  calendars: CalendarInfo[];
  defaultCalendarId: string;

  desktopView: string;
  mobileView: string;
  firstDay: number;
  slotMinTime: string;
  slotMaxTime: string;
  scrollTime: string;
  refreshMinutes: number;

  notesFolder: string;
  noteTemplate: string;
  openDailyNoteOnDateClick: boolean;

  remindersEnabled: boolean;
  defaultReminderMinutes: number;

  weatherEnabled: boolean;
  weatherCity: string;
  weatherLat: number;
  weatherLon: number;
  weatherPanelOpen: boolean;
}

export const DEFAULT_TEMPLATE =
  "# {{title}}\n\n**Дата**: {{date}}\n**Час**: {{time}}\n**Місце**: {{location}}\n**Календар**: {{calendar}}\n\n{{description}}";

export const DEFAULT_SETTINGS: Settings = {
  clientId: "",
  clientSecret: "",
  tokens: null,
  calendars: [],
  defaultCalendarId: "",

  desktopView: "timeGridWeek",
  mobileView: "timeGridThreeDay",
  firstDay: 1,
  slotMinTime: "00:00",
  slotMaxTime: "24:00",
  scrollTime: "08:00",
  refreshMinutes: 5,

  notesFolder: "06 Календар",
  noteTemplate: DEFAULT_TEMPLATE,
  openDailyNoteOnDateClick: true,

  remindersEnabled: true,
  defaultReminderMinutes: 10,

  weatherEnabled: true,
  weatherCity: "Kraków",
  weatherLat: 50.0647,
  weatherLon: 19.945,
  weatherPanelOpen: true,
};

export const VIEW_LABELS: Record<string, string> = {
  dayGridMonth: "Місяць",
  timeGridWeek: "Тиждень",
  timeGridThreeDay: "3 дні",
  timeGridDay: "День",
  listWeek: "Список",
};
