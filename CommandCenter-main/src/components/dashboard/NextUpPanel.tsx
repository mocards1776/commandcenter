import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Task, TimeBlock } from "@/types";
import { useUIStore } from "@/store";
import { useActiveTimer } from "@/hooks/useTimer";
import { useTimerStore } from "@/store";
import { isOverdue, formatDuration } from "@/lib/utils";
import axios from "axios";

const PRIORITY_WEIGHT: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const ACCENT: Record<string, string> = {
  critical: "#d94040", high: "#e8a820",
  medium: "rgba(255,255,255,0.45)", low: "rgba(255,255,255,0.18)",
};

// ─── Calendar token helpers — cookie-based (localStorage blocked in iframes) ─
const GC_TOKEN_COOKIE    = "cc_gcal_token";
const GC_EXPIRY_COOKIE   = "cc_gcal_expiry";
const GC_SELECTED_COOKIE = "cc_gcal_cal_ids";

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)(?:;|$)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function getStoredToken(): string | null {
  // Try cookie first
  const cookieToken  = getCookie(GC_TOKEN_COOKIE);
  const cookieExpiry = getCookie(GC_EXPIRY_COOKIE);
  if (cookieToken) {
    if (!cookieExpiry || Date.now() < parseInt(cookieExpiry)) return cookieToken;
  }
  // Fallback: localStorage (works in direct browser tab, not in Vercel iframe)
  try {
    const token  = localStorage.getItem("gcal_access_token");
    const expiry = localStorage.getItem("gcal_token_expiry");
    if (!token || !expiry || Date.now() > parseInt(expiry)) return null;
    return token;
  } catch { return null; }
}

function getSelectedCalIds(): string[] {
  try {
    const fromCookie = getCookie(GC_SELECTED_COOKIE);
    if (fromCookie) return JSON.parse(fromCookie);
    const saved = localStorage.getItem("gcal_selected_calendar_ids");
    return saved ? JSON.parse(saved) : ["primary"];
  } catch { return ["primary"]; }
}

interface NextEvent { title: string; startMs: number; }

function taskScore(task: Task): number {
  const priorityBonus = (PRIORITY_WEIGHT[task.priority] ?? 0) * 100;
  const fs = task.focus_score ?? 0;
  let dueBonus = 0;
  if (task.due_date) {
    const msUntilDue = new Date(task.due_date).getTime() - Date.now();
    if (msUntilDue < 0) {
      dueBonus = 500 + Math.min(500, Math.floor(-msUntilDue / (1000 * 60 * 60)));
    } else {
      const hoursLeft = msUntilDue / (1000 * 60 * 60);
      dueBonus = Math.max(0, Math.floor(200 - hoursLeft * 2));
    }
  }
  return priorityBonus + fs * 5 + dueBonus;
}

function FlipPanel({ value, label, urgent = false }: { value: string; label: string; urgent?: boolean }) {
  const prevRef = useRef(value);
  const [shown, setShown]       = useState(value);
  const [flipping, setFlipping] = useState(false);

  useEffect(() => {
    if (value !== prevRef.current) {
      setFlipping(true);
      const tid = setTimeout(() => { setShown(value); prevRef.current = value; setFlipping(false); }, 180);
      return () => clearTimeout(tid);
    } else { setShown(value); }
  }, [value]);

  const numColor = urgent ? "#d94040" : "#e8a820";

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
      <div className={`panel${flipping ? " flip-panel" : ""}`}
        style={{ width:52, height:52, boxShadow:"inset 0 3px 6px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.04)" }}>
        <span className="panel-num" style={{ fontSize:28, letterSpacing:"-0.02em", color: numColor }}>{shown}</span>
      </div>
      <span className="panel-sub" style={{ fontSize:8, letterSpacing:"0.14em" }}>{label}</span>
    </div>
  );
}

