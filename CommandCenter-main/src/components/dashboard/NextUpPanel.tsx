import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Task, TimeBlock } from "@/types";
import { useUIStore } from "@/store";
import { formatMinutes, isOverdue } from "@/lib/utils";
import api from "@/lib/api";

const PRIORITY_WEIGHT: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const ACCENT: Record<string, string> = {
  critical: "#d94040", high: "#e8a820",
  medium: "rgba(255,255,255,0.3)", low: "rgba(255,255,255,0.12)",
};

// ── Scoreboard flip panel for a single 2-digit number ────────────
function FlipPanel({ value, label }: { value: string; label: string }) {
  const prevRef = useRef(value);
  const [flipping, setFlipping] = useState(false);
  const [displayed, setDisplayed] = useState(value);

  useEffect(() => {
    if (value !== prevRef.current) {
      setFlipping(true);
      const tid = setTimeout(() => {
        setDisplayed(value);
        prevRef.current = value;
        setFlipping(false);
      }, 180);
      return () => clearTimeout(tid);
    } else {
      setDisplayed(value);
    }
  }, [value]);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <div
        className={`panel${flipping ? " flip-panel" : ""}`}
        style={{
          width: 54, height: 54, perspective: 300,
          boxShadow: "inset 0 3px 6px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.04)",
        }}
      >
        <span className="panel-num gold" style={{ fontSize: 30, letterSpacing: "-0.02em" }}>
          {displayed}
        </span>
      </div>
      <span className="panel-sub" style={{ fontSize: 8, letterSpacing: "0.14em" }}>{label}</span>
    </div>
  );
}

// ── Live countdown ticking every second ──────────────────────────
function EventCountdown({ event }: { event: TimeBlock }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const target = new Date(event.start_time).getTime();
  const diffMs = target - now;

  // Format the event time for display
  const startDate = new Date(event.start_time);
  const timeStr = startDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (diffMs <= 0) {
    return (
      <div style={{ padding: "14px 14px 16px", display: "flex", alignItems: "center", gap: 10 }}>
        <div className="live-dot" />
        <div>
          <div style={{
            fontFamily: "'Oswald',Arial,sans-serif", fontSize: 13, fontWeight: 700,
            letterSpacing: "0.08em", textTransform: "uppercase", color: "#d94040",
          }}>IN PROGRESS</div>
          <div style={{
            fontFamily: "'Oswald',Arial,sans-serif", fontSize: 10, color: "rgba(245,240,224,0.35)",
            letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 2,
          }}>{timeStr}</div>
        </div>
      </div>
    );
  }

  const totalMins = Math.floor(diffMs / 60_000);
  const hours = Math.min(Math.floor(totalMins / 60), 99);
  const mins = totalMins % 60;
  const hh = String(hours).padStart(2, "0");
  const mm = String(mins).padStart(2, "0");

  return (
    <div style={{ padding: "12px 14px 14px" }}>
      {/* Event title */}
      <div style={{
        fontFamily: "'Oswald',Arial,sans-serif",
        fontSize: 13, fontWeight: 700,
        letterSpacing: "0.07em", textTransform: "uppercase",
        color: "#f5f0e0",
        marginBottom: 10,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        maxWidth: "100%",
      }}>
        {event.title}
      </div>

      {/* Flip clock row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
        <FlipPanel value={hh} label="HRS" />

        <span style={{
          fontFamily: "'Oswald',Arial,sans-serif",
          fontSize: 32, fontWeight: 700,
          color: "rgba(232,168,32,0.35)",
          lineHeight: "54px",
          userSelect: "none",
        }}>:</span>

        <FlipPanel value={mm} label="MIN" />

        {/* scheduled time anchor */}
        <div style={{
          marginLeft: 6, alignSelf: "flex-end", paddingBottom: 2,
          fontFamily: "'Oswald',Arial,sans-serif", fontSize: 9,
          fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase",
          color: "rgba(245,240,224,0.2)",
        }}>
          @ {timeStr}
        </div>
      </div>
    </div>
  );
}

// ── Empty slot (no task / no event) ──────────────────────────────
function EmptySlot({ label }: { label: string }) {
  return (
    <div style={{
      padding: "14px 14px 16px",
      display: "flex", alignItems: "center", gap: 8,
    }}>
      <div style={{
        fontFamily: "'Oswald',Arial,sans-serif",
        fontSize: 11, color: "rgba(245,240,224,0.15)",
        letterSpacing: "0.14em", textTransform: "uppercase",
        fontStyle: "italic",
      }}>
        — {label} —
      </div>
    </div>
  );
}

