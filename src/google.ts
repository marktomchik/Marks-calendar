import { Platform, requestUrl, RequestUrlResponse } from "obsidian";
import type { CalendarInfo, GoogleTokens } from "./settings";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "email",
].join(" ");

/** Subset of a Google Calendar event resource we actually use. */
export interface GEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  colorId?: string;
  htmlLink?: string;
  recurringEventId?: string;
  iCalUID?: string;
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
  originalStartTime?: { date?: string; dateTime?: string };
  reminders?: { useDefault: boolean; overrides?: { method: string; minutes: number }[] };
}

export interface GoogleHost {
  getClient(): { clientId: string; clientSecret: string };
  getTokens(): GoogleTokens | null;
  setTokens(t: GoogleTokens | null): Promise<void>;
}

export class GoogleError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function form(data: Record<string, string>): string {
  return Object.entries(data)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

/** Loopback address Google redirects to; on a phone nothing listens there, so the page fails and the user copies its URL. */
const MANUAL_REDIRECT = "http://127.0.0.1:53682";
const PENDING_KEY = "mark-calendar-oauth-pending";
interface PendingAuth { verifier: string; state: string; redirectUri: string; at: number }

export class GoogleClient {
  private refreshing: Promise<string> | null = null;
  private pending: PendingAuth | null = null;

  constructor(private host: GoogleHost) {}

  get connected(): boolean {
    return !!this.host.getTokens()?.refreshToken;
  }

  // ---------- OAuth (desktop loopback + PKCE) ----------