function EventCountdown({ event }: { event: NextEvent }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);

  const diffMs    = event.startMs - now;
  const eventDate = new Date(event.startMs);
  const timeStr   = eventDate.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
  const dateStr   = eventDate.toLocaleDateString([], { month:"short", day:"numeric" }).toUpperCase();

  if (diffMs <= 0) {
    return (
      <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr", alignItems:"center", minHeight:72,
        background:"#2a4a3a", borderBottom:"2px solid #1e3629" }}>
        <div style={{ padding:"8px 8px 8px 14px", borderRight:"2px solid #1e3629",
          display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:4 }}>
          <div style={{ display:"flex", gap:6, width:"100%", alignItems:"stretch" }}>
            <div style={{ background:"#1e3629", borderRadius:4, border:"1px solid rgba(0,0,0,0.4)",
              boxShadow:"inset 0 2px 4px rgba(0,0,0,0.4), 0 1px 0 rgba(255,255,255,0.05)",
              padding:"6px 8px", flexShrink:0, minWidth:42, display:"flex", alignItems:"center", justifyContent:"center" }}>
              <span style={{ fontFamily:"'Oswald',Arial,sans-serif", fontSize:9, fontWeight:700,
                letterSpacing:"0.14em", textTransform:"uppercase", color:"rgba(232,168,32,0.7)", lineHeight:1.3, textAlign:"center" }}>
                {dateStr.split(" ")[0]}<br />{dateStr.split(" ")[1]}
              </span>
            </div>
            <div style={{ background:"#1e3629", borderRadius:4, border:"1px solid rgba(0,0,0,0.4)",
              boxShadow:"inset 0 2px 4px rgba(0,0,0,0.4), 0 1px 0 rgba(255,255,255,0.05)",
              padding:"6px 10px", flex:1, textAlign:"center", minHeight:46,
              display:"flex", alignItems:"center", justifyContent:"center" }}>
              <span style={{ fontFamily:"'Oswald',Arial,sans-serif", fontSize:13, fontWeight:700,
                letterSpacing:"0.05em", textTransform:"uppercase", color:"#f5f0e0",
                lineHeight:1.2, display:"-webkit-box", WebkitLineClamp:2,
                WebkitBoxOrient:"vertical", overflow:"hidden" }}>{event.title}</span>
            </div>
          </div>
          <div style={{ fontSize:8, fontWeight:600, letterSpacing:"0.1em",
            textTransform:"uppercase", color:"rgba(245,240,224,0.25)" }}>@ {timeStr}</div>
        </div>
        <div className="sb-cell" style={{ padding:"6px", gridColumn:"2 / span 2" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
            <div className="live-dot" />
            <span style={{ fontFamily:"'Oswald',Arial,sans-serif", fontSize:11, fontWeight:700,
              letterSpacing:"0.08em", textTransform:"uppercase", color:"#d94040" }}>IN PROGRESS</span>
          </div>
        </div>
      </div>
    );
  }

  const totalMins = Math.floor(diffMs / 60_000);
  const hours     = Math.min(Math.floor(totalMins / 60), 99);
  const mins      = totalMins % 60;
  const urgent    = totalMins < 30;
  const grayLabel = "rgba(245,240,224,0.35)";

  return (
    <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr", alignItems:"center", minHeight:72,
      background:"#2a4a3a", borderBottom:"2px solid #1e3629" }}>
      <div style={{ padding:"8px 8px 8px 14px", borderRight:"2px solid #1e3629",
        display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:4 }}>
        <div style={{ display:"flex", gap:6, width:"100%", alignItems:"stretch" }}>
          <div style={{ background:"#1e3629", borderRadius:4, border:"1px solid rgba(0,0,0,0.4)",
            boxShadow:"inset 0 2px 4px rgba(0,0,0,0.4), 0 1px 0 rgba(255,255,255,0.05)",
            padding:"6px 8px", flexShrink:0, minWidth:42, display:"flex", alignItems:"center", justifyContent:"center" }}>
            <span style={{ fontFamily:"'Oswald',Arial,sans-serif", fontSize:9, fontWeight:700,
              letterSpacing:"0.14em", textTransform:"uppercase", color:"rgba(232,168,32,0.7)",
              lineHeight:1.3, textAlign:"center" }}>
              {dateStr.split(" ")[0]}<br />{dateStr.split(" ")[1]}
            </span>
          </div>
          <div style={{ background:"#1e3629", borderRadius:4, border:"1px solid rgba(0,0,0,0.4)",
            boxShadow:"inset 0 2px 4px rgba(0,0,0,0.4), 0 1px 0 rgba(255,255,255,0.05)",
            padding:"6px 10px", flex:1, textAlign:"center", minHeight:46,
            display:"flex", alignItems:"center", justifyContent:"center" }}>
            <span style={{ fontFamily:"'Oswald',Arial,sans-serif", fontSize:13, fontWeight:700,
              letterSpacing:"0.05em", textTransform:"uppercase", color:"#f5f0e0",
              lineHeight:1.2, display:"-webkit-box", WebkitLineClamp:2,
              WebkitBoxOrient:"vertical", overflow:"hidden" }}>{event.title}</span>
          </div>
        </div>
        <div style={{ fontSize:8, fontWeight:600, letterSpacing:"0.1em",
          textTransform:"uppercase", color:"rgba(245,240,224,0.25)" }}>@ {timeStr}</div>
      </div>
      <div style={{ gridColumn:"2 / span 2", display:"flex", flexDirection:"column",
        alignItems:"center", justifyContent:"center", padding:"6px 4px", gap:4 }}>
        <span style={{ fontFamily:"'Oswald',Arial,sans-serif", fontSize:8, fontWeight:700,
          letterSpacing:"0.22em", textTransform:"uppercase", color: grayLabel }}>COUNTDOWN</span>
        <div style={{ display:"flex", alignItems:"flex-start", gap:4 }}>
          <FlipPanel value={String(hours).padStart(2,"0")} label="HRS" urgent={urgent} />
          <span style={{ fontFamily:"'Oswald',Arial,sans-serif", fontSize:24, fontWeight:700,
            color: grayLabel, lineHeight:"44px", userSelect:"none" }}>:</span>
          <FlipPanel value={String(mins).padStart(2,"0")} label="MIN" urgent={urgent} />
        </div>
      </div>
    </div>
  );
}

