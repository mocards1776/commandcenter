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
  Droplets,
  Wind,
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
      <div className="flex min-h-[180px] w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/15 bg-black/30 px-6 py-10 text-center backdrop-blur-sm">
        <p className="max-w-md font-sans text-sm leading-relaxed text-slate-400">
          Add{" "}
          <code className="rounded-md bg-white/10 px-2 py-1 font-mono text-xs text-red-300">
            VITE_VISUAL_CROSSING_API_KEY
          </code>{" "}
          for live precipitation radar tiles.
        </p>
      </div>
    );
  }

  const tilesX = [x - 1, x, x + 1];
  return (
    <div
      className="relative h-[min(220px,28vw)] w-full max-h-[280px] overflow-hidden rounded-2xl border border-white/10 bg-slate-950/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
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
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent px-4 py-3">
        <span className="font-sans text-[10px] font-bold uppercase tracking-[0.25em] text-white/50">
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
    <div className="relative min-h-screen w-full overflow-x-hidden bg-[#050814] pb-20 pt-0 font-sans text-slate-100">
      {/* Atmospheric layers */}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,rgba(217,64,64,0.18),transparent_55%),radial-gradient(ellipse_80%_60%_at_100%_50%,rgba(59,130,246,0.08),transparent_50%),radial-gradient(ellipse_60%_40%_at_0%_80%,rgba(217,64,64,0.06),transparent_45%)]" />
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(180deg,rgba(15,23,42,0.4)_0%,transparent_35%,transparent_65%,rgba(5,8,20,0.9)_100%)]" />

      {/* Header — full width */}
      <header className="sticky top-0 z-30 w-full border-b border-white/10 bg-[#0a0f1c]/80 backdrop-blur-xl">
        <div className="flex w-full items-center gap-4 px-4 py-4 sm:px-8 lg:px-12 xl:px-16">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex shrink-0 items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-xs font-bold uppercase tracking-[0.2em] text-slate-300 transition hover:border-red-400/40 hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Back
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-2xl font-black tracking-tight text-transparent sm:text-3xl md:text-4xl">
              Weather
            </h1>
            <p className="mt-1 truncate text-xs font-medium tracking-wide text-slate-500 sm:text-sm">
              <span className="font-bold uppercase tracking-wider text-red-400/95">{WEATHER_LOCATION_LABEL}</span>
              <span className="text-slate-600"> · </span>
              {WEATHER_TIMEZONE.replace("_", " ")} · {lat.toFixed(2)}°, {lon.toFixed(2)}°
            </p>
          </div>
        </div>
      </header>

      <main className="relative z-10 w-full space-y-8 px-4 py-8 sm:space-y-10 sm:px-8 lg:space-y-12 lg:px-12 xl:px-16">
        {isLoading && (
          <div className="flex min-h-[40vh] w-full items-center justify-center">
            <Loader2 className="size-12 animate-spin text-red-500 drop-shadow-[0_0_24px_rgba(239,68,68,0.5)]" aria-label="Loading" />
          </div>
        )}

        {isError && (
          <div className="w-full rounded-2xl border border-rose-500/30 bg-rose-950/50 px-8 py-12 text-center text-rose-100 shadow-xl">
            {(error as Error)?.message ?? "Could not load weather."}
          </div>
        )}

        {!isLoading && !isError && current && data && (
          <>
            {/* Hero — edge-to-edge feel */}
            <section className="grid w-full gap-6 lg:grid-cols-12 lg:gap-8 xl:gap-10">
              <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900/90 via-[#0f172a] to-[#020617] p-8 shadow-2xl shadow-black/50 lg:col-span-8 lg:p-10 xl:p-12">
                <div className="absolute -right-20 -top-20 size-72 rounded-full bg-red-600/20 blur-3xl" />
                <div className="absolute -bottom-16 -left-16 size-56 rounded-full bg-blue-500/10 blur-3xl" />
                <div className="relative flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-start gap-6 md:gap-10">
                    <div className="flex size-24 shrink-0 items-center justify-center rounded-3xl border border-white/10 bg-white/5 shadow-inner shadow-black/40 md:size-32">
                      <WeatherGlyph code={current.weather_code} className="size-14 text-red-400 md:size-[4.5rem]" />
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.35em] text-slate-500">Right now</p>
                      <div className="mt-3 flex flex-wrap items-end gap-4">
                        <span className="text-7xl font-black tabular-nums leading-none tracking-tighter text-white drop-shadow-lg md:text-8xl xl:text-9xl">
                          {Math.round(current.temperature_2m)}°
                        </span>
                        <div className="mb-2 flex flex-col gap-1">
                          <span className="text-lg font-semibold text-red-200/90 md:text-xl">
                            {weatherCodeLabel(current.weather_code)}
                          </span>
                          <span className="text-sm text-slate-400">
                            Feels like{" "}
                            <span className="font-bold text-slate-200">{Math.round(current.apparent_temperature)}°</span>
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-1 md:max-w-xs">
                    <div className="rounded-2xl border border-white/10 bg-black/25 px-5 py-4 backdrop-blur-md">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Today</p>
                      <p className="mt-2 text-2xl font-bold tabular-nums text-white">
                        H {Math.round(data.daily.temperature_2m_max[0])}° · L {Math.round(data.daily.temperature_2m_min[0])}°
                      </p>
                    </div>
                    {typeof current.relative_humidity_2m === "number" && (
                      <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/25 px-4 py-3 backdrop-blur-md">
                        <Droplets className="size-5 shrink-0 text-sky-400/80" />
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Humidity</p>
                          <p className="text-lg font-bold tabular-nums">{Math.round(current.relative_humidity_2m)}%</p>
                        </div>
                      </div>
                    )}
                    <div className="col-span-2 flex items-center gap-3 rounded-2xl border border-white/10 bg-black/25 px-4 py-3 backdrop-blur-md sm:col-span-1">
                      <Wind className="size-5 shrink-0 text-slate-400" />
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Local outlook</p>
                        <p className="text-sm text-slate-300">Open-Meteo forecast · updated frequently</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Side accent column */}
              <div className="flex flex-col gap-4 lg:col-span-4">
                <div className="flex-1 rounded-3xl border border-red-500/20 bg-gradient-to-b from-red-950/40 to-transparent p-6 backdrop-blur-sm">
                  <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-red-400/80">Snapshot</p>
                  <p className="mt-4 font-sans text-sm leading-relaxed text-slate-400">
                    Full-width dashboard-style weather for your location. Scroll for hourly motion and multi-day trend.
                  </p>
                </div>
              </div>
            </section>

            {/* Hourly — full width strip */}
            <section className="w-full rounded-3xl border border-white/10 bg-slate-900/40 p-6 shadow-xl backdrop-blur-sm sm:p-8">
              <div className="mb-5 flex items-end justify-between gap-4">
                <h2 className="font-sans text-xs font-black uppercase tracking-[0.3em] text-slate-500">Next hours</h2>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">Scroll →</span>
              </div>
              <div className="-mx-2 flex gap-4 overflow-x-auto pb-3 pt-1 [scrollbar-width:thin]">
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
                      className="flex min-w-[108px] shrink-0 flex-col items-center rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.07] to-transparent px-4 py-5 text-center shadow-lg shadow-black/20"
                    >
                      <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
                      <WeatherGlyph code={row.code} className="my-3 size-10 text-red-400" />
                      <span className="text-2xl font-black tabular-nums text-white">{Math.round(row.temp)}°</span>
                      <span className="mt-1 text-[11px] text-slate-500">{Math.round(row.feels)}° feel</span>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Daily + Radar — wide grid */}
            <div className="grid w-full gap-8 lg:grid-cols-12 lg:gap-10">
              <section className="rounded-3xl border border-white/10 bg-slate-900/50 p-6 shadow-xl backdrop-blur-md sm:p-8 lg:col-span-7">
                <h2 className="mb-6 font-sans text-xs font-black uppercase tracking-[0.3em] text-slate-500">
                  5-day outlook
                </h2>
                <ul className="divide-y divide-white/5">
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
                      <li key={day} className="flex items-center gap-5 py-5 first:pt-0 last:pb-0">
                        <div className="w-28 shrink-0 md:w-32">
                          <p className="text-lg font-bold text-white">{dow}</p>
                          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{md}</p>
                        </div>
                        <WeatherGlyph code={code} className="size-11 shrink-0 text-red-400" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-base font-medium text-slate-300">{weatherCodeLabel(code)}</p>
                        </div>
                        <div className="shrink-0 text-right text-xl font-black tabular-nums">
                          <span className="text-white">{Math.round(hi)}°</span>
                          <span className="mx-2 text-slate-600">/</span>
                          <span className="text-slate-400">{Math.round(lo)}°</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section className="rounded-3xl border border-white/10 bg-slate-900/50 p-6 shadow-xl backdrop-blur-md sm:p-8 lg:col-span-5">
                <h2 className="mb-5 font-sans text-xs font-black uppercase tracking-[0.3em] text-slate-500">
                  Precipitation radar
                </h2>
                <PrecipRadar lat={lat} lon={lon} />
                <p className="mt-4 text-xs leading-relaxed text-slate-500">
                  Visual Crossing precip composite · centered on your coordinates.
                </p>
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
