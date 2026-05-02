import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { habitsApi } from "@/lib/api";
import { HabitModal } from "./HabitModal";
import type { Habit } from "@/types";
import toast from "react-hot-toast";

interface Props {
  habit: Habit;
  todayStr: string;
  last7?: string[];
  isEven?: boolean;
}

function toCDT(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function fmtTime(hour?: number | null, minute?: number | null): string {
  if (hour == null) return "—";
  const h12 = hour % 12 || 12;
  const ampm = hour < 12 ? "A" : "P";
  if (!minute) return `${h12}${ampm}`;
  return `${h12}:${String(minute).padStart(2, "0")}${ampm}`;
}

function calcStreak(completions: { completed_date: string }[], today: string): number {
  const dates = new Set(completions.map(c => c.completed_date));
  let streak = 0;
  let cur = today;
  while (dates.has(cur)) {
    streak++;
    const d = new Date(cur + "T12:00:00");
    d.setDate(d.getDate() - 1);
    cur = toCDT(d);
  }
  return streak;
}

function calcBest(completions: { completed_date: string }[]): number {
  if (!completions.length) return 0;
  const sorted = [...completions.map(c => c.completed_date)].sort();
  let best = 1, cur = 1;
  for (let i = 1; i < sorted.length; i++) {
    const diff = Math.round(
      (new Date(sorted[i] + "T12:00:00").getTime() - new Date(sorted[i - 1] + "T12:00:00").getTime()) / 86400000
    );
    if (diff === 1) { cur++; if (cur > best) best = cur; }
    else cur = 1;
  }
  return best;
}

function calcMonthPct(completions: { completed_date: string }[]): number {
  const cdtNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
  const y = cdtNow.getFullYear();
  const m = String(cdtNow.getMonth() + 1).padStart(2, "0");
  const dayElapsed = cdtNow.getDate();
  const prefix = `${y}-${m}`;
  const count = completions.filter(c => c.completed_date.startsWith(prefix)).length;
  return Math.round((count / dayElapsed) * 100);
}

// Scoreboard inset panel — used on the habits page only
function slot(overrides?: React.CSSProperties): React.CSSProperties {
  return {
    background: "rgba(0,0,0,0.45)",
    border: "1.5px solid rgba(240,236,224,0.08)",
    borderRadius: 5,
    boxShadow: "inset 0 2px 8px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.03)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "column" as const,
    flexShrink: 0,
    ...overrides,
  };
}

export function HabitRow({ habit, todayStr, last7 = [], isEven = false }: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const qc = useQueryClient();

  // Guard: completions may be undefined if the backend returns a partial habit object
  const doneSet = new Set((habit.completions ?? []).map((c: any) => c.completed_date));
  const isDoneToday = doneSet.has(todayStr);

  const streak = calcStreak(habit.completions ?? [], todayStr);
  const best = calcBest(habit.completions ?? []);
  const mthPct = calcMonthPct(habit.completions ?? []);

  const streakColor = streak >= 7 ? "#f4c842" : streak >= 3 ? "#e8a820" : streak > 0 ? "rgba(232,168,32,0.7)" : "rgba(240,236,224,0.22)";
  const bestColor   = best   >= 14 ? "#f4c842" : best   >= 5  ? "#e8a820" : "rgba(240,236,224,0.4)";
  const mthColor    = mthPct >= 80 ? "#6dcf6d" : mthPct >= 50 ? "#e8a820" : "rgba(240,236,224,0.35)";

  const completeMut = useMutation({
    mutationFn: () => habitsApi.complete(habit.id, { completed_date: todayStr }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["habits"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(`${habit.icon ?? "🔥"} ${habit.name}`, { duration: 1800 });
    },
  });

  const uncompleteMut = useMutation({
    mutationFn: () => habitsApi.uncomplete(habit.id, todayStr),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["habits"] }),
  });

  const handleTodayClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (completeMut.isPending || uncompleteMut.isPending) return;
    isDoneToday ? uncompleteMut.mutate() : completeMut.mutate();
  };

  // ─────────────────────────────────────────────────────────────────────────
  // DASHBOARD MODE — classic circle-checkbox + name + dots
  // Only used when the dashboard passes no last7 prop
  // ─────────────────────────────────────────────────────────────────────────
  if (last7.length === 0) {
    // Build last 8 days ending today
    const last8 = Array.from({ length: 8 }, (_, i) => {
      const d = new Date(todayStr + "T12:00:00");
      d.setDate(d.getDate() - (7 - i));
      return toCDT(d);
    });

    const rowBg = isEven ? "rgba(0,0,0,0.10)" : "transparent";

    return (
      <>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "7px 14px",
            gap: 10,
            borderBottom: "1px solid rgba(240,236,224,0.05)",
            background: rowBg,
            cursor: "default",
            transition: "background 0.12s",
          }}
          onMouseEnter={e => (e.currentTarget.style.background = "rgba(232,168,32,0.04)")}
          onMouseLeave={e => (e.currentTarget.style.background = rowBg)}
        >
          {/* Circle checkbox */}
          <div
            onClick={handleTodayClick}
            title={isDoneToday ? "Mark incomplete" : "Mark complete"}
            style={{ cursor: "pointer", flexShrink: 0, lineHeight: 0 }}
          >
            {isDoneToday ? (
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <circle cx="11" cy="11" r="10" stroke="#e8a820" strokeWidth="1.5" />
                <circle cx="11" cy="11" r="7" fill="#e8a820" />
                <path d="M7.5 11l2.5 2.5 4.5-4.5" stroke="#1a2e1f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <circle cx="11" cy="11" r="10" stroke="rgba(240,236,224,0.25)" strokeWidth="1.5" />
              </svg>
            )}
          </div>

          {/* Habit name */}
          <div
            onClick={() => setModalOpen(true)}
            title="Edit habit"
            style={{ flex: 1, cursor: "pointer", minWidth: 0 }}
          >
            <span style={{
              fontFamily: "'Oswald', Arial, sans-serif",
              fontWeight: 700,
              fontSize: 13,
              letterSpacing: "0.10em",
              textTransform: "uppercase",
              color: isDoneToday ? "#f0ece0" : "rgba(240,236,224,0.55)",
              display: "flex",
              alignItems: "center",
              gap: 6,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>
              {habit.icon && <span style={{ fontSize: 14, flexShrink: 0 }}>{habit.icon}</span>}
              {habit.name}
            </span>
          </div>

          {/* 8-day dot row */}
          <div style={{ display: "flex", gap: 3, alignItems: "center", flexShrink: 0 }}>
            {last8.map(d => {
              const done  = doneSet.has(d);
              const isT   = d === todayStr;
              const isFut = d > todayStr;
              return (
                <div
                  key={d}
                  style={{
                    width:  done ? 8 : isT ? 7 : 6,
                    height: done ? 8 : isT ? 7 : 6,
                    borderRadius: "50%",
                    flexShrink: 0,
                    background: done
                      ? isT ? "#f4c842" : "rgba(232,168,32,0.55)"
                      : isFut ? "rgba(240,236,224,0.06)"
                      : isT  ? "rgba(232,168,32,0.18)"
                      : "rgba(240,236,224,0.10)",
                    border: isT && !done ? "1px solid rgba(232,168,32,0.35)" : "none",
                    boxShadow: done && isT ? "0 0 6px rgba(244,200,66,0.55)" : "none",
                    transition: "all 0.15s",
                  }}
                />
              );
            })}
          </div>
        </div>

        <HabitModal open={modalOpen} onClose={() => setModalOpen(false)} habit={habit} />
      </>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HABITS PAGE MODE — full scoreboard slot layout (UNCHANGED)
  // ─────────────────────────────────────────────────────────────────────────
  const rowBg = isEven ? "rgba(0,0,0,0.12)" : "rgba(0,0,0,0.04)";
  const timeStr = fmtTime(habit.time_hour, habit.time_minute);
  const hasTime = habit.time_hour != null;

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          borderBottom: "2px solid #0a1e12",
          background: rowBg,
          minHeight: 64,
          padding: "6px 10px",
          gap: 6,
          transition: "background 0.12s",
        }}
        onMouseEnter={e => (e.currentTarget.style.background = "rgba(232,168,32,0.04)")}
        onMouseLeave={e => (e.currentTarget.style.background = rowBg)}
      >

        {/* ── P column: TIME SLOT ── */}
        <div style={slot({ width: 44, height: 50 })}>
          <span style={{
            fontFamily: "'Oswald', Arial, sans-serif",
            fontWeight: 700,
            fontSize: hasTime ? 12 : 18,
            letterSpacing: "0.04em",
            lineHeight: 1.1,
            textAlign: "center",
            color: hasTime ? "rgba(232,168,32,0.9)" : "rgba(240,236,224,0.15)",
          }}>{timeStr}</span>
        </div>

        {/* ── HABIT NAME ── */}
        <div
          onClick={() => setModalOpen(true)}
          title="Edit habit"
          style={{
            width: 162,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 7,
            cursor: "pointer",
            userSelect: "none",
            padding: "0 4px",
          }}
        >
          {habit.icon && (
            <span style={{ fontSize: 18, flexShrink: 0, lineHeight: 1 }}>{habit.icon}</span>
          )}
          <span style={{
            fontFamily: "'Oswald', Arial, sans-serif",
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: "0.10em",
            textTransform: "uppercase",
            color: isDoneToday ? "#f0ece0" : "rgba(240,236,224,0.6)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            lineHeight: 1.2,
          }}>
            {habit.name}
          </span>
        </div>

        {/* ── DAY SLOTS (7-day full view) ── */}
        <div style={{ display: "flex", flex: 1, gap: 4 }}>
          {last7.map(dateStr => {
            const isToday  = dateStr === todayStr;
            const done     = doneSet.has(dateStr);
            const missed   = dateStr < todayStr && !done;

            return (
              <div
                key={dateStr}
                onClick={isToday ? handleTodayClick : undefined}
                title={
                  isToday   ? (isDoneToday ? "Mark incomplete" : "Mark complete")
                  : done    ? `Done ✓ ${dateStr}`
                  : missed  ? `Missed ${dateStr}`
                  : undefined
                }
                style={slot({
                  flex: 1,
                  height: 50,
                  cursor: isToday ? "pointer" : "default",
                  background: done
                    ? isToday ? "rgba(232,168,32,0.22)" : "rgba(232,168,32,0.10)"
                    : missed  ? "rgba(150,25,25,0.14)"
                    : isToday ? "rgba(232,168,32,0.06)"
                    : "rgba(0,0,0,0.45)",
                  border: isToday
                    ? `1.5px solid rgba(232,168,32,${isDoneToday ? "0.5" : "0.28"})`
                    : "1.5px solid rgba(240,236,224,0.07)",
                  boxShadow: done && isToday
                    ? "inset 0 2px 8px rgba(0,0,0,0.35), 0 0 12px rgba(232,168,32,0.18)"
                    : "inset 0 2px 8px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.03)",
                })}
              >
                {done ? (
                  <span style={{
                    fontFamily: "'Oswald', Arial, sans-serif",
                    fontSize: isToday ? 26 : 20,
                    fontWeight: 900,
                    lineHeight: 1,
                    userSelect: "none",
                    color: isToday ? "#f4c842" : "#c8962a",
                    textShadow: isToday ? "0 0 14px rgba(244,200,66,0.6)" : "none",
                  }}>✓</span>
                ) : missed ? (
                  <span style={{ fontSize: 16, fontWeight: 700, lineHeight: 1, userSelect: "none", color: "rgba(200,50,50,0.45)" }}>✗</span>
                ) : isToday ? (
                  <span style={{
                    display: "inline-block",
                    width: 15,
                    height: 15,
                    borderRadius: "50%",
                    border: "2px solid rgba(232,168,32,0.42)",
                    animation: "pulse-ring 2s ease-in-out infinite",
                  }} />
                ) : (
                  <span style={{ fontSize: 10, color: "rgba(240,236,224,0.07)" }}>—</span>
                )}
              </div>
            );
          })}
        </div>

        {/* ── WHITE DIVIDER (matches scoreboard's R|H|E bar) ── */}
        <div style={{ width: 3, height: 48, flexShrink: 0, background: "#dedad0", borderRadius: 1, opacity: 0.88 }} />

        {/* ── STAT SLOTS: streak / best / month% ── */}
        {[
          { val: streak,        color: streakColor },
          { val: best,          color: bestColor   },
          { val: `${mthPct}%`,  color: mthColor    },
        ].map(({ val, color }, i) => (
          <div key={i} style={slot({ width: 54, height: 50 })}>
            <span style={{
              fontFamily: "'Oswald', Arial, sans-serif",
              fontWeight: 900,
              fontSize: typeof val === "string"
                ? (parseInt(val) >= 100 ? 12 : 14)
                : (val >= 100 ? 12 : val === 0 ? 14 : 20),
              color,
              letterSpacing: "0.02em",
              lineHeight: 1,
              userSelect: "none",
            }}>{val}</span>
          </div>
        ))}
      </div>

      <HabitModal open={modalOpen} onClose={() => setModalOpen(false)} habit={habit} />
    </>
  );
}
