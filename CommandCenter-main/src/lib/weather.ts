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
  };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
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
    hourly: ["temperature_2m", "apparent_temperature", "weather_code"].join(","),
    daily: ["weather_code", "temperature_2m_max", "temperature_2m_min"].join(","),
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    timezone: WEATHER_TIMEZONE,
    forecast_days: "7",
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
