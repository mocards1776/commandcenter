import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { habitsApi } from "@/lib/api";
import { HabitRow } from "@/components/habits/HabitRow";
import { HabitModal } from "@/components/habits/HabitModal";
import { Loader2 } from "lucide-react";
import { todayStr } from "@/lib/utils";

function toCDT(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

export function getLast7(): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return toCDT(d);
  });
}

export function dayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/Chicago" }).toUpperCase();
}

function useLiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function HabitsPage() {
  const [newOpen, setNewOpen] = useState(false);
  const today = todayStr();
  const last7 = getLast7();
  const now = useLiveClock();

  const { data: habits, isLoading } = useQuery({
    queryKey: ["habits"],
    queryFn: () => habitsApi.list(),
  });

  const done  = habits?.filter(h => h.completions.some((c: any) => c.completed_date === today)).length ?? 0;
  const total = habits?.length ?? 0;
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0;

  // Live clock strings in CDT
  const timeStr = now.toLocaleTimeString("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  const dateStr = now.toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).toUpperCase();

  const hdrPad: React.CSSProperties = { padding: "5px 10px", gap: 6 };

  return (
    <div style={{ fontFamily: "'Oswald', Arial, sans-serif" }}>

      {/* ── COMMAND CENTER HEADER (mirrors DashboardPage) ── */}
      <div className="top-bar" style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        padding: "8px 24px",
        position: "relative",
        gap: 14,
      }}>
        <span style={{ color: "#e8a820", fontSize: 9, letterSpacing: 5, opacity: 0.6 }}>&#9733; &#9733; &#9733;</span>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, lineHeight: 1 }}>
          <span style={{ fontFamily: "'Inter',sans-serif", fontSize: 14, fontWeight: 900, letterSpacing: "0.15em", color: "rgba(255,255,255,0.75)", textTransform: "uppercase" }}>JOSH'S</span>
          <span style={{ fontFamily: "'Inter',sans-serif", fontSize: 24, fontWeight: 900, letterSpacing: "-0.03em", color: "#ffffff", textTransform: "uppercase" }}>COMMAND CENTER</span>
          <span style={{ fontSize: 14 }}>&#x1F1FA;&#x1F1F8;</span>
        </div>
        <span style={{ color: "#e8a820", fontSize: 9, letterSpacing: 5, opacity: 0.6 }}>&#9733; &#9733; &#9733;</span>

        {/* Date + Time — right side */}
        <div style={{ position: "absolute", right: 24, top: "50%", transform: "translateY(-50%)", textAlign: "right" }}>
          <div style={{
            fontFamily: "'Oswald', Arial, sans-serif",
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: "0.06em",
            color: "#f4c842",
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
          }}>{timeStr}</div>
          <div style={{
            fontSize: 8,
            fontWeight: 600,
            letterSpacing: "0.14em",
            color: "rgba(255,255,255,0.3)",
            marginTop: 3,
          }}>{dateStr}</div>
        </div>
      </div>

      <div className="stripe" />

      {/* ── HABITS PANEL ── */}
      <div style={{ padding: "16px 12px" }}>
        <div style={{
          background: "linear-gradient(180deg, #1e5c38 0%, #154d2c 100%)",
          border: "3px solid #0a1e12",
          boxShadow: "0 10px 50px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.05)",
          overflow: "hidden",
        }}>

          {/* ── TITLE ── */}
          <div style={{
            textAlign: "center",
            padding: "20px 16px 12px",
            borderBottom: "3px solid #0a1e12",
            background: "rgba(0,0,0,0.25)",
          }}>
            <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: "0.28em", color: "#f0ece0", textTransform: "uppercase", lineHeight: 1 }}>HABITS</div>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.18em", color: "rgba(240,236,224,0.3)", marginTop: 5 }}>
              {done}/{total} ENLISTED TODAY &nbsp;·&nbsp; {pct}%
            </div>
          </div>

          {/* ── PROGRESS BAR ── */}
          {total > 0 && (
            <div style={{ height: 4, background: "rgba(0,0,0,0.45)" }}>
              <div style={{
                height: "100%",
                width: `${pct}%`,
                background: "linear-gradient(90deg, #c88a10, #f4c842)",
                transition: "width 0.9s cubic-bezier(0.16,1,0.3,1)",
                boxShadow: "0 0 10px rgba(232,168,32,0.55)",
              }} />
            </div>
          )}

          {/* ── COLUMN HEADERS ── */}
          <div style={{
            display: "flex",
            alignItems: "center",
            borderBottom: "3px solid #0a1e12",
            background: "rgba(0,0,0,0.4)",
            minHeight: 38,
            ...hdrPad,
          }}>
            <div style={{ width: 44, flexShrink: 0, textAlign: "center", fontSize: 8, fontWeight: 700, letterSpacing: "0.18em", color: "rgba(240,236,224,0.35)" }}>P</div>
            <div style={{ width: 162, flexShrink: 0, paddingLeft: 11, fontSize: 8, fontWeight: 700, letterSpacing: "0.18em", color: "rgba(240,236,224,0.35)" }}>HABIT</div>
            <div style={{ display: "flex", flex: 1, gap: 4 }}>
              {last7.map(ds => {
                const isToday = ds === today;
                return (
                  <div key={ds} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "4px 2px" }}>
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", color: isToday ? "#e8a820" : "rgba(240,236,224,0.38)" }}>{dayLabel(ds)}</span>
                    {isToday && <span style={{ fontSize: 7, letterSpacing: "0.1em", color: "rgba(232,168,32,0.5)", marginTop: 2 }}>TODAY</span>}
                  </div>
                );
              })}
            </div>
            <div style={{ width: 3, flexShrink: 0 }} />
            {(["\uD83D\uDD25 STK", "\u2B50 BST", "\uD83D\uDCC5 MTH"] as const).map(label => (
              <div key={label} style={{ width: 54, flexShrink: 0, fontSize: 8, fontWeight: 700, letterSpacing: "0.12em", color: "rgba(240,236,224,0.38)", textAlign: "center", lineHeight: 1.3 }}>{label}</div>
            ))}
          </div>

          {/* ── ROWS ── */}
          {isLoading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
              <Loader2 size={24} style={{ color: "#e8a820", animation: "spin 1s linear infinite" }} />
            </div>
          ) : total === 0 ? (
            <div style={{ padding: "52px 16px", textAlign: "center" }}>
              <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.2em", color: "rgba(240,236,224,0.18)" }}>NO HABITS ENLISTED</p>
              <p style={{ fontFamily: "'IM Fell English',Georgia,serif", fontStyle: "italic", fontSize: 11, marginTop: 8, color: "rgba(240,236,224,0.1)" }}>Discipline is the soul of an army</p>
            </div>
          ) : (
            habits?.map((h, idx) => (
              <HabitRow key={h.id} habit={h} todayStr={today} last7={last7} isEven={idx % 2 === 0} />
            ))
          )}

          {/* ── FOOTER ── */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "12px 16px", borderTop: "3px solid #0a1e12", background: "rgba(0,0,0,0.3)" }}>
            <button
              className="btn btn-solid-gold"
              onClick={() => setNewOpen(true)}
              style={{ letterSpacing: "0.16em", fontSize: 11 }}
            >
              + ENLIST NEW HABIT
            </button>
          </div>
        </div>
      </div>

      <HabitModal open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}
