import { requestUrl } from "obsidian";

export interface HourPoint {
  time: Date;
  temp: number;
  feels: number;
  precipProb: number;
  code: number;
  wind: number;
  humidity: number;
  uv: number;
  isDay: boolean;
}

export interface DayPoint {
  date: string; // YYYY-MM-DD
  code: number;
  max: number;
  min: number;
  precipProb: number;
  sunrise: Date;
  sunset: Date;
  uvMax: number;
}

export interface Forecast {
  fetchedAt: number;
  current: { temp: number; feels: number; code: number; wind: number; humidity: number; isDay: boolean; precip: number };
  hours: HourPoint[];
  days: DayPoint[];
}

export interface Place { name: string; country: string; admin?: string; lat: number; lon: number }

const TTL = 20 * 60_000;

export class WeatherService {
  private cache: { key: string; data: Forecast } | null = null;
  private pending: Promise<Forecast> | null = null;

  async get(lat: number, lon: number, force = false): Promise<Forecast> {
    const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
    if (!force && this.cache?.key === key && Date.now() - this.cache.data.fetchedAt < TTL) return this.cache.data;
    if (this.pending) return this.pending;
    this.pending = this.fetch(lat, lon).then((data) => {
      this.cache = { key, data };
      return data;
    }).finally(() => (this.pending = null));
    return this.pending;
  }

  /** Synchronous access for day headers; null until first load. */
  peek(): Forecast | null {
    return this.cache?.data ?? null;
  }

  private async fetch(lat: number, lon: number): Promise<Forecast> {
    const url = "https://api.open-meteo.com/v1/forecast?" + new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day,precipitation",
      hourly: "temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m,relative_humidity_2m,uv_index,is_day",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,uv_index_max",
      timezone: "auto",
      forecast_days: "10",
    });
    const j = (await requestUrl({ url })).json;
    const h = j.hourly, d = j.daily, c = j.current;
    const hours: HourPoint[] = h.time.map((t: string, i: number) => ({
      time: new Date(t),
      temp: h.temperature_2m[i],
      feels: h.apparent_temperature[i],
      precipProb: h.precipitation_probability[i] ?? 0,
      code: h.weather_code[i],
      wind: h.wind_speed_10m[i],
      humidity: h.relative_humidity_2m[i],
      uv: h.uv_index[i] ?? 0,
      isDay: !!h.is_day[i],
    }));
    const days: DayPoint[] = d.time.map((t: string, i: number) => ({
      date: t,
      code: d.weather_code[i],
      max: d.temperature_2m_max[i],
      min: d.temperature_2m_min[i],
      precipProb: d.precipitation_probability_max[i] ?? 0,
      sunrise: new Date(d.sunrise[i]),
      sunset: new Date(d.sunset[i]),
      uvMax: d.uv_index_max[i] ?? 0,
    }));
    return {
      fetchedAt: Date.now(),
      current: {
        temp: c.temperature_2m, feels: c.apparent_temperature, code: c.weather_code,
        wind: c.wind_speed_10m, humidity: c.relative_humidity_2m, isDay: !!c.is_day, precip: c.precipitation,
      },
      hours,
      days,
    };
  }
}

export async function searchPlaces(q: string): Promise<Place[]> {
  if (q.trim().length < 2) return [];
  const url = "https://geocoding-api.open-meteo.com/v1/search?" + new URLSearchParams({ name: q.trim(), count: "6", language: "uk" });
  const j = (await requestUrl({ url })).json;
  return (j.results ?? []).map((r: any) => ({ name: r.name, country: r.country ?? "", admin: r.admin1, lat: r.latitude, lon: r.longitude }));
}

type Kind = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "storm";

const CODES: Record<number, [string, Kind]> = {
  0: ["Ясно", "clear"],
  1: ["Переважно ясно", "partly"],
  2: ["Мінлива хмарність", "partly"],
  3: ["Хмарно", "cloudy"],
  45: ["Туман", "fog"], 48: ["Паморозь, туман", "fog"],
  51: ["Легка мряка", "drizzle"], 53: ["Мряка", "drizzle"], 55: ["Сильна мряка", "drizzle"],
  56: ["Крижана мряка", "drizzle"], 57: ["Крижана мряка", "drizzle"],
  61: ["Невеликий дощ", "rain"], 63: ["Дощ", "rain"], 65: ["Злива", "rain"],
  66: ["Крижаний дощ", "rain"], 67: ["Крижаний дощ", "rain"],
  71: ["Невеликий сніг", "snow"], 73: ["Сніг", "snow"], 75: ["Сильний сніг", "snow"], 77: ["Снігова крупа", "snow"],
  80: ["Короткочасний дощ", "rain"], 81: ["Зливи", "rain"], 82: ["Сильні зливи", "rain"],
  85: ["Снігопад", "snow"], 86: ["Сильний снігопад", "snow"],
  95: ["Гроза", "storm"], 96: ["Гроза з градом", "storm"], 99: ["Гроза з градом", "storm"],
};

export function describe(code: number): string {
  return CODES[code]?.[0] ?? "—";
}

export function kind(code: number): Kind {
  return CODES[code]?.[1] ?? "cloudy";
}

/** Lucide icon name (built into Obsidian). */
export function icon(code: number, isDay = true): string {
  switch (kind(code)) {
    case "clear": return isDay ? "sun" : "moon";
    case "partly": return isDay ? "cloud-sun" : "cloud-moon";
    case "cloudy": return "cloud";
    case "fog": return "cloud-fog";
    case "drizzle": return "cloud-drizzle";
    case "rain": return "cloud-rain";
    case "snow": return "cloud-snow";
    case "storm": return "cloud-lightning";
  }
}

/** CSS class for the iOS-style sky gradient. */
export function skyClass(code: number, isDay: boolean): string {
  const k = kind(code);
  if (!isDay) return k === "clear" || k === "partly" ? "mc-sky-night" : "mc-sky-night-cloudy";
  if (k === "clear") return "mc-sky-clear";
  if (k === "partly") return "mc-sky-partly";
  if (k === "storm") return "mc-sky-storm";
  if (k === "rain" || k === "drizzle") return "mc-sky-rain";
  if (k === "snow") return "mc-sky-snow";
  return "mc-sky-cloudy";
}