  async connect(): Promise<void> {
    if (!Platform.isDesktopApp) {
      throw new Error("На телефоні використовуйте вхід через вставку адреси (кнопка «Підключити» в налаштуваннях).");
    }
    const { clientId, clientSecret } = this.host.getClient();
    if (!clientId || !clientSecret) throw new Error("Вкажіть Client ID і Client Secret у налаштуваннях.");

    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const state = b64url(crypto.getRandomValues(new Uint8Array(16)));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const http = require("http") as typeof import("http");
    const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname !== "/") { res.writeHead(404); res.end(); return; }
        const err = url.searchParams.get("error");
        const c = url.searchParams.get("code");
        const ok = !err && c && url.searchParams.get("state") === state;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<html><body style="font-family:system-ui;padding:40px;text-align:center">
          <h2>${ok ? "✅ Календар підключено" : "❌ Помилка входу"}</h2>
          <p>Можна закрити цю вкладку і повернутися в Obsidian.</p></body></html>`);
        clearTimeout(timer);
        server.close();
        if (ok) resolve({ code: c!, redirectUri }); else reject(new Error(err ?? "Невірна відповідь Google"));
      });
      let redirectUri = "";
      const timer = setTimeout(() => { server.close(); reject(new Error("Час на вхід вичерпано")); }, 5 * 60_000);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        redirectUri = `http://127.0.0.1:${port}`;
        const url = `${AUTH_URL}?${form({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: SCOPES,
          access_type: "offline",
          prompt: "consent",
          code_challenge: challenge,
          code_challenge_method: "S256",
          state,
        })}`;
        window.open(url);
      });
    });

    await this.exchangeCode(code, verifier, redirectUri);
  }

  // ---------- OAuth on a phone (no local server: the user pastes the redirect URL back) ----------

  /** Builds the Google sign-in URL for the phone flow and remembers the PKCE verifier. */
  async beginManualAuth(): Promise<string> {
    const { clientId, clientSecret } = this.host.getClient();
    if (!clientId || !clientSecret) throw new Error("Спочатку вставте Client ID і Client Secret.");
    if (!clientId.endsWith(".apps.googleusercontent.com")) {
      throw new Error("Client ID має закінчуватися на .apps.googleusercontent.com — перевірте, що скопіювали саме його.");
    }
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
    const pending: PendingAuth = { verifier, state, redirectUri: MANUAL_REDIRECT, at: Date.now() };
    try { window.localStorage.setItem(PENDING_KEY, JSON.stringify(pending)); } catch { /* ignore */ }
    this.pending = pending;
    return `${AUTH_URL}?${form({
      client_id: clientId,
      redirect_uri: MANUAL_REDIRECT,
      response_type: "code",
      scope: SCOPES,
      access_type: "offline",
      prompt: "consent",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
    })}`;
  }

  /** Accepts the full address from the browser ("http://127.0.0.1…?code=…") or just the code. */
  async finishManualAuth(input: string): Promise<void> {
    let pending = this.pending;
    if (!pending) {
      try { pending = JSON.parse(window.localStorage.getItem(PENDING_KEY) ?? "null"); } catch { pending = null; }
    }
    if (!pending || Date.now() - pending.at > 30 * 60_000) {
      throw new Error("Сесія входу застаріла — натисніть «1. Увійти в Google» ще раз.");
    }
    const text = input.trim();
    if (!text) throw new Error("Вставте адресу зі сторінки браузера.");
    let code = text;
    try { code = decodeURIComponent(text); } catch { /* keep as is */ }
    if (/[?&]code=|[?&]error=/.test(text)) {
      const q = new URLSearchParams(text.slice(text.indexOf("?") + 1).split("#")[0]);
      const err = q.get("error");
      if (err) throw new Error(err === "access_denied" ? "Доступ не надано. Додайте свою пошту в Test users і спробуйте ще раз." : `Google: ${err}`);
      code = q.get("code") ?? "";
      const st = q.get("state");
      if (st && st !== pending.state) throw new Error("Ця адреса від попередньої спроби — увійдіть ще раз і вставте нову.");
    }
    if (!code) throw new Error("В адресі немає коду. Скопіюйте всю адресу, що починається з http://127.0.0.1");
    await this.exchangeCode(code, pending.verifier, pending.redirectUri);
    this.pending = null;
    try { window.localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
  }

  private async exchangeCode(code: string, verifier: string, redirectUri: string): Promise<void> {
    const { clientId, clientSecret } = this.host.getClient();
    const res = await requestUrl({
      url: TOKEN_URL,
      method: "POST",
      contentType: "application/x-www-form-urlencoded",
      body: form({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
      throw: false,
    });
    if (res.status !== 200) {
      let reason = "";
      try { reason = res.json?.error ?? ""; } catch { /* non-json */ }
      const hint: Record<string, string> = {
        invalid_client: "невірний Client ID або Client Secret (або клієнт не типу Desktop app)",
        invalid_grant: "код уже використано або він застарів — увійдіть ще раз",
        redirect_uri_mismatch: "клієнт OAuth має бути типу Desktop app, не Web application",
      };
      throw new GoogleError(`Не вдалося отримати токен (${res.status}${reason ? `: ${hint[reason] ?? reason}` : ""})`, res.status);
    }
    const j = res.json;
    if (!j.refresh_token) throw new Error("Google не дав refresh token — відкличте доступ у myaccount.google.com/permissions і підключіться знову.");
    let email: string | undefined;
    try {
      const payload = JSON.parse(atob(j.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      email = payload.email;
    } catch { /* id_token is optional */ }
    await this.host.setTokens({
      accessToken: j.access_token,
      refreshToken: j.refresh_token,
      expiresAt: Date.now() + (j.expires_in - 60) * 1000,
      email,
    });
  }

  async disconnect(): Promise<void> {
    const t = this.host.getTokens();
    if (t?.refreshToken) {
      await requestUrl({ url: `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t.refreshToken)}`, method: "POST", throw: false });
    }
    await this.host.setTokens(null);
  }

  private async accessToken(force = false): Promise<string> {
    const t = this.host.getTokens();
    if (!t?.refreshToken) throw new GoogleError("Google не підключено", 401);
    if (!force && t.accessToken && Date.now() < t.expiresAt) return t.accessToken;
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const { clientId, clientSecret } = this.host.getClient();
      const res = await requestUrl({
        url: TOKEN_URL,
        method: "POST",
        contentType: "application/x-www-form-urlencoded",
        body: form({ client_id: clientId, client_secret: clientSecret, refresh_token: t.refreshToken, grant_type: "refresh_token" }),
        throw: false,
      });
      if (res.status !== 200) throw new GoogleError("Сесія Google закінчилась — підключіться знову в налаштуваннях", res.status);
      const j = res.json;
      await this.host.setTokens({ ...t, accessToken: j.access_token, expiresAt: Date.now() + (j.expires_in - 60) * 1000 });
      return j.access_token as string;
    })().finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  private async call(method: string, path: string, body?: unknown, retry = true): Promise<RequestUrlResponse> {
    const token = await this.accessToken();
    const res = await requestUrl({
      url: API + path,
      method,
      headers: { Authorization: `Bearer ${token}` },
      contentType: body ? "application/json" : undefined,
      body: body ? JSON.stringify(body) : undefined,
      throw: false,
    });
    if (res.status === 401 && retry) {
      await this.accessToken(true);
      return this.call(method, path, body, false);
    }
    if (res.status >= 400) {
      let msg = `Google API ${res.status}`;
      try { msg += `: ${res.json?.error?.message ?? ""}`; } catch { /* non-json */ }
      throw new GoogleError(msg, res.status);
    }
    return res;
  }

  // ---------- API ----------

  async listCalendars(): Promise<CalendarInfo[]> {
    const res = await this.call("GET", "/users/me/calendarList?minAccessRole=reader&maxResults=250");
    return (res.json.items ?? []).map((c: any) => ({
      id: c.id,
      name: c.summaryOverride ?? c.summary ?? c.id,
      color: c.backgroundColor ?? "#4ca8df",
      enabled: !!c.primary || !!c.selected,
      readOnly: !(c.accessRole === "owner" || c.accessRole === "writer"),
      primary: !!c.primary,
    }));
  }

  async listEvents(calendarId: string, timeMin: Date, timeMax: Date): Promise<GEvent[]> {
    const out: GEvent[] = [];
    let pageToken = "";
    do {
      const q = form({
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: "true",
        maxResults: "2500",
        ...(pageToken ? { pageToken } : {}),
      });
      const res = await this.call("GET", `/calendars/${encodeURIComponent(calendarId)}/events?${q}`);
      for (const e of res.json.items ?? []) if (e.status !== "cancelled") out.push(e);
      pageToken = res.json.nextPageToken ?? "";
    } while (pageToken);
    return out;
  }

  async insertEvent(calendarId: string, ev: Partial<GEvent>): Promise<GEvent> {
    return (await this.call("POST", `/calendars/${encodeURIComponent(calendarId)}/events`, ev)).json;
  }

  async patchEvent(calendarId: string, eventId: string, patch: Partial<GEvent>): Promise<GEvent> {
    return (await this.call("PATCH", `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, patch)).json;
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    await this.call("DELETE", `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
  }
}

/** Google's fixed event colour palette (colorId 1–11). */
export const EVENT_COLORS: Record<string, string> = {
  "1": "#7986cb", "2": "#33b679", "3": "#8e24aa", "4": "#e67c73", "5": "#f6bf26", "6": "#f4511e",
  "7": "#039be5", "8": "#616161", "9": "#3f51b5", "10": "#0b8043", "11": "#d50000",
};
