import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Task, TimeBlock } from "@/types";
import { useNavigate } from "react-router-dom";
import { useTimerStore, usePinnedTaskStore } from "@/store";
import { useActiveTimer } from "@/hooks/useTimer";
import { formatDuration, todayStr } from "@/lib/utils";
import api, { tasksApi, timeBlocksApi } from "@/lib/api";

const PRIORITY_WEIGHT: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const ACCENT: Record<string, string> = {
  critical: "#d94040", high: "#e8a820",
  medium: "rgba(255,255,255,0.45)", low: "rgba(255,255,255,0.18)",
};

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

function EventCountdown({ event, compact = false }: { event: NextEvent; compact?: boolean }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);

  const diffMs    = event.startMs - now;
  const eventDate = new Date(event.startMs);
  const timeStr   = eventDate.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
  const dateStr   = eventDate.toLocaleDateString([], { month:"short", day:"numeric" }).toUpperCase();

  if (diffMs <= 0) {
    return (
      <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr", alignItems:"center", minHeight: compact ? 52 : 72,
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
    <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr", alignItems:"center", minHeight: compact ? 52 : 72,
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
  const safeTasks = Array.isArray(tasks) ? tasks : [];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const menuW = 240;
  const menuH = Math.min(safeTasks.length * 36 + 8, 320);
  const left  = Math.min(x, window.innerWidth - menuW - 8);
  const top   = Math.min(y, window.innerHeight - menuH - 8);

  return (
    <div ref={ref} style={{ position:"fixed", left, top, width:menuW, maxHeight:320,
      overflowY:"auto", background:"#1a2e22", border:"1px solid #2e4a36", borderRadius:4,
      boxShadow:"0 8px 32px rgba(0,0,0,0.6)", zIndex:9999, padding:4 }}>
      {safeTasks.length === 0
        ? <div style={{ padding:"10px 12px", color:"rgba(245,240,224,0.3)",
            fontSize:11, fontFamily:"'Oswald',Arial,sans-serif", letterSpacing:"0.1em" }}>NO TASKS AVAILABLE</div>
        : safeTasks.map(t => (
          <button key={t.id}
            onClick={() => onSelect(t)}
            style={{ display:"block", width:"100%", textAlign:"left", padding:"8px 12px",
              background: t.id === currentId ? "rgba(232,168,32,0.12)" : "transparent",
              border:"none", borderRadius:3, cursor:"pointer",
              fontFamily:"'Oswald',Arial,sans-serif", fontSize:12, fontWeight:600,
              letterSpacing:"0.06em", textTransform:"uppercase",
              color: t.id === currentId ? "#e8a820" : "rgba(245,240,224,0.85)" }}
          >{t.title}</button>
        ))}
    </div>
  );
}

function SHead({ icon, label }: { icon: string; label: string }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:7, padding:"5px 10px",
      background:"#12221a", borderBottom:"2px solid #1e3629" }}>
      <span style={{ fontSize:11 }}>{icon}</span>
      <span style={{ fontFamily:"'Oswald',Arial,sans-serif", fontSize:9, fontWeight:700,
        letterSpacing:"0.22em", textTransform:"uppercase",
        color:"rgba(245,240,224,0.35)" }}>{label}</span>
    </div>
  );
}

