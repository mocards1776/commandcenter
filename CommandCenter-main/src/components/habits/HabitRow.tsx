import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { habitsApi } from "@/lib/api";
import { HabitModal } from "./HabitModal";
import type { Habit } from "@/types";
import toast from "react-hot-toast";

interface Props {
  habit: Habit;
  todayStr: string;
  last7: string[];
  isEven: boolean;
}

// CDT-safe date string from a Date object
function toCDT(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

// Current streak: consecutive completed days going back from today
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

// Best ever consecutive-day streak
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

// Monthly completion % (days completed / days elapsed so far this month)
function calcMonthPct(completions: { completed_date: string }[]): number {
  // Use CDT for month boundary
  const cdtStr = new Date().toLocaleString("en-US", { timeZone: "America/Chicago" });
  const cdtNow = new Date(cdtStr);
  const y = cdtNow.getFullYear();
  const m = String(cdtNow.getMonth() + 1).padStart(2, "0");
  const dayElapsed = cdtNow.getDate();
  const prefix = `${y}-${m}`;
  const count = completions.filter(c => c.completed_date.startsWith(prefix)).length;
  return Math.round((count / dayElapsed) * 100);
}

export function HabitRow({ habit, todayStr, last7, isEven }: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const qc = useQueryClient();

  const doneSet = new Set(habit.completions.map((c: any) => c.completed_date));
  const isDoneToday = doneSet.has(todayStr);

  const streak = calcStreak(habit.completions, todayStr);
  const best = calcBest(habit.completions);
  const mthPct = calcMonthPct(habit.completions);

  const completeMut = useMutation({
    mutationFn: () => habitsApi.complete(habit.id, todayStr),
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

  // Color for streak number
  const streakColor = streak >= 7 ? "#f4c842" : streak >= 3 ? "#e8a820" : streak > 0 ? "rgba(232,168,32,0.7)" : "rgba(240,236,224,0.22)";
  const bestColor = best >= 14 ? "#f4c842" : best >= 5 ? "#e8a820" : "rgba(240,236,224,0.4)";
  const mthColor = mthPct >= 80 ? "#6dcf6d" : mthPct >= 50 ? "#e8a820" : "rgba(240,236,224,0.35)";

  const rowBase = isEven ? "rgba(0,0,0,0.12)" : "rgba(0,0,0,0.04)";

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          borderBottom: "2px solid #0a1e12",
          background: rowBase,
          minHeight: 58,
          transition: "background 0.12s",
        }}
        onMouseEnter={e => (e.currentTarget.style.background = "rgba(232,168,32,0.035)")}
        onMouseLeave={e => (e.currentTarget.style.background = rowBase)}
      >
        {/* ── HABIT NAME col (like PHILADELPHIA / BOSTON) ── */}
        <div
          style={{
            width: 190,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 10px 0 12px",
            borderRight: "2px solid #0a1e12",
            cursor: "pointer",
            userSelect: "none",
          }}
          onClick={() => setModalOpen(true)}
          title="Edit habit"
        >
          {habit.icon && (
            <span style={{ fontSize: 20, flexShrink: 0, lineHeight: 1 }}>{habit.icon}</span>
          )}
          <span style={{
            fontFamily: "'Oswald', Arial, sans-serif",
            fontWeight: 700,
            fontSize: 14,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: isDoneToday ? "#f0ece0" : "rgba(240,236,224,0.65)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            lineHeight: 1.15,
          }}>
            {habit.name}
          </span>
        </div>

        {/* ── 7-DAY CELLS (innings) ── */}
        <div style={{ display: "flex", flex: 1 }}>
          {last7.map((dateStr, i) => {
            const isToday = dateStr === todayStr;
            const done = doneSet.has(dateStr);
            const missed = dateStr < todayStr && !done; // past day, not completed

            return (
              <div
                key={dateStr}
                onClick={isToday ? handleTodayClick : undefined}
                title={
                  isToday
                    ? isDoneToday ? "Tap to mark incomplete" : "Tap to complete"
                    : done ? `Completed ${dateStr}` : missed ? `Missed ${dateStr}` : ""
                }
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderLeft: i > 0 ? "2px solid #0a1e12" : "none",
                  background: done
                    ? isToday
                      ? "rgba(232,168,32,0.18)"
                      : "rgba(232,168,32,0.09)"
                    : missed
                    ? "rgba(160,30,30,0.08)"
                    : isToday
                    ? "rgba(232,168,32,0.04)"
                    : "transparent",
                  cursor: isToday ? "pointer" : "default",
                  outline: isToday ? "2px solid rgba(232,168,32,0.2)" : "none",
                  outlineOffset: "-2px",
                  transition: "background 0.12s",
                  position: "relative",
                }}
              >
                {done ? (
                  // ✓ checkmark
                  <span style={{
                    fontFamily: "'Oswald', Arial, sans-serif",
                    fontSize: isToday ? 26 : 22,
                    fontWeight: 900,
                    color: isToday ? "#f4c842" : "#c8962a",
                    textShadow: isToday ? "0 0 10px rgba(244,200,66,0.5)" : "none",
                    lineHeight: 1,
                    userSelect: "none",
                  }}>✓</span>
                ) : missed ? (
                  // ✗ missed
                  <span style={{
                    fontFamily: "'Oswald', Arial, sans-serif",
                    fontSize: 20,
                    fontWeight: 700,
                    color: "rgba(195,55,55,0.4)",
                    lineHeight: 1,
                    userSelect: "none",
                  }}>✗</span>
                ) : isToday ? (
                  // today, not yet done — pulsing empty ring
                  <span style={{
                    display: "inline-block",
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    border: "2px solid rgba(232,168,32,0.35)",
                    animation: "pulse-ring 2s ease-in-out infinite",
                  }} />
                ) : (
                  // future or irrelevant
                  <span style={{ fontSize: 10, color: "rgba(240,236,224,0.1)" }}>—</span>
                )}
              </div>
            );
          })}
        </div>

        {/* ── WHITE DIVIDER (like in the scoreboard photo) ── */}
        <div style={{
          width: 3,
          flexShrink: 0,
          background: "#dedad0",
          margin: "0 3px",
          opacity: 0.85,
        }} />

        {/* ── STAT BOXES: Current Streak | Best Streak | Monthly % ── */}
        {[
          { val: streak,           color: streakColor },
          { val: best,             color: bestColor   },
          { val: `${mthPct}%`,     color: mthColor    },
        ].map(({ val, color }, idx2) => (
          <div
            key={idx2}
            style={{
              width: 58,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderLeft: "2px solid #0a1e12",
            }}
          >
            <span style={{
              fontFamily: "'Oswald', Arial, sans-serif",
              fontWeight: 900,
              fontSize: typeof val === "string"
                ? (parseInt(val) >= 100 ? 13 : 15)
                : (val >= 100 ? 13 : val === 0 ? 14 : 18),
              color,
              letterSpacing: "0.02em",
              lineHeight: 1,
              userSelect: "none",
            }}>
              {val}
            </span>
          </div>
        ))}
      </div>

      <HabitModal open={modalOpen} onClose={() => setModalOpen(false)} habit={habit} />
    </>
  );
}
