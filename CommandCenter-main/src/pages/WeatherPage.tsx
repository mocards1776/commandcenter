import { useQuery } from "@tanstack/react-query";
import {
  Loader2,
  ArrowLeft,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudRain,
  CloudSnow,
  CloudSun,
  Sun,
  Zap,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  DEFAULT_LAT,
  DEFAULT_LON,
  WEATHER_LOCATION_LABEL,
  WEATHER_TIMEZONE,
  fetchOpenMeteoForecast,
  latLonToTileXY,
  visualCrossingPrecipTileUrl,
  weatherCodeLabel,
  type OpenMeteoResponse,
} from "@/lib/weather";

function iconForCode(code: number) {
  if (code === 0) return Sun;
  if (code <= 3) return CloudSun;
  if (code <= 48) return CloudFog;
  if (code <= 57) return CloudDrizzle;
  if (code <= 67) return CloudRain;
  if (code <= 77) return CloudSnow;
  if (code <= 82) return CloudRain;
  if (code <= 86) return CloudSnow;
  if (code <= 99) return Zap;
  return Cloud;
}

function WeatherGlyph({ code, className }: { code: number; className?: string }) {
  const Icon = iconForCode(code);
  return <Icon className={className ?? "size-10 text-red-400"} strokeWidth={1.5} aria-hidden />;
}

function sliceHourlyNext(data: OpenMeteoResponse, count: number) {
  const { time, temperature_2m, apparent_temperature, weather_code } = data.hourly;
  const now = Date.now();
  let start = time.findIndex((t) => Date.parse(t) >= now - 45 * 60_000);
  if (start < 0) start = 0;
  const end = Math.min(start + count, time.length);
  const out = [];
  for (let i = start; i < end; i++) {
    out.push({
      time: time[i],
      temp: temperature_2m[i],
      feels: apparent_temperature[i],
      code: weather_code[i],
    });
  }
  return out;
}

function PrecipRadar({ lat, lon }: { lat: number; lon: number }) {
  const apiKey = import.meta.env.VITE_VISUAL_CROSSING_API_KEY ?? "";
  const z = 6;
  const { x, y } = latLonToTileXY(lat, lon, z);

  if (!apiKey) {
    return (
      <div className="flex h-[140px] w-[300px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-600/80 bg-slate-950/60 px-4 text-center">
        <p className="font-sans text-xs leading-relaxed text-slate-500">
          Set{" "}
          <code className="rounded bg-slate-800 px-1 py-0.5 text-[10px] text-red-400">
            VITE_VISUAL_CROSSING_API_KEY
          </code>{" "}
          to load precipitation radar tiles (Visual Crossing Maps API).
        </p>
      </div>
    );
  }

  const tilesX = [x - 1, x, x + 1];
  return (
    <div
      className="relative h-[128px] w-[300px] overflow-hidden rounded-2xl border border-slate-600/80 bg-slate-950 shadow-inner shadow-black/40"
      role="img"
      aria-label="Precipitation radar map"
    >
      <div className="flex h-full w-full">
        {tilesX.map((tx) => (
          <img
            key={`${z}-${tx}-${y}`}
            src={visualCrossingPrecipTileUrl(z, tx, y, apiKey)}
            alt=""
            className="h-full min-w-0 flex-1 object-cover"
            loading="lazy"
          />
        ))}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/90 to-transparent py-2 pl-3">
        <span className="font-sans text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Radar · precip composite
        </span>
      </div>
    </div>
  );
}

