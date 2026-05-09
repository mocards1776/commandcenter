import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  DEFAULT_LAT,
  DEFAULT_LON,
  fetchOpenMeteoForecast,
  weatherCodeLabel,
} from "@/lib/weather";

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
      className="group absolute left-6 top-1/2 z-10 max-w-[min(200px,28vw)] -translate-y-1/2 text-left transition-opacity hover:opacity-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/55 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1e3629]"
      aria-label="Open weather details"
    >
      <div className="rounded-xl border border-white/10 bg-[#0f172a]/95 px-3 py-2 shadow-lg shadow-black/30 backdrop-blur-sm transition-colors group-hover:border-red-500/35">
        {isLoading && (
          <div className="flex items-center gap-2 py-1 text-slate-400">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            <span className="font-sans text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              Loading
            </span>
          </div>
        )}
        {isError && (
          <p className="font-sans text-[10px] font-medium uppercase tracking-wide text-rose-400/90">
            Weather unavailable
          </p>
        )}
        {!isLoading && !isError && current && (
          <>
            <div className="flex items-baseline gap-1.5">
              <span className="font-sans text-[26px] font-bold tabular-nums leading-none tracking-tight text-white">
                {Math.round(current.temperature_2m)}°
              </span>
              <span className="font-sans text-[11px] font-medium uppercase tracking-wide text-slate-400">
                {label}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2 font-sans text-[11px] tabular-nums text-slate-400">
              {typeof hi === "number" && typeof lo === "number" ? (
                <>
                  <span>
                    H{" "}
                    <span className="font-semibold text-slate-200">{Math.round(hi)}°</span>
                  </span>
                  <span className="text-slate-600">·</span>
                  <span>
                    L{" "}
                    <span className="font-semibold text-slate-200">{Math.round(lo)}°</span>
                  </span>
                </>
              ) : (
                <span className="text-slate-500">—</span>
              )}
            </div>
          </>
        )}
      </div>
    </button>
  );
}
