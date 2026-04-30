import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Task, TimeBlock } from "@/types";
import { useUIStore } from "@/store";
import { isOverdue } from "@/lib/utils";
import axios from "axios";

const PRIORITY_WEIGHT: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const ACCENT: Record<string, string> = {
  critical: "#d94040", high: "#e8a820",
  medium: "rgba(255,255,255,0.45)", low: "rgba(255,255,255,0.18)",
};

const GC_TOKEN_KEY    = "gcal_access_token";
const GC_EXPIRY_KEY   = "gcal_token_expiry";
const GC_SELECTED_KEY = "gcal_selected_calendar_ids";

function getStoredToken(): string | null {
  try {
    const token  = localStorage.getItem(GC_TOKEN_KEY);
    const expiry = localStorage.getItem(GC_EXPIRY_KEY);
    if (!token || !expiry || Date.now() > parseInt(expiry)) return null;
    return token;
  } catch { return null; }
}

function getSelectedCalIds(): string[] {
  try {
    const saved = localStorage.getItem(GC_SELECTED_KEY);
    return saved ? JSON.parse(saved) : ["primary"];
  } catch { return ["primary"]; }
}

interface NextEvent { title: string; startMs: number; }

// ── Flip panel ────────────────────────────────────────────────────────
function FlipPanel({ value, label }: { value: string; label: string }) {
  const prevRef = useRef(value);
  const [shown, setShown]       = useState(value);
  const [flipping, setFlipping] = useState(false);

  useEffect(() => {
    if (value !== prevRef.current) {
      setFlipping(true);
      const tid = setTimeout(() => {
        setShown(value);
        prevRef.current = value;
        setFlipping(false);
      }, 180);
      return () => clearTimeout(tid);
    } else { setShown(value); }
  }, [value]);

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
      <div
        className={`panel${flipping ? " flip-panel" : ""}`}
        style={{ width:52, height:52, boxShadow:"inset 0 3px 6px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.04)" }}
      >
        <span className="panel-num gold" style={{ fontSize:28, letterSpacing:"-0.02em" }}>{shown}</span>
      </div>
      <span className="panel-sub" style={{ fontSize:8, letterSpacing:"0.14em" }}>{label}</span>
    </div>
  );
}

// ── Countdown clock ──────────────────────────────────────────────────
function EventCountdown({ event }: { event: NextEvent }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const diffMs  = event.startMs - now;
  const timeStr = new Date(event.startMs).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });

  if (diffMs <= 0) {
    return (
      <div className="sb-row" style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:10, minHeight:52 }}>
        <div className="live-dot" />
        <div style={{ textAlign:"center" }}>
          <div style={{ fontFamily:"'Oswald',Arial,sans-serif", fontSize:13, fontWeight:700,
            letterSpacing:"0.08em", textTransform:"uppercase", color:"#d94040" }}>IN PROGRESS</div>
          <div style={{ fontFamily:"'Oswald',Arial,sans-serif", fontSize:10,
            color:"rgba(245,240,224,0.4)", letterSpacing:"0.1em", textTransform:"uppercase", marginTop:2 }}>
            {event.title}
          </div>
        </div>
      </div>
    );
  }

  const totalMins = Math.floor(diffMs / 60_000);
  const hours     = Math.min(Math.floor(totalMins / 60), 99);
  const mins      = totalMins % 60;

  return (
    <div className="sb-row" style={{ display:"flex", alignItems:"center", justifyContent:"center", padding:"10px 14px", gap:8, minHeight:52 }}>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontFamily:"'Oswald',Arial,sans-serif", fontSize:12, fontWeight:700,
          letterSpacing:"0.07em", textTransform:"uppercase", color:"#f5f0e0",
          whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", marginBottom:3 }}>
          {event.title}
        </div>
        <div style={{ fontSize:9, fontWeight:600, letterSpacing:"0.1em", textTransform:"uppercase",
          color:"rgba(245,240,224,0.3)" }}>@ {timeStr}</div>
      </div>
      <div style={{ display:"flex", alignItems:"flex-start", gap:4, flexShrink:0 }}>
        <FlipPanel value={String(hours).padStart(2,"0")} label="HRS" />
        <span style={{ fontFamily:"'Oswald',Arial,sans-serif", fontSize:24, fontWeight:700,
          color:"rgba(232,168,32,0.3)", lineHeight:"44px", userSelect:"none" }}>:</span>
        <FlipPanel value={String(mins).padStart(2,"0")} label="MIN" />
      </div>
    </div>
  );
}

// ── Empty slot ─────────────────────────────────────────────────────────────
function EmptySlot({ text }: { text: string }) {
  return (
    <div className="sb-row" style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:52 }}>
      <span style={{ fontFamily:"'Oswald',Arial,sans-serif",
        fontSize:10, color:"rgba(245,240,224,0.15)", letterSpacing:"0.14em",
        textTransform:"uppercase", fontStyle:"italic" }}>
        &mdash; {text} &mdash;
      </span>
    </div>
  );
}

