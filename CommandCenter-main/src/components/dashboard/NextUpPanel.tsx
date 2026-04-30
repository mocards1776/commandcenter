import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Task, TimeBlock } from "@/types";
import { useUIStore } from "@/store";
import { isOverdue } from "@/lib/utils";
import axios from "axios";

const PRIORITY_WEIGHT: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const ACCENT: Record<string, string> = {
  critical: "#d94040", high: "#e8a820",
  medium: "rgba(255,255,255,0.3)", low: "rgba(255,255,255,0.12)",
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

// ── Flip panel ──────────────────────────────────────────────────────────────
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

// ── Countdown clock ─────────────────────────────────────────────────────────
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
      <div style={{ padding:"12px 14px 14px", display:"flex", alignItems:"center", justifyContent:"center", gap:10 }}>
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
    <div style={{ padding:"10px 14px 14px", textAlign:"center" }}>
      <div style={{
        fontFamily:"'Oswald',Arial,sans-serif", fontSize:12, fontWeight:700,
        letterSpacing:"0.07em", textTransform:"uppercase", color:"#f5f0e0",
        marginBottom:10, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
      }}>
        {event.title}
      </div>
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"center", gap:5 }}>
        <FlipPanel value={String(hours).padStart(2,"0")} label="HRS" />
        <span style={{ fontFamily:"'Oswald',Arial,sans-serif", fontSize:30, fontWeight:700,
          color:"rgba(232,168,32,0.3)", lineHeight:"52px", userSelect:"none" }}>:</span>
        <FlipPanel value={String(mins).padStart(2,"0")} label="MIN" />
        <div style={{ marginLeft:6, alignSelf:"flex-end", paddingBottom:4,
          fontFamily:"'Oswald',Arial,sans-serif", fontSize:8, fontWeight:600,
          letterSpacing:"0.12em", textTransform:"uppercase", color:"rgba(245,240,224,0.18)" }}>
          @ {timeStr}
        </div>
      </div>
    </div>
  );
}

// ── Empty slot ───────────────────────────────────────────────────────────────
function EmptySlot({ text }: { text: string }) {
  return (
    <div style={{ padding:"12px 14px", textAlign:"center",
      fontFamily:"'Oswald',Arial,sans-serif", fontSize:10,
      color:"rgba(245,240,224,0.15)", letterSpacing:"0.14em",
      textTransform:"uppercase", fontStyle:"italic" }}>
      &mdash; {text} &mdash;
    </div>
  );
}

// ── Task row (centered) ───────────────────────────────────────────────────────
function TaskSlot({ task, size, onClick }: { task: Task; size: "lg" | "sm"; onClick: () => void }) {
  const overdue = isOverdue(task.due_date);
  const accent  = ACCENT[task.priority];
  return (
    <div
      onClick={onClick}
      title="View tasks"
      style={{
        padding: size === "lg" ? "10px 14px 12px" : "7px 14px 9px",
        textAlign: "center",
        cursor: "pointer",
        transition: "background 0.1s",
        borderTop: `3px solid ${accent}`,
      }}
      onMouseEnter={e => (e.currentTarget.style.background = "rgba(232,168,32,0.04)")}
      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
    >
      <div style={{
        fontFamily: "'Oswald',Arial,sans-serif",
        fontSize: size === "lg" ? 14 : 12,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "#f5f0e0",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        lineHeight: 1.2,
        marginBottom: 4,
      }}>
        {task.title}
      </div>
      <div style={{
        fontFamily: "'Oswald',Arial,sans-serif",
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "rgba(245,240,224,0.3)",
        display: "flex",
        gap: 5,
        flexWrap: "wrap",
        justifyContent: "center",
      }}>
        <span style={{ color: accent }}>{task.priority.toUpperCase()}</span>
        <span style={{ opacity: 0.35 }}>&middot;</span>
        <span style={{ color: task.focus_score >= 20 ? "#d94040" : task.focus_score >= 12 ? "#e8a820" : "rgba(245,240,224,0.3)" }}>
          FS:{task.focus_score}
        </span>
        {task.time_estimate_minutes && (
          <><span style={{ opacity: 0.35 }}>&middot;</span>
          <span>{task.time_estimate_minutes >= 60
            ? `${Math.floor(task.time_estimate_minutes / 60)}h${task.time_estimate_minutes % 60 > 0 ? ` ${task.time_estimate_minutes % 60}m` : ""}`
            : `${task.time_estimate_minutes}m`}
          </span></>
        )}
        {task.due_date && (
          <><span style={{ opacity: 0.35 }}>&middot;</span>
          <span style={{ color: overdue ? "#d94040" : "rgba(245,240,224,0.3)" }}>
            {overdue ? "⚠ " : ""}{task.due_date}
          </span></>
        )}
      </div>
    </div>
  );
}

// ── Section header ───────────────────────────────────────────────────────────
// Uses default panel-header padding (8px 14px) so its border-bottom gold line
// sits at the same y-position as sb-header's border-bottom on the left panel.
function SHead({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="panel-header" style={{ justifyContent: "center" }}>
      <span className="panel-header-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: "rgba(232,168,32,0.5)", fontSize: 10 }}>{icon}</span>{label}
      </span>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
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
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>

      {/* NEXT TASK — panel-header uses default 8px padding to match sb-header height */}
      <SHead icon="▶" label="Next Task" />
      {nextTask
        ? <TaskSlot task={nextTask} size="lg" onClick={() => setActivePage("todos")} />
        : <EmptySlot text="Clear" />}

      <div style={{ height: 1, background: "#1e3629" }} />

      {/* ON DECK */}
      <SHead icon="⋯" label="On Deck" />
      {onDeckTask
        ? <TaskSlot task={onDeckTask} size="sm" onClick={() => setActivePage("todos")} />
        : <EmptySlot text="Nothing on deck" />}

      <div style={{ height: 1, background: "#1e3629" }} />

      {/* NEXT EVENT */}
      <SHead icon="◷" label="Next Event" />
      {nextEvent
        ? <EventCountdown event={nextEvent} />
        : <EmptySlot text={gcalToken ? "Schedule clear" : "No calendar connected"} />}

    </div>
  );
}