function EmptySlot({ text }: { text: string }) {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:52,
      background:"#2a4a3a", borderBottom:"2px solid #1e3629" }}>
      <span style={{ fontFamily:"'Oswald',Arial,sans-serif", fontSize:10,
        color:"rgba(245,240,224,0.15)", letterSpacing:"0.14em",
        textTransform:"uppercase", fontStyle:"italic" }}>&mdash; {text} &mdash;</span>
    </div>
  );
}

interface SlotPickerProps {
  x: number; y: number;
  tasks: Task[];
  currentId: string | undefined;
  onSelect: (task: Task) => void;
  onClose: () => void;
}

function SlotPicker({ x, y, tasks, currentId, onSelect, onClose }: SlotPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const menuW = 240;
  const menuH = Math.min(tasks.length * 36 + 8, 320);
  const left  = Math.min(x, window.innerWidth - menuW - 8);
  const top   = Math.min(y, window.innerHeight - menuH - 8);

  return (
    <div ref={ref} style={{ position:"fixed", left, top, width:menuW, maxHeight:320,
      overflowY:"auto", background:"#1a2e22", border:"1px solid #2e4a36", borderRadius:4,
      boxShadow:"0 8px 24px rgba(0,0,0,0.6)", zIndex:9999, padding:"4px 0" }}>
      <div style={{ padding:"4px 10px 6px", borderBottom:"1px solid rgba(0,0,0,0.3)" }}>
        <span style={{ fontFamily:"'Oswald',Arial,sans-serif", fontSize:8, fontWeight:700,
          letterSpacing:"0.18em", textTransform:"uppercase", color:"rgba(232,168,32,0.5)" }}>SELECT TASK</span>
      </div>
      {tasks.map(t => {
        const accent = ACCENT[t.priority];
        const isCurrent = t.id === currentId;
        const overdue = isOverdue(t.due_date);
        return (
          <div key={t.id} onClick={() => { onSelect(t); onClose(); }}
            style={{ display:"flex", alignItems:"center", gap:7, padding:"7px 10px",
              cursor:"pointer", background:isCurrent ? "rgba(232,168,32,0.08)" : "transparent",
              borderBottom:"1px solid rgba(0,0,0,0.15)", transition:"background 0.1s" }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
            onMouseLeave={e => (e.currentTarget.style.background = isCurrent ? "rgba(232,168,32,0.08)" : "transparent")}>
            <div style={{ width:6, height:6, borderRadius:9999, flexShrink:0, background: accent }} />
            <span style={{ flex:1, fontFamily:"'Oswald',Arial,sans-serif", fontSize:11, fontWeight:600,
              letterSpacing:"0.04em", textTransform:"uppercase",
              color:isCurrent ? "#e8a820" : "#f5f0e0",
              whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{t.title}</span>
            <span style={{ fontFamily:"'Oswald',Arial,sans-serif", fontSize:9,
              color:t.focus_score >= 20 ? "#d94040" : t.focus_score >= 12 ? "#e8a820" : "rgba(245,240,224,0.3)",
              letterSpacing:"0.06em", flexShrink:0 }}>{t.focus_score}</span>
            {t.due_date && (
              <span style={{ fontFamily:"'Oswald',Arial,sans-serif", fontSize:8,
                color:overdue ? "#d94040" : "rgba(245,240,224,0.25)",
                letterSpacing:"0.06em", flexShrink:0 }}>{t.due_date}</span>
            )}
            {isCurrent && <span style={{ color:"rgba(232,168,32,0.6)", fontSize:9, flexShrink:0 }}>●</span>}
          </div>
        );
      })}
    </div>
  );
}

interface TaskSlotProps {
  task: Task; size: "lg" | "sm";
  allTasks: Task[];
  onTaskClick: () => void;
  onOverride: (task: Task) => void;
}

function TaskSlot({ task, size, allTasks, onTaskClick, onOverride }: TaskSlotProps) {
  const overdue  = isOverdue(task.due_date);
  const accent   = ACCENT[task.priority];
  const fsColor  = task.focus_score >= 20 ? "#d94040" : task.focus_score >= 12 ? "#e8a820" : "rgba(245,240,224,0.3)";
  const priLabel = task.priority === "critical" ? "CRIT"
    : task.priority === "high" ? "HIGH"
    : task.priority === "medium" ? "MED" : "LOW";

  const { isRunning, activeTimer, elapsedSeconds, start, stop } = useActiveTimer();
  const { setActiveTimer } = useTimerStore();
  const isThisRunning = isRunning && activeTimer?.task_id === task.id;

  const handleTimerClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isThisRunning) stop();
    else { setActiveTimer(null, task); start({ task_id: task.id }); }
  };

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <>
      <div onContextMenu={handleContextMenu} onClick={onTaskClick}
        title="Click to view tasks · Right-click to change"
        style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr", alignItems:"center",
          minHeight:size === "lg" ? 72 : 60, background:"#2a4a3a", borderBottom:"2px solid #1e3629",
          cursor:"pointer", transition:"background 0.1s", position:"relative" }}
        onMouseEnter={e => (e.currentTarget.style.background = "rgba(232,168,32,0.06)")}
        onMouseLeave={e => (e.currentTarget.style.background = "#2a4a3a")}>
        <div style={{ padding:"8px 8px 8px 14px", borderRight:"2px solid #1e3629",
          display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:4 }}>
          <div style={{ display:"flex", gap:5, width:"100%", alignItems:"stretch" }}>
            <div style={{ background:"#1e3629", borderRadius:4, border:"1px solid rgba(0,0,0,0.4)",
              boxShadow:"inset 0 2px 4px rgba(0,0,0,0.4), 0 1px 0 rgba(255,255,255,0.05)",
              padding:"6px 10px", flex:1, textAlign:"center",
              minHeight:size === "lg" ? 46 : 38, display:"flex", alignItems:"center", justifyContent:"center" }}>
              <span style={{ fontFamily:"'Oswald',Arial,sans-serif",
                fontSize:size === "lg" ? 13 : 11, fontWeight:700, letterSpacing:"0.05em",
                textTransform:"uppercase", color:"#f5f0e0", lineHeight:1.2,
                display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical", overflow:"hidden" }}>
                {task.title}
              </span>
            </div>
            <button type="button" title={isThisRunning ? "Stop timer" : "Start timer"}
              onClick={handleTimerClick}
              style={{ background:"none", border:"none", cursor:"pointer", padding:"4px 5px",
                display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
                gap:3, flexShrink:0, color:isThisRunning ? "#d94040" : "rgba(245,240,224,0.22)",
                transition:"color 0.15s", borderRadius:3 }}
              onMouseEnter={e => (e.currentTarget.style.color = isThisRunning ? "#ff6060" : "rgba(245,240,224,0.55)")}
              onMouseLeave={e => (e.currentTarget.style.color = isThisRunning ? "#d94040" : "rgba(245,240,224,0.22)")}>
              {isThisRunning ? (
                <>
                  <svg width="9" height="9" viewBox="0 0 9 9" fill="currentColor"><rect x="0" y="0" width="9" height="9" rx="1"/></svg>
                  <span style={{ fontFamily:"'Oswald',Arial,sans-serif", fontSize:7, letterSpacing:"0.1em", lineHeight:1 }}>{formatDuration(elapsedSeconds)}</span>
                </>
              ) : (
                <svg width="8" height="9" viewBox="0 0 8 9" fill="currentColor"><path d="M0 0 L8 4.5 L0 9 Z"/></svg>
              )}
            </button>
          </div>
          {task.due_date && (
            <div style={{ fontSize:8, fontWeight:600, letterSpacing:"0.1em", textTransform:"uppercase",
              color:overdue ? "#d94040" : "rgba(245,240,224,0.25)" }}>
              {overdue ? "⚠ " : ""}{task.due_date}
            </div>
          )}
        </div>
        <div className="sb-cell" style={{ padding:"6px 6px" }}>
          <div className="panel panel-sm" style={{ width:48, height:42, margin:"4px auto" }}>
            <span style={{ fontFamily:"'Oswald',Arial,sans-serif", fontSize:11, fontWeight:700,
              letterSpacing:"0.06em", color:accent, textTransform:"uppercase", lineHeight:1 }}>{priLabel}</span>
          </div>
          <div className="panel-sub">PRIORITY</div>
        </div>
        <div className="sb-cell" style={{ padding:"6px 6px", borderRight:"none" }}>
          <div className="panel panel-sm" style={{ width:48, height:42, margin:"4px auto" }}>
            <span style={{ fontFamily:"'Oswald',Arial,sans-serif", fontSize:18, fontWeight:700,
              color:fsColor, lineHeight:1 }}>{task.focus_score}</span>
          </div>
          <div className="panel-sub">FS</div>
        </div>
        <div style={{ position:"absolute", bottom:3, right:5, fontFamily:"'Oswald',Arial,sans-serif",
          fontSize:7, letterSpacing:"0.08em", textTransform:"uppercase",
          color:"rgba(245,240,224,0.1)", pointerEvents:"none", userSelect:"none" }}>
          ⌥ right-click to swap
        </div>
      </div>
      {menu && <SlotPicker x={menu.x} y={menu.y} tasks={allTasks} currentId={task.id}
        onSelect={onOverride} onClose={() => setMenu(null)} />}
    </>
  );
}