function TaskRow({ task, slotLabel, onSlotClick, isActiveTimer, elapsedSeconds }
  : { task: Task | null; slotLabel: string; onSlotClick: (e: React.MouseEvent) => void;
      isActiveTimer: boolean; elapsedSeconds: number }) {
  const navigate = useNavigate();

  if (!task) {
    return (
      <div onClick={onSlotClick}
        style={{ display:"grid", gridTemplateColumns:"1fr auto", alignItems:"center",
          minHeight:72, padding:"8px 8px 8px 14px", cursor:"pointer",
          background:"#2a4a3a", borderBottom:"2px solid #1e3629" }}>
        <span style={{ fontFamily:"'Oswald',Arial,sans-serif", fontSize:10,
          color:"rgba(245,240,224,0.15)", letterSpacing:"0.14em",
          textTransform:"uppercase", fontStyle:"italic" }}>&mdash; Assign {slotLabel} &mdash;</span>
        <span style={{ fontSize:16, opacity:0.2 }}>+</span>
      </div>
    );
  }

  const pColor = ACCENT[task.priority] ?? ACCENT.medium;

  return (
    <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr", alignItems:"center",
      minHeight:72, background:"#2a4a3a", borderBottom:"2px solid #1e3629" }}>

      {/* Title cell */}
      <div onClick={() => navigate(`/tasks/${task.id}`)}
        style={{ padding:"8px 8px 8px 14px", borderRight:"2px solid #1e3629",
          display:"flex", alignItems:"center", gap:10, cursor:"pointer",
          minHeight:72 }}>
        <div style={{ width:3, alignSelf:"stretch", background:pColor,
          borderRadius:2, flexShrink:0 }} />
        <span style={{ fontFamily:"'Oswald',Arial,sans-serif", fontSize:13, fontWeight:700,
          letterSpacing:"0.05em", textTransform:"uppercase", color:"#f5f0e0",
          lineHeight:1.2, display:"-webkit-box", WebkitLineClamp:3,
          WebkitBoxOrient:"vertical", overflow:"hidden" }}>{task.title}</span>
      </div>

      {/* Stats cell */}
      <div className="sb-cell" style={{ borderRight:"2px solid #1e3629", padding:"6px" }}>
        <div className="sb-val" style={{ color:"#e8a820" }}>{task.importance ?? "-"}</div>
        <div className="sb-label">IMP</div>
        <div className="sb-divider" />
        <div className="sb-val" style={{ color:"#4faa6e" }}>{task.difficulty ?? "-"}</div>
        <div className="sb-label">DIFF</div>
      </div>

      {/* Timer / score cell */}
      <div className="sb-cell" style={{ padding:"6px" }} onClick={onSlotClick}>
        {isActiveTimer ? (
          <>
            <div className="live-dot" />
            <div className="sb-val" style={{ color:"#4faa6e", fontSize:11,
              fontVariantNumeric:"tabular-nums" }}>{formatDuration(elapsedSeconds)}</div>
            <div className="sb-label">LIVE</div>
          </>
        ) : (
          <>
            <div className="sb-val" style={{ color:"#e8a820" }}>{task.focus_score ?? 0}</div>
            <div className="sb-label">SCORE</div>
          </>
        )}
      </div>
    </div>
  );
}

