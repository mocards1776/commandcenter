import type { CSSProperties } from "react";
import { useMemo } from "react";
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
  fetchRainViewerLatestRadarPath,
  rainViewerRadarTileUrl,
  buildWeatherSnapshot,
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

function WeatherGlyph({ code, sizePx }: { code: number; sizePx: number }) {
  const Icon = iconForCode(code);
  return <Icon width={sizePx} height={sizePx} strokeWidth={1.5} color="#f87171" aria-hidden />;
}

function sliceHourlyNext(data: OpenMeteoResponse, count: number) {
  const { time, temperature_2m, apparent_temperature, weather_code, precipitation_probability } = data.hourly;
  const pop = precipitation_probability ?? [];
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
      precipPct: typeof pop[i] === "number" ? pop[i] : null,
    });
  }
  return out;
}

function PrecipRadar({ lat, lon }: { lat: number; lon: number }) {
  const apiKey = (import.meta.env.VITE_VISUAL_CROSSING_API_KEY ?? "").trim();
  const z = 6;
  const { x, y } = latLonToTileXY(lat, lon, z);
  const tilesX = [x - 1, x, x + 1];

  const rainQuery = useQuery({
    queryKey: ["rainviewer-radar-path"],
    queryFn: fetchRainViewerLatestRadarPath,
    staleTime: 4 * 60_000,
    refetchInterval: 10 * 60_000,
    retry: 2,
    enabled: !apiKey,
  });

  const h = "min(260px, 32vw)";
  const frame: CSSProperties = {
    position: "relative",
    width: "100%",
    height: h,
    maxHeight: 300,
    overflow: "hidden",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(2,6,23,0.92)",
    boxSizing: "border-box",
  };

  const footer = (caption: string) => (
    <div
      style={{
        pointerEvents: "none",
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        padding: "12px 16px",
        background: "linear-gradient(to top, rgba(0,0,0,0.88), rgba(0,0,0,0.35), transparent)",
      }}
    >
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)" }}>
        {caption}
      </span>
    </div>
  );

  if (apiKey) {
    return (
      <div style={frame} role="img" aria-label="Precipitation radar map">
        <div style={{ display: "flex", height: "100%", width: "100%" }}>
          {tilesX.map((tx) => (
            <img
              key={`vc-${z}-${tx}-${y}`}
              src={visualCrossingPrecipTileUrl(z, tx, y, apiKey)}
              alt=""
              style={{ height: "100%", minWidth: 0, flex: 1, objectFit: "cover" }}
              loading="lazy"
            />
          ))}
        </div>
        {footer("Radar · Visual Crossing")}
      </div>
    );
  }

  if (rainQuery.isPending) {
    return (
      <div style={{ ...frame, display: "flex", alignItems: "center", justifyContent: "center" }} role="status">
        <Loader2 size={32} color="#f87171" style={{ animation: "spin 1s linear infinite" }} aria-label="Loading radar" />
        {footer("Radar · loading")}
      </div>
    );
  }

  if (rainQuery.isError || !rainQuery.data) {
    return (
      <div
        style={{
          ...frame,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          padding: 24,
          textAlign: "center",
        }}
      >
        <p style={{ fontSize: 13, color: "rgba(248,113,113,0.9)", maxWidth: 420 }}>
          {(rainQuery.error as Error)?.message ?? "Could not load RainViewer radar."}
        </p>
        <p style={{ fontSize: 12, color: "rgba(148,163,184,0.9)" }}>
          Set <code style={{ padding: "2px 6px", borderRadius: 4, background: "rgba(255,255,255,0.08)" }}>VITE_VISUAL_CROSSING_API_KEY</code> to use Visual Crossing tiles instead.
        </p>
      </div>
    );
  }

  const { host, path } = rainQuery.data;
  return (
    <div style={frame} role="img" aria-label="Precipitation radar map">
      <div style={{ display: "flex", height: "100%", width: "100%" }}>
        {tilesX.map((tx) => (
          <img
            key={`${path}-${z}-${tx}-${y}`}
            src={rainViewerRadarTileUrl(host, path, z, tx, y)}
            alt=""
            style={{ height: "100%", minWidth: 0, flex: 1, objectFit: "cover" }}
            loading="lazy"
          />
        ))}
      </div>
      {footer("Radar · RainViewer (no API key)")}
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
  const snapshot = useMemo(() => {
    if (!data) return null;
    try {
      return buildWeatherSnapshot(data, WEATHER_TIMEZONE);
    } catch {
      return null;
    }
  }, [data]);
  const dailyDays = data?.daily?.time?.slice(0, 10) ?? [];
  const hourlyRows = useMemo(() => (data ? sliceHourlyNext(data, 24) : []), [data]);

  /* Same layout idea as DashboardPage: plain div + width:100% + display:grid / flex via inline styles (no Tailwind for structure). */
  const shell: CSSProperties = {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    minHeight: "100vh",
    boxSizing: "border-box",
    position: "relative",
    overflowX: "hidden",
    background: "#050814",
    color: "#e2e8f0",
    paddingBottom: 56,
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
  };

  const contentPad: CSSProperties = {
    width: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    padding: "24px clamp(16px, 2.5vw, 40px)",
    display: "flex",
    flexDirection: "column",
    gap: 32,
  };

  const panel: CSSProperties = {
    borderRadius: 24,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "linear-gradient(145deg, rgba(15,23,42,0.95) 0%, rgba(15,23,42,0.75) 45%, rgba(2,6,23,0.92) 100%)",
    boxShadow: "0 24px 48px rgba(0,0,0,0.45)",
    boxSizing: "border-box",
    padding: "clamp(20px, 3vw, 40px)",
    width: "100%",
    minWidth: 0,
    position: "relative",
    overflow: "hidden",
  };

  const subCard: CSSProperties = {
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(0,0,0,0.28)",
    padding: "14px 18px",
    boxSizing: "border-box",
  };

  return (
    <div style={shell}>
      <div
        style={{
          pointerEvents: "none",
          position: "fixed",
          inset: 0,
          background:
            "radial-gradient(ellipse 120% 80% at 50% -20%, rgba(217,64,64,0.16), transparent 55%), radial-gradient(ellipse 80% 60% at 100% 50%, rgba(59,130,246,0.06), transparent 50%), radial-gradient(ellipse 60% 40% at 0% 80%, rgba(217,64,64,0.05), transparent 45%)",
        }}
      />
      <div
        style={{
          pointerEvents: "none",
          position: "fixed",
          inset: 0,
          background: "linear-gradient(180deg, rgba(15,23,42,0.35) 0%, transparent 35%, transparent 65%, rgba(5,8,20,0.92) 100%)",
        }}
      />

      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 30,
          width: "100%",
          minWidth: 0,
          boxSizing: "border-box",
          borderBottom: "1px solid rgba(255,255,255,0.1)",
          background: "rgba(10,15,28,0.82)",
          backdropFilter: "blur(14px)",
        }}
      >
        <div
          style={{
            display: "flex",
            width: "100%",
            minWidth: 0,
            alignItems: "center",
            gap: 16,
            padding: "16px clamp(16px, 2.5vw, 40px)",
            boxSizing: "border-box",
          }}
        >
          <button
            type="button"
            onClick={() => navigate(-1)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexShrink: 0,
              padding: "10px 16px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(255,255,255,0.06)",
              color: "#cbd5e1",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            <ArrowLeft size={16} aria-hidden />
            Back
          </button>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h1
              style={{
                fontSize: "clamp(1.5rem, 3.5vw, 2.5rem)",
                fontWeight: 900,
                letterSpacing: "-0.02em",
                color: "#fff",
                lineHeight: 1.1,
              }}
            >
              Weather
            </h1>
            <p style={{ marginTop: 6, fontSize: 13, color: "rgba(148,163,184,0.95)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <span style={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "#f87171" }}>{WEATHER_LOCATION_LABEL}</span>
              <span style={{ color: "rgba(100,116,139,0.9)" }}> · </span>
              {WEATHER_TIMEZONE.replace("_", " ")} · {lat.toFixed(2)}°, {lon.toFixed(2)}°
            </p>
          </div>
        </div>
      </header>

      <div style={{ position: "relative", zIndex: 10, ...contentPad }}>
        {isLoading && (
          <div style={{ display: "flex", minHeight: "40vh", width: "100%", alignItems: "center", justifyContent: "center" }}>
            <Loader2 size={44} color="#ef4444" style={{ animation: "spin 1s linear infinite" }} aria-label="Loading" />
          </div>
        )}

        {isError && (
          <div
            style={{
              width: "100%",
              borderRadius: 16,
              border: "1px solid rgba(251,113,133,0.35)",
              background: "rgba(69,10,10,0.45)",
              padding: "40px 28px",
              textAlign: "center",
              color: "#fecdd3",
              boxSizing: "border-box",
            }}
          >
            {(error as Error)?.message ?? "Could not load weather."}
          </div>
        )}

        {!isLoading && !isError && current && data && (
          <>
            <section
              style={{
                display: "grid",
                width: "100%",
                minWidth: 0,
                gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
                gap: 28,
                alignItems: "stretch",
              }}
            >
              <div style={panel}>
                <div style={{ position: "absolute", right: -80, top: -80, width: 288, height: 288, borderRadius: "50%", background: "rgba(220,38,38,0.18)", filter: "blur(48px)" }} />
                <div style={{ position: "absolute", left: -64, bottom: -48, width: 224, height: 224, borderRadius: "50%", background: "rgba(59,130,246,0.08)", filter: "blur(40px)" }} />
                <div
                  style={{
                    position: "relative",
                    zIndex: 1,
                    display: "flex",
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: 32,
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    width: "100%",
                    minWidth: 0,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 24, minWidth: 0, flex: "1 1 280px" }}>
                    <div
                      style={{
                        display: "flex",
                        width: 112,
                        height: 112,
                        flexShrink: 0,
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: 24,
                        border: "1px solid rgba(255,255,255,0.1)",
                        background: "rgba(255,255,255,0.05)",
                        boxShadow: "inset 0 2px 8px rgba(0,0,0,0.35)",
                      }}
                    >
                      <WeatherGlyph code={current.weather_code} sizePx={56} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.28em", textTransform: "uppercase", color: "rgba(148,163,184,0.85)" }}>Right now</p>
                      <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 16 }}>
                        <span style={{ fontSize: "clamp(3.5rem, 10vw, 6rem)", fontWeight: 900, lineHeight: 1, letterSpacing: "-0.04em", color: "#fff" }}>
                          {Math.round(current.temperature_2m)}°
                        </span>
                        <div style={{ marginBottom: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                          <span style={{ fontSize: 18, fontWeight: 600, color: "rgba(254,202,202,0.95)" }}>{weatherCodeLabel(current.weather_code)}</span>
                          <span style={{ fontSize: 14, color: "rgba(148,163,184,0.95)" }}>
                            Feels like <strong style={{ color: "#e2e8f0" }}>{Math.round(current.apparent_temperature)}°</strong>
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                      gap: 12,
                      flex: "0 1 320px",
                      width: "100%",
                      maxWidth: 360,
                      minWidth: 0,
                    }}
                  >
                    <div style={subCard}>
                      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(148,163,184,0.85)" }}>Today</p>
                      <p style={{ marginTop: 8, fontSize: 24, fontWeight: 700, color: "#fff" }}>
                        H {Math.round(data.daily.temperature_2m_max[0])}° · L {Math.round(data.daily.temperature_2m_min[0])}°
                      </p>
                    </div>
                    {typeof current.relative_humidity_2m === "number" && (
                      <div style={{ ...subCard, display: "flex", alignItems: "center", gap: 12 }}>
                        <Droplets size={22} color="rgba(56,189,248,0.85)" style={{ flexShrink: 0 }} />
                        <div>
                          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(148,163,184,0.85)" }}>Humidity</p>
                          <p style={{ fontSize: 18, fontWeight: 700 }}>{Math.round(current.relative_humidity_2m)}%</p>
                        </div>
                      </div>
                    )}
                    <div style={{ ...subCard, gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 12 }}>
                      <Wind size={22} color="rgba(148,163,184,0.85)" style={{ flexShrink: 0 }} />
                      <div>
                        <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(148,163,184,0.85)" }}>Local outlook</p>
                        <p style={{ fontSize: 13, color: "rgba(203,213,225,0.95)" }}>Open-Meteo forecast · updated frequently</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div
                style={{
                  borderRadius: 24,
                  border: "1px solid rgba(239,68,68,0.28)",
                  background: "linear-gradient(180deg, rgba(69,10,10,0.35), transparent)",
                  padding: 24,
                  boxSizing: "border-box",
                  width: "100%",
                  minWidth: 0,
                }}
              >
                <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(248,113,113,0.9)" }}>Snapshot</p>
                {snapshot && (
                  <>
                    <p style={{ marginTop: 14, fontSize: 17, fontWeight: 800, lineHeight: 1.35, color: "#f8fafc", letterSpacing: "-0.02em" }}>
                      {snapshot.headline}
                    </p>
                    <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                      {snapshot.lines.map((line, i) => (
                        <p key={i} style={{ fontSize: 13, lineHeight: 1.6, color: "rgba(148,163,184,0.98)", margin: 0 }}>
                          {line}
                        </p>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </section>

            <section
              style={{
                width: "100%",
                minWidth: 0,
                boxSizing: "border-box",
                borderRadius: 24,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(15,23,42,0.45)",
                padding: "24px clamp(16px, 2vw, 32px)",
                boxShadow: "0 16px 40px rgba(0,0,0,0.35)",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, marginBottom: 20 }}>
                <h2 style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.28em", textTransform: "uppercase", color: "rgba(100,116,139,0.95)" }}>Next hours</h2>
                <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(71,85,105,0.95)" }}>Scroll →</span>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "row",
                  flexWrap: "nowrap",
                  gap: 16,
                  width: "100%",
                  minWidth: 0,
                  overflowX: "auto",
                  paddingTop: 4,
                  paddingBottom: 8,
                  scrollbarWidth: "thin",
                }}
              >
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
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        textAlign: "center",
                        minWidth: 118,
                        flexShrink: 0,
                        padding: "18px 14px",
                        borderRadius: 16,
                        border: "1px solid rgba(255,255,255,0.1)",
                        background: "linear-gradient(180deg, rgba(255,255,255,0.07), transparent)",
                        boxShadow: "0 12px 28px rgba(0,0,0,0.25)",
                        boxSizing: "border-box",
                      }}
                    >
                      <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "rgba(100,116,139,0.95)" }}>{label}</span>
                      <div style={{ margin: "12px 0" }}>
                        <WeatherGlyph code={row.code} sizePx={40} />
                      </div>
                      <span style={{ fontSize: 26, fontWeight: 900, color: "#fff" }}>{Math.round(row.temp)}°</span>
                      <span style={{ marginTop: 6, fontSize: 11, fontWeight: 600, color: "rgba(147,197,253,0.9)" }}>
                        {row.precipPct != null ? `${Math.round(row.precipPct)}% precip` : "—"}
                      </span>
                      <span style={{ marginTop: 4, fontSize: 11, color: "rgba(100,116,139,0.95)" }}>{Math.round(row.feels)}° feel</span>
                    </div>
                  );
                })}
              </div>
            </section>

            <div
              style={{
                display: "grid",
                width: "100%",
                minWidth: 0,
                gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))",
                gap: 28,
                alignItems: "start",
              }}
            >
              <section
                style={{
                  borderRadius: 24,
                  border: "1px solid rgba(255,255,255,0.1)",
                  background: "rgba(15,23,42,0.55)",
                  padding: "24px clamp(16px, 2vw, 32px)",
                  boxSizing: "border-box",
                  width: "100%",
                  minWidth: 0,
                  boxShadow: "0 16px 40px rgba(0,0,0,0.3)",
                }}
              >
                <h2 style={{ marginBottom: 22, fontSize: 11, fontWeight: 800, letterSpacing: "0.28em", textTransform: "uppercase", color: "rgba(100,116,139,0.95)" }}>
                  10-day outlook
                </h2>
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
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
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 20,
                          padding: "18px 0",
                          borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.06)",
                          width: "100%",
                          minWidth: 0,
                          boxSizing: "border-box",
                        }}
                      >
                        <div style={{ width: 112, flexShrink: 0 }}>
                          <p style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>{dow}</p>
                          <p style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(100,116,139,0.9)" }}>{md}</p>
                        </div>
                        <WeatherGlyph code={code} sizePx={44} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <p style={{ fontSize: 15, fontWeight: 500, color: "rgba(203,213,225,0.95)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{weatherCodeLabel(code)}</p>
                        </div>
                        <div style={{ flexShrink: 0, textAlign: "right", fontSize: 22, fontWeight: 900 }}>
                          <span style={{ color: "#fff" }}>{Math.round(hi)}°</span>
                          <span style={{ margin: "0 8px", color: "rgba(71,85,105,0.95)" }}>/</span>
                          <span style={{ color: "rgba(148,163,184,0.95)" }}>{Math.round(lo)}°</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section
                style={{
                  borderRadius: 24,
                  border: "1px solid rgba(255,255,255,0.1)",
                  background: "rgba(15,23,42,0.55)",
                  padding: "24px clamp(16px, 2vw, 32px)",
                  boxSizing: "border-box",
                  width: "100%",
                  minWidth: 0,
                  boxShadow: "0 16px 40px rgba(0,0,0,0.3)",
                }}
              >
                <h2 style={{ marginBottom: 18, fontSize: 11, fontWeight: 800, letterSpacing: "0.28em", textTransform: "uppercase", color: "rgba(100,116,139,0.95)" }}>
                  Precipitation radar
                </h2>
                <PrecipRadar lat={lat} lon={lon} />
                <p style={{ marginTop: 16, fontSize: 12, lineHeight: 1.55, color: "rgba(100,116,139,0.95)" }}>
                  Live composite tiles centered on your coordinates. RainViewer is used when no Visual Crossing key is set; add{" "}
                  <code style={{ padding: "2px 6px", borderRadius: 4, background: "rgba(255,255,255,0.08)", fontSize: 11 }}>VITE_VISUAL_CROSSING_API_KEY</code> to switch providers.
                </p>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