function SHead({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="sb-header" style={{ gridTemplateColumns:"1fr" }}>
      <div className="sb-col-head" style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
        <span style={{ color:"rgba(232,168,32,0.5)" }}>{icon}</span>
        {label}
      </div>
    </div>
  );
}

export function NextUpPanel({ tasks }: { tasks: Task[] }) {
  const { setActivePage } = useUIStore();
  const apiBase = import.meta.env.VITE_API_BASE_URL || "";
  const today   = new Date().toISOString().split("T")[0];

  const [topOverride, setTopOverride]   = useState<Task | null>(null);
  const [deckOverride, setDeckOverride] = useState<Task | null>(null);

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
  const sorted     = [...pending].sort((a, b) => taskScore(b) - taskScore(a));

  const validTop  = topOverride  && pending.find(t => t.id === topOverride.id)  ? topOverride  : sorted[0] ?? null;
  const validDeck = deckOverride && pending.find(t => t.id === deckOverride.id) ? deckOverride : null;
  const autoDeck  = sorted.find(t => t.id !== validTop?.id) ?? null;
  const onDeckTask = validDeck && validDeck.id !== validTop?.id ? validDeck : autoDeck;
  const nextTask   = validTop;

  const pickableForTop  = pending.filter(t => t.id !== onDeckTask?.id);
  const pickableForDeck = pending.filter(t => t.id !== nextTask?.id);

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"#2a4a3a" }}>
      <SHead icon="▶" label="Next Task" />
      {nextTask
        ? <TaskSlot task={nextTask} size="lg" allTasks={pickableForTop}
            onTaskClick={() => setActivePage("todos")}
            onOverride={t => { setTopOverride(t); if (deckOverride?.id === t.id) setDeckOverride(null); }} />
        : <EmptySlot text="Clear" />}
      <SHead icon="⋯" label="On Deck" />
      {onDeckTask
        ? <TaskSlot task={onDeckTask} size="sm" allTasks={pickableForDeck}
            onTaskClick={() => setActivePage("todos")}
            onOverride={t => { setDeckOverride(t); if (topOverride?.id === t.id) setTopOverride(null); }} />
        : <EmptySlot text="Nothing on deck" />}
      <SHead icon="◷" label="Next Event" />
      {nextEvent
        ? <EventCountdown event={nextEvent} />
        : <EmptySlot text={gcalToken ? "Schedule clear" : "No calendar connected"} />}
    </div>
  );
}
