/** Open-Meteo + helpers for Command Center weather UI */

/** Default: Marshfield, MO (Central Time) */
export const DEFAULT_LAT = Number(import.meta.env.VITE_WEATHER_LAT ?? 37.3389);
export const DEFAULT_LON = Number(import.meta.env.VITE_WEATHER_LON ?? -92.9071);
export const WEATHER_TIMEZONE = import.meta.env.VITE_WEATHER_TZ ?? "America/Chicago";
/** Shown on Weather page header */
export const WEATHER_LOCATION_LABEL =
  import.meta.env.VITE_WEATHER_LABEL ?? "Marshfield, MO";

export interface OpenMeteoCurrent {
  temperature_2m: number;
  apparent_temperature: number;
  weather_code: number;
  relative_humidity_2m?: number;
}

export interface OpenMeteoResponse {
  current: OpenMeteoCurrent;
  hourly: {
    time: string[];
    temperature_2m: number[];
    apparent_temperature: number[];
    weather_code: number[];
    /** 0–100 % chance of precipitation */
    precipitation_probability: number[];
  };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    /** 0–100 % max probability of precipitation that day */
    precipitation_probability_max?: number[];
    /** mm total precipitation */
    precipitation_sum?: number[];
  };
}

export async function fetchOpenMeteoForecast(
  lat: number,
  lon: number
): Promise<OpenMeteoResponse> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: [
      "temperature_2m",
      "apparent_temperature",
      "weather_code",
      "relative_humidity_2m",
    ].join(","),
    hourly: ["temperature_2m", "apparent_temperature", "weather_code", "precipitation_probability"].join(","),
    daily: [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_probability_max",
      "precipitation_sum",
    ].join(","),
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    timezone: WEATHER_TIMEZONE,
    forecast_days: "16",
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo error ${res.status}`);
  return res.json();
}

/** WMO weather code → short label for UI */
export function weatherCodeLabel(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 3) return "Cloudy";
  if (code <= 48) return "Fog";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Showers";
  if (code <= 86) return "Snow showers";
  if (code <= 99) return "Storm";
  return "—";
}

/** Slippy map tile X/Y at integer zoom for WGS84 */
export function latLonToTileXY(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const latRad = (lat * Math.PI) / 180;
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return { x, y };
}

export function visualCrossingPrecipTileUrl(
  z: number,
  x: number,
  y: number,
  apiKey: string
): string {
  const base =
    "https://maps.visualcrossing.com/VisualCrossingWebServices/rest/api/v1/map/tile/precipcomposite";
  const q = new URLSearchParams({
    key: apiKey,
    time: "latest",
    unitGroup: "us",
    strict: "false",
  });
  return `${base}/${z}/${x}/${y}.webp?${q.toString()}`;
}

/** RainViewer public API — no key; path is hash-based (see weather-maps.json). */
export async function fetchRainViewerLatestRadarPath(): Promise<{ host: string; path: string }> {
  const res = await fetch("https://api.rainviewer.com/public/weather-maps.json");
  if (!res.ok) throw new Error(`RainViewer maps ${res.status}`);
  const j = (await res.json()) as {
    host?: string;
    radar?: { past?: { path: string }[]; nowcast?: { path: string }[] };
  };
  const host = (j.host ?? "https://tilecache.rainviewer.com").replace(/\/$/, "");
  const nowcast = j.radar?.nowcast ?? [];
  const past = j.radar?.past ?? [];
  const pick = nowcast[nowcast.length - 1] ?? past[past.length - 1];
  if (!pick?.path) throw new Error("No radar frames from RainViewer");
  return { host, path: pick.path };
}

/** 256px slippy tiles; color 2 = classic precip palette, 1_1 = smooth + snow */
export function rainViewerRadarTileUrl(host: string, path: string, z: number, x: number, y: number): string {
  return `${host}${path}/256/${z}/${x}/${y}/2/1_1.png`;
}

export interface WeatherSnapshotCopy {
  headline: string;
  lines: string[];
}

/** Short narrative for the Snapshot panel from Open-Meteo payload */
export function buildWeatherSnapshot(
  data: OpenMeteoResponse,
  tz: string
): WeatherSnapshotCopy {
  const cur = data.current;
  const hourly = data.hourly;
  const daily = data.daily;
  const now = Date.now();
  const idx = hourly.time.findIndex((t) => Date.parse(t) >= now - 45 * 60_000);
  const start = idx < 0 ? 0 : idx;
  const pop = hourly.precipitation_probability ?? [];
  let maxPop = 0;
  let sumPop = 0;
  let n = 0;
  const end = Math.min(start + 24, hourly.time.length);
  for (let i = start; i < end; i++) {
    const p = pop[i];
    if (typeof p === "number") {
      maxPop = Math.max(maxPop, p);
      sumPop += p;
      n++;
    }
  }
  const avgPop = n ? sumPop / n : 0;

  const d1 = daily.time[1];
  const d2 = daily.time[2];
  const fmtShort = (iso: string) =>
    new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: tz });

  const pmax = daily.precipitation_probability_max;
  const psum = daily.precipitation_sum;
  const rainToday =
    typeof pmax?.[0] === "number" && pmax[0] >= 45
      ? `Wet day risk is elevated (${Math.round(pmax[0])}% max chance of rain).`
      : typeof pmax?.[0] === "number" && pmax[0] >= 20
        ? `A few showers possible (${Math.round(pmax[0])}% peak rain chance).`
        : "Rain chances look low for today.";

  const hi0 = daily.temperature_2m_max[0];
  const lo0 = daily.temperature_2m_min[0];
  const hi1 = daily.temperature_2m_max[1];
  const lo1 = daily.temperature_2m_min[1];

  let trend = "";
  if (typeof hi1 === "number" && typeof hi0 === "number") {
    const diff = hi1 - hi0;
    if (diff >= 4) trend = "Tomorrow runs noticeably warmer than today.";
    else if (diff <= -4) trend = "Tomorrow cools off compared to today.";
    else trend = "Tomorrow’s high is similar to today’s.";
  }

  const headline = `${Math.round(cur.temperature_2m)}° and ${weatherCodeLabel(cur.weather_code).toLowerCase()} — feels like ${Math.round(cur.apparent_temperature)}°.`;

  const lines: string[] = [
    typeof cur.relative_humidity_2m === "number"
      ? `Humidity ${Math.round(cur.relative_humidity_2m)}%. Today’s range: high ${Math.round(hi0)}°, low ${Math.round(lo0)}°. ${rainToday}`
      : `Today’s range: high ${Math.round(hi0)}°, low ${Math.round(lo0)}°. ${rainToday}`,
  ];

  if (maxPop >= 35) {
    lines.push(
      avgPop >= 25
        ? `Next 24 hours: frequent rain windows possible (hourly peaks up to ${Math.round(maxPop)}% chance).`
        : `Next 24 hours: a few hours may bring rain (peak ${Math.round(maxPop)}% chance).`,
    );
  } else {
    lines.push("Next 24 hours: mostly manageable precip chances hour to hour.");
  }

  if (d1 && typeof hi1 === "number" && typeof lo1 === "number") {
    lines.push(`${fmtShort(d1)}: high ${Math.round(hi1)}° / low ${Math.round(lo1)}°. ${trend}`);
  }

  if (d2 && pmax && typeof pmax[2] === "number" && pmax[2] >= 40) {
    lines.push(`${fmtShort(d2)}: watch for wet weather (${Math.round(pmax[2])}% max rain chance).`);
  } else if (d2) {
    const code = daily.weather_code[2];
    lines.push(`${fmtShort(d2)}: trending ${weatherCodeLabel(code).toLowerCase()}.`);
  }

  if (psum && typeof psum[0] === "number" && psum[0] >= 0.5) {
    const inches = psum[0] * 0.0393701;
    lines.push(`Today’s modeled rainfall: about ${inches < 0.05 ? "a trace" : `${inches.toFixed(2)} in`} (model).`);
  }

  return { headline, lines };
}
