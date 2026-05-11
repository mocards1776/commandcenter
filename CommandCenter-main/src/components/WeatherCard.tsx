import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  DEFAULT_LAT,
  DEFAULT_LON,
  fetchOpenMeteoForecast,
  weatherCodeLabel,
} from "@/lib/weather";

/** Matches dashboard top-bar: no navy panel — transparent, cream + gold text */
export function WeatherCard() {
  const navigate = useNavigate();
  const lat = DEFAULT_LAT;
  const lon = DEFAULT_LON;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["weather-openmeteo", lat, lon],
    queryFn: () => fetchOpenMeteoForecast(lat, lon),
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
  });

  const current = data?.current;
  const label = current ? weatherCodeLabel(current.weather_code) : "";
  const hi = data?.daily?.temperature_2m_max?.[0];
  const lo = data?.daily?.temperature_2m_min?.[0];

  return (
    <button
      type="button"
      onClick={() => navigate("/weather")}
      className="group absolute top-1/2 z-10 max-w-[min(200px,28vw)] -translate-y-1/2 text-left transition-opacity hover:opacity-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(232,168,32,0.45)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1e3629]"
      style={{ left: 24, background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
      aria-label="Open weather details"
    >
      <div
        style={{
          borderRadius: 4,
          border: "1px solid transparent",
          background: "transparent",
          padding: "4px 2px",
          boxSizing: "border-box",
        }}
      >
        {isLoading && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0", color: "rgba(245,240,224,0.45)" }}>
            <Loader2 size={14} color="#e8a820" style={{ animation: "spin 1s linear infinite" }} aria-hidden />
            <span
              style={{
                fontFamily: "'Oswald', Arial, sans-serif",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "rgba(245,240,224,0.35)",
              }}
            >
              Loading
            </span>
          </div>
        )}
        {isError && (
          <p
            style={{
              fontFamily: "'Oswald', Arial, sans-serif",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "rgba(217,64,64,0.75)",
            }}
          >
            Weather unavailable
          </p>
        )}
        {!isLoading && !isError && current && (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span
                style={{
                  fontFamily: "'Oswald', Arial, sans-serif",
                  fontSize: 26,
                  fontWeight: 700,
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: 1,
                  letterSpacing: "-0.02em",
                  color: "#f5f0e0",
                }}
              >
                {Math.round(current.temperature_2m)}°
              </span>
              <span
                style={{
                  fontFamily: "'Oswald', Arial, sans-serif",
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "rgba(245,240,224,0.45)",
                }}
              >
                {label}
              </span>
            </div>
            <div
              style={{
                marginTop: 4,
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontFamily: "'Oswald', Arial, sans-serif",
                fontSize: 11,
                fontVariantNumeric: "tabular-nums",
                color: "rgba(245,240,224,0.4)",
              }}
            >
              {typeof hi === "number" && typeof lo === "number" ? (
                <>
                  <span>
                    H <span style={{ fontWeight: 700, color: "#e8a820" }}>{Math.round(hi)}°</span>
                  </span>
                  <span style={{ color: "rgba(245,240,224,0.2)" }}>·</span>
                  <span>
                    L <span style={{ fontWeight: 700, color: "rgba(245,240,224,0.55)" }}>{Math.round(lo)}°</span>
                  </span>
                </>
              ) : (
                <span style={{ color: "rgba(245,240,224,0.25)" }}>—</span>
              )}
            </div>
          </>
        )}
      </div>
    </button>
  );
}