// ── Single task row (Next / On Deck) ─────────────────────────────
function TaskSlot({ task, size = "lg", onClick }: { task: Task; size?: "lg" | "sm"; onClick: () => void }) {
  const overdue = isOverdue(task.due_date);
  const accent = ACCENT[task.priority];

  return (
    <div
      onClick={onClick}
      title="Click to view tasks"
      style={{
        padding: size === "lg" ? "10px 14px 12px" : "8px 14px 10px",
        borderLeft: `4px solid ${accent}`,
        cursor: "pointer",
        transition: "background 0.1s",
        background: "transparent",
      }}
      onMouseEnter={e => (e.currentTarget.style.background = "rgba(232,168,32,0.04)")}
      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
    >
      {/* Title */}
      <div style={{
        fontFamily: "'Oswald',Arial,sans-serif",
        fontSize: size === "lg" ? 16 : 13,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "#f5f0e0",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        lineHeight: 1.2,
        marginBottom: 5,
      }}>
        {task.title}
      </div>

      {/* Meta row */}
      <div style={{
        fontFamily: "'Oswald',Arial,sans-serif",
        fontSize: 9, fontWeight: 600,
        letterSpacing: "0.12em", textTransform: "uppercase",
        color: "rgba(245,240,224,0.3)",
        display: "flex", gap: 6, flexWrap: "wrap",
      }}>
        <span style={{ color: accent }}>{task.priority.toUpperCase()}</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span style={{ color: task.focus_score >= 20 ? "#d94040" : task.focus_score >= 12 ? "#e8a820" : "rgba(245,240,224,0.35)" }}>
          FS:{task.focus_score}
        </span>
        {task.time_estimate_minutes && (
          <><span style={{ opacity: 0.4 }}>·</span><span>{formatMinutes(task.time_estimate_minutes)}</span></>
        )}
        {task.due_date && (
          <><span style={{ opacity: 0.4 }}>·</span>
          <span style={{ color: overdue ? "#d94040" : "rgba(245,240,224,0.3)" }}>
            {overdue ? "⚠ " : ""}{task.due_date}
          </span></>
        )}
      </div>
    </div>
  );
}

// ── Section label header ──────────────────────────────────────────
function SectionHead({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="panel-header" style={{ padding: "6px 14px" }}>
      <span className="panel-header-title" style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 10 }}>
        <span style={{ color: "rgba(232,168,32,0.5)", fontSize: 11 }}>{icon}</span>
        {label}
      </span>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────
interface Props {
  tasks: Task[];
}

export function NextUpPanel({ tasks }: Props) {
  const { setActivePage } = useUIStore();
  const today = new Date().toISOString().split("T")[0];

  // Fetch today's time blocks for next event — fails silently
  const { data: blocks } = useQuery({
    queryKey: ["time-blocks-today", today],
    queryFn: () =>
      api.get<TimeBlock[]>("/time-blocks/", { params: { date: today } }).then(r => r.data),
    retry: false,
    staleTime: 60_000,
  });

  // Sort pending tasks by priority then focus_score
  const pending = tasks.filter(t => t.status !== "done" && t.status !== "cancelled");
  const sorted = [...pending].sort((a, b) => {
    const pw = (PRIORITY_WEIGHT[b.priority] ?? 0) - (PRIORITY_WEIGHT[a.priority] ?? 0);
    return pw !== 0 ? pw : b.focus_score - a.focus_score;
  });
  const nextTask = sorted[0] ?? null;
  const onDeckTask = sorted[1] ?? null;

  // Next upcoming time block (up to 5 min after start time)
  const nowMs = Date.now();
  const nextEvent = blocks
    ? [...blocks]
        .filter(b => new Date(b.start_time).getTime() > nowMs - 5 * 60_000)
        .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())[0] ?? null
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>

      {/* ── NEXT TASK ── */}
      <SectionHead icon="▶" label="Next Task" />
      {nextTask
        ? <TaskSlot task={nextTask} size="lg" onClick={() => setActivePage("todos")} />
        : <EmptySlot label="Clear" />}

      <div style={{ height: 1, background: "#1e3629", flexShrink: 0 }} />

      {/* ── ON DECK ── */}
      <SectionHead icon="⋯" label="On Deck" />
      {onDeckTask
        ? <TaskSlot task={onDeckTask} size="sm" onClick={() => setActivePage("todos")} />
        : <EmptySlot label="Nothing on deck" />}

      <div style={{ height: 1, background: "#1e3629", flexShrink: 0 }} />

      {/* ── NEXT CALENDAR EVENT ── */}
      <SectionHead icon="◔" label="Next Event" />
      {nextEvent
        ? <EventCountdown event={nextEvent} />
        : <EmptySlot label="Schedule Clear" />}

    </div>
  );
}