// ── Task row — scoreboard style matching sb-row ─────────────────────────────────
function TaskSlot({ task, size, onClick }: { task: Task; size: "lg" | "sm"; onClick: () => void }) {
  const overdue = isOverdue(task.due_date);
  const accent  = ACCENT[task.priority];
  const fsColor = task.focus_score >= 20 ? "#d94040" : task.focus_score >= 12 ? "#e8a820" : "rgba(245,240,224,0.3)";

  // Panel tile for priority
  const priLabel = task.priority === "critical" ? "CRIT"
    : task.priority === "high" ? "HIGH"
    : task.priority === "medium" ? "MED" : "LOW";

  return (
    <div
      className="sb-row"
      onClick={onClick}
      title="View tasks"
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto auto",
        alignItems: "center",
        minHeight: size === "lg" ? 64 : 52,
        cursor: "pointer",
        transition: "background 0.1s",
        borderBottom: "2px solid #1e3629",
      }}
      onMouseEnter={e => (e.currentTarget.style.background = "rgba(232,168,32,0.06)")}
      onMouseLeave={e => (e.currentTarget.style.background = "")}
    >
      {/* Left: task name as scoreboard label */}
      <div style={{
        padding: "8px 8px 8px 16px",
        borderRight: "2px solid #1e3629",
      }}>
        <div style={{
          fontFamily: "'Oswald',Arial,sans-serif",
          fontSize: size === "lg" ? 14 : 12,
          fontWeight: 700,
          letterSpacing: "0.07em",
          textTransform: "uppercase",
          color: "#f5f0e0",
          lineHeight: 1.2,
          marginBottom: 3,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
        }}>
          {task.title}
        </div>
        {task.due_date && (
          <div style={{ fontSize: 8, fontWeight: 600, letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: overdue ? "#d94040" : "rgba(245,240,224,0.25)" }}>
            {overdue ? "⚠ " : ""}{task.due_date}
          </div>
        )}
      </div>

      {/* Middle: priority tile */}
      <div className="sb-cell" style={{ padding: "6px 8px" }}>
        <div className="panel panel-sm" style={{ width: 44, height: 40 }}>
          <span style={{ fontFamily:"'Oswald',Arial,sans-serif", fontSize: 11,
            fontWeight: 700, letterSpacing: "0.06em", color: accent,
            textTransform: "uppercase", lineHeight: 1 }}>
            {priLabel}
          </span>
        </div>
        <div className="panel-sub">PRIORITY</div>
      </div>

      {/* Right: focus score tile */}
      <div className="sb-cell" style={{ padding: "6px 8px", borderRight: "none" }}>
        <div className="panel panel-sm" style={{ width: 44, height: 40 }}>
          <span style={{ fontFamily:"'Oswald',Arial,sans-serif", fontSize: 16,
            fontWeight: 700, color: fsColor, lineHeight: 1 }}>
            {task.focus_score}
          </span>
        </div>
        <div className="panel-sub">FS</div>
      </div>
    </div>
  );
}

// ── Section header ─────────────────────────────────────────────────────────
function SHead({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="panel-header" style={{ justifyContent: "center" }}>
      <span className="panel-header-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: "rgba(232,168,32,0.5)", fontSize: 10 }}>{icon}</span>{label}
      </span>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────
export function NextUpPanel({ tasks }: { tasks: Task[] }) {
  const { setActivePage } = useUIStore();
  const apiBase = import.meta.env.VITE_API_BASE_URL || "";
  const today   = new Date().toISOString().split("T")[0];

  const { data: localBlocks = [] } = useQuery<TimeBlock[]>({
    queryKey: ["time-blocks-dashboard", today],
    queryFn: () =>
      axios.get(`${apiBase}/api/time-blocks/`, { params: { date: today } }).then(r => r.data),
    retry: false,
    staleTime: 60_000,
  });

  const gcalToken = getStoredToken();
  const calIds    = getSelectedCalIds();
  const { data: gcalEvents = [] } = useQuery<NextEvent[]>({
    queryKey: ["gcal-today-dashboard", today, gcalToken],
    enabled: !!gcalToken,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const timeMin = new Date(`${today}T00:00:00`).toISOString();
      const timeMax = new Date(`${today}T23:59:59`).toISOString();
      const results = await Promise.all(
        calIds.map(calId =>
          fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`,
            { headers: { Authorization: `Bearer ${gcalToken}` } }
          ).then(r => r.json()).then(d => (d.items ?? []) as any[])
        )
      );
      return results.flat().map(ev => ({
        title:   ev.summary || "(No title)",
        startMs: new Date(ev.start?.dateTime || ev.start?.date + "T00:00:00").getTime(),
      }));
    },
  });

  const nowMs      = Date.now();
  const localEvts: NextEvent[] = localBlocks.map(b => ({ title: b.title, startMs: new Date(b.start_time).getTime() }));
  const allEvents  = [...localEvts, ...gcalEvents]
    .filter(e => e.startMs > nowMs - 5 * 60_000)
    .sort((a, b) => a.startMs - b.startMs);
  const nextEvent  = allEvents[0] ?? null;

  const pending    = tasks.filter(t => t.status !== "done" && t.status !== "cancelled");
  const sorted     = [...pending].sort((a, b) => {
    const pw = (PRIORITY_WEIGHT[b.priority] ?? 0) - (PRIORITY_WEIGHT[a.priority] ?? 0);
    return pw !== 0 ? pw : b.focus_score - a.focus_score;
  });
  const nextTask   = sorted[0] ?? null;
  const onDeckTask = sorted[1] ?? null;

  return (
    // Explicit background matches sb-shell (#2a4a3a) so colour is identical to left panel
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#2a4a3a" }}>

      <SHead icon="▶" label="Next Task" />
      {nextTask
        ? <TaskSlot task={nextTask} size="lg" onClick={() => setActivePage("todos")} />
        : <EmptySlot text="Clear" />}

      <SHead icon="⋯" label="On Deck" />
      {onDeckTask
        ? <TaskSlot task={onDeckTask} size="sm" onClick={() => setActivePage("todos")} />
        : <EmptySlot text="Nothing on deck" />}

      <SHead icon="◷" label="Next Event" />
      {nextEvent
        ? <EventCountdown event={nextEvent} />
        : <EmptySlot text={gcalToken ? "Schedule clear" : "No calendar connected"} />}

    </div>
  );
}