export function NextUpPanel() {
  const { activeTimer } = useTimerStore();
  const activeTaskId = activeTimer?.task_id ?? null;
  const { start: timerStart, stop: timerStop, elapsedSeconds } = useActiveTimer();
  const { pinnedTaskId: pinnedId, setPinnedTask: pin } = usePinnedTaskStore();
  const [picker, setPicker] = useState<{ slot: "next"|"deck"; x: number; y: number } | null>(null);
  const [nextId, setNextId]  = useState<string | undefined>(undefined);
  const [deckId, setDeckId]  = useState<string | undefined>(undefined);

  // tasks (must use api client: Vercel has no /api proxy; auth header required)
  const { data: tasksRaw } = useQuery<Task[]>({
    queryKey: ["tasks"],
    queryFn: () => tasksApi.list(),
    refetchInterval: 30_000,
  });
  const tasks = Array.isArray(tasksRaw) ? tasksRaw : [];

  // timeblocks
  const { data: blocks } = useQuery<TimeBlock[]>({
    queryKey: ["timeblocks", "today"],
    queryFn: () => timeBlocksApi.list(todayStr()),
    refetchInterval: 60_000,
  });

  // gcal
  const { data: gcalData } = useQuery({
    queryKey: ["gcal"],
    queryFn: () => api.get("/api/gcal/next-event").then(r => r.data),
    refetchInterval: 300_000,
  });
  const gcalConfigured = gcalData?.configured ?? false;
  const gcalEvents: NextEvent[] = gcalData?.events ?? [];

  // pick active task candidates
  const activeTasks = tasks
    .filter(t => (t.status === "today" || t.status === "in_progress") && !t.completed_at)
    .sort((a, b) => taskScore(b) - taskScore(a));

  // slot resolution
  const nextTask = activeTasks.find(t => t.id === nextId) ??
    (pinnedId ? activeTasks.find(t => t.id === pinnedId) : null) ??
    activeTasks[0] ?? null;

  const deckTask = activeTasks.find(t => t.id === deckId) ??
    activeTasks.find(t => t.id !== nextTask?.id) ?? null;

  // calendar events — merge gcal + timeblock events, sort by startMs
  const blockEvents: NextEvent[] = (blocks ?? []).map(b => ({
    title: b.title,
    startMs: new Date(b.start_time).getTime(),
  }));
  const now = Date.now();
  const allEvents = [...gcalEvents, ...blockEvents]
    .filter(e => e.startMs > now - 15 * 60 * 1000)
    .sort((a, b) => a.startMs - b.startMs);

  const nextEvent   = allEvents[0] ?? null;
  const secondEvent = allEvents[1] ?? null;

  const handleSlotClick = (slot: "next"|"deck", e: React.MouseEvent) => {
    setPicker({ slot, x: e.clientX, y: e.clientY });
  };
  const handlePick = (slot: "next"|"deck", task: Task) => {
    if (slot === "next") { setNextId(task.id); pin(task.id); }
    else                 { setDeckId(task.id); }
    setPicker(null);
  };

  const isNextTimer = activeTaskId === nextTask?.id;
  const isDeckTimer = activeTaskId === deckTask?.id;

  return (
    <>
      {picker && (
        <SlotPicker
          x={picker.x} y={picker.y}
          tasks={activeTasks}
          currentId={picker.slot === "next" ? nextId : deckId}
          onSelect={t => handlePick(picker.slot, t)}
          onClose={() => setPicker(null)}
        />
      )}

      <div style={{ display:"flex", flexDirection:"column",
        background:"#1a2e22", borderRadius:6, overflow:"hidden",
        border:"2px solid #1e3629", boxShadow:"0 4px 20px rgba(0,0,0,0.5)" }}>

        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
          padding:"6px 12px", background:"#12221a",
          borderBottom:"2px solid #1e3629" }}>
          <span style={{ fontFamily:"'Oswald',Arial,sans-serif", fontSize:11, fontWeight:700,
            letterSpacing:"0.22em", textTransform:"uppercase", color:"#e8a820" }}>◈ NEXT UP</span>
          {nextTask && (
            <button
              onClick={() => {
                if (activeTaskId === nextTask.id) timerStop();
                else timerStart({ task_id: nextTask.id });
              }}
              style={{ fontFamily:"'Oswald',Arial,sans-serif", fontSize:9, fontWeight:700,
                letterSpacing:"0.14em", padding:"3px 8px",
                background: activeTaskId === nextTask.id ? "#d94040" : "#4faa6e",
                border:"none", borderRadius:2, cursor:"pointer",
                color:"#fff", textTransform:"uppercase" }}
            >{activeTaskId === nextTask.id ? "⏹ STOP" : "▶ START"}</button>
          )}
        </div>

        <SHead icon="★" label="Next Task" />
        <TaskRow task={nextTask} slotLabel="next task"
          onSlotClick={e => handleSlotClick("next", e)}
          isActiveTimer={isNextTimer} elapsedSeconds={isNextTimer ? elapsedSeconds : 0} />

        <SHead icon="◈" label="On Deck" />
        <TaskRow task={deckTask} slotLabel="on deck task"
          onSlotClick={e => handleSlotClick("deck", e)}
          isActiveTimer={isDeckTimer} elapsedSeconds={isDeckTimer ? elapsedSeconds : 0} />

        <SHead icon="◷" label="Next Events" />
        {nextEvent
          ? <EventCountdown event={nextEvent} compact />
          : <EmptySlot text={gcalConfigured ? "Schedule clear" : "No calendar connected"} />}
        {nextEvent && (
          secondEvent
            ? <EventCountdown event={secondEvent} compact />
            : <EmptySlot text="No more events" />
        )}

      </div>
    </>
  );
}

export default NextUpPanel;