export function WeatherPage() {
  const navigate = useNavigate();
  const lat = DEFAULT_LAT;
  const lon = DEFAULT_LON;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["weather-openmeteo", lat, lon],
    queryFn: () => fetchOpenMeteoForecast(lat, lon),
    staleTime: 5 * 60_000,
  });

  const current = data?.current;
  const hourlyRows = data ? sliceHourlyNext(data, 8) : [];
  const dailyDays = data?.daily?.time?.slice(0, 5) ?? [];

  return (
    <div className="min-h-screen bg-[#0b1220] pb-16 pt-0 font-sans text-slate-100">
      {/* Header — navy dashboard style (not scoreboard green) */}
      <header className="sticky top-0 z-20 border-b border-red-900/30 bg-[#0f172a]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-4">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 rounded-lg border border-slate-600/60 bg-slate-800/50 px-3 py-2 text-xs font-semibold uppercase tracking-widest text-slate-300 transition hover:border-red-500/50 hover:bg-slate-800 hover:text-white"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Back
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold tracking-tight text-white md:text-xl">
              Weather
            </h1>
            <p className="truncate text-xs font-medium tracking-wide text-slate-500">
              <span className="font-semibold uppercase tracking-wider text-red-400/90">{WEATHER_LOCATION_LABEL}</span>
              <span className="text-slate-600"> · </span>
              {WEATHER_TIMEZONE.replace("_", " ")} · {lat.toFixed(2)}°, {lon.toFixed(2)}°
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        {isLoading && (
          <div className="flex justify-center py-24">
            <Loader2 className="size-10 animate-spin text-red-500" aria-label="Loading" />
          </div>
        )}

        {isError && (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-950/40 px-6 py-8 text-center text-sm text-rose-200">
            {(error as Error)?.message ?? "Could not load weather."}
          </div>
        )}

        {!isLoading && !isError && current && data && (
          <>
            {/* Current */}
            <section className="rounded-2xl border border-slate-700/80 bg-gradient-to-br from-slate-900 to-[#0f172a] p-6 shadow-[0_0_40px_-12px_rgba(217,64,64,0.18)] md:p-8">
              <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-6">
                  <WeatherGlyph code={current.weather_code} className="size-16 shrink-0 text-red-400 md:size-20" />
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">
                      Now
                    </p>
                    <div className="mt-1 flex flex-wrap items-end gap-3">
                      <span className="text-5xl font-bold tabular-nums tracking-tight text-white md:text-6xl">
                        {Math.round(current.temperature_2m)}°
                      </span>
                      <span className="pb-1 text-lg font-medium text-slate-400">
                        Feels {Math.round(current.apparent_temperature)}°
                      </span>
                    </div>
                    <p className="mt-2 text-base font-medium text-red-200/90">
                      {weatherCodeLabel(current.weather_code)}
                    </p>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-700/60 bg-slate-950/50 px-5 py-4 md:text-right">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Today
                  </p>
                  <p className="mt-2 font-sans text-2xl font-semibold tabular-nums text-white">
                    H {Math.round(data.daily.temperature_2m_max[0])}° · L{" "}
                    {Math.round(data.daily.temperature_2m_min[0])}°
                  </p>
                  {typeof current.relative_humidity_2m === "number" && (
                    <p className="mt-2 text-sm text-slate-400">
                      Humidity {Math.round(current.relative_humidity_2m)}%
                    </p>
                  )}
                </div>
              </div>
            </section>

            {/* Hourly */}
            <section className="rounded-2xl border border-slate-700/80 bg-slate-900/60 p-6 shadow-lg shadow-black/20">
              <h2 className="mb-4 font-sans text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
                Next hours
              </h2>
              <div className="-mx-1 flex gap-3 overflow-x-auto pb-2 pt-1 [scrollbar-width:thin]">
                {hourlyRows.map((row) => {
                  const t = new Date(row.time);
                  const label = t.toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                    timeZone: WEATHER_TIMEZONE,
                  });
                  return (
                    <div
                      key={row.time}
                      className="flex min-w-[92px] shrink-0 flex-col items-center rounded-xl border border-slate-700/70 bg-[#0f172a] px-3 py-4 text-center"
                    >
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {label}
                      </span>
                      <WeatherGlyph code={row.code} className="my-2 size-9 text-red-400" />
                      <span className="text-lg font-bold tabular-nums text-white">
                        {Math.round(row.temp)}°
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {Math.round(row.feels)}° feel
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            <div className="grid gap-6 md:grid-cols-2 md:items-start">
              {/* Daily */}
              <section className="rounded-2xl border border-slate-700/80 bg-slate-900/60 p-6 shadow-lg shadow-black/20">
                <h2 className="mb-4 font-sans text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
                  5-day outlook
                </h2>
                <ul className="space-y-0 divide-y divide-slate-800">
                  {dailyDays.map((day, i) => {
                    const code = data.daily.weather_code[i];
                    const hi = data.daily.temperature_2m_max[i];
                    const lo = data.daily.temperature_2m_min[i];
                    const d = new Date(day + "T12:00:00");
                    const dow = d.toLocaleDateString("en-US", {
                      weekday: "short",
                      timeZone: WEATHER_TIMEZONE,
                    });
                    const md = d.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      timeZone: WEATHER_TIMEZONE,
                    });
                    return (
                      <li
                        key={day}
                        className="flex items-center gap-4 py-4 first:pt-0 last:pb-0"
                      >
                        <div className="w-24 shrink-0">
                          <p className="font-semibold text-white">{dow}</p>
                          <p className="text-xs text-slate-500">{md}</p>
                        </div>
                        <WeatherGlyph code={code} className="size-9 shrink-0 text-red-400" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-slate-300">{weatherCodeLabel(code)}</p>
                        </div>
                        <div className="shrink-0 text-right font-semibold tabular-nums">
                          <span className="text-white">{Math.round(hi)}°</span>
                          <span className="mx-1 text-slate-600">/</span>
                          <span className="text-slate-400">{Math.round(lo)}°</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>

              {/* Radar */}
              <section className="rounded-2xl border border-slate-700/80 bg-slate-900/60 p-6 shadow-lg shadow-black/20">
                <h2 className="mb-4 font-sans text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
                  Precipitation radar
                </h2>
                <PrecipRadar lat={lat} lon={lon} />
                <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
                  Composite precipitation overlay (Visual Crossing). Position follows your configured
                  coordinates.
                </p>
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
