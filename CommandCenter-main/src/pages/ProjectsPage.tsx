import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { projectsApi, tasksApi } from "@/lib/api";
import { Loader2, ArrowLeft, Plus, ChevronRight, CheckCircle2, Circle } from "lucide-react";
import type { ProjectSummary, Task, Project } from "@/types";
import { toast } from "react-hot-toast";

// ─── Shared flip-panel primitives ─────────────────────────────────────────────

function SbPanel({
  value, label, color = "white", width = 42, fontSize = 18,
}: {
  value: string | number;
  label?: string;
  color?: "gold" | "red" | "white" | "dim";
  width?: number;
  fontSize?: number;
}) {
  const c = color === "gold" ? "#e8a820" : color === "red" ? "#d94040" : color === "dim" ? "rgba(255,255,255,0.25)" : "#fff";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
      <div
        className="panel"
        style={{
          width,
          height: width,
          boxShadow: "inset 0 3px 6px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.04)",
          flexShrink: 0,
        }}
      >
        <span className="panel-num" style={{ fontSize, color: c, letterSpacing: "-0.02em" }}>
          {value}
        </span>
      </div>
      {label && (
        <span className="panel-sub" style={{ fontSize: 7, letterSpacing: "0.13em" }}>
          {label}
        </span>
      )}
    </div>
  );
}

function Colon() {
  return (
    <span style={{
      fontFamily: "'Oswald', Arial, sans-serif",
      fontSize: 20,
      fontWeight: 700,
      color: "rgba(245,240,224,0.35)",
      lineHeight: "42px",
      userSelect: "none",
      flexShrink: 0,
    }}>:</span>
  );
}

// ─── Live countdown ────────────────────────────────────────────────────────────

function Countdown({ targetDate }: { targetDate: string }) {
  const [timeLeft, setTimeLeft] = useState("");
  useEffect(() => {
    const tick = () => {
      const diff = new Date(targetDate).getTime() - Date.now();
      if (diff <= 0) { setTimeLeft("DUE NOW"); return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      if (d > 0) setTimeLeft(`${d}d ${h}h`);
      else if (h > 0) setTimeLeft(`${h}h ${m}m`);
      else setTimeLeft(`${m}m left`);
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, [targetDate]);
  return <span>{timeLeft}</span>;
}

// ─── Project list row (scoreboard card) ───────────────────────────────────────

const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

function ProjectRow({ p, onClick }: { p: ProjectSummary & { due_date?: string }; onClick: () => void }) {
  const due = p.due_date ? new Date(p.due_date) : null;
  const mon  = due ? MONTHS[due.getMonth()] : "---";
  const day  = due ? String(due.getDate()).padStart(2, "0") : "--";
  const hrs  = due ? String(due.getHours() % 12 || 12).padStart(2, "0") : "--";
  const min  = due ? String(due.getMinutes()).padStart(2, "0") : "--";
  const ampm = due ? (due.getHours() >= 12 ? "PM" : "AM") : "";

  const total = p.task_count || 0;
  const done  = Math.round((total * (p.completion_percentage || 0)) / 100);
  const pct   = p.completion_percentage || 0;

  return (
    <div
      onClick={onClick}
      style={{
        background: "#1e3629",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 4,
        cursor: "pointer",
        padding: "14px 18px",
        display: "flex",
        alignItems: "center",
        gap: 14,
        transition: "background 0.15s",
      }}
      onMouseEnter={e => (e.currentTarget.style.background = "#244232")}
      onMouseLeave={e => (e.currentTarget.style.background = "#1e3629")}
    >
      {/* ── Project nameplate (left) ── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          className="panel-num"
          style={{
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: "0.06em",
            color: "#f5f0e0",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {p.title}
        </div>
        {due && (
          <div style={{ fontSize: 9, color: "#d94040", marginTop: 4, letterSpacing: "0.1em", fontFamily: "'Oswald', Arial, sans-serif" }}>
            <Countdown targetDate={p.due_date!} />
          </div>
        )}
      </div>

      {/* ── Divider ── */}
      <div style={{ width: 1, alignSelf: "stretch", background: "rgba(255,255,255,0.1)", flexShrink: 0 }} />

      {/* ── Tasks panels ── */}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <SbPanel value={total} label="TASKS" color="white" width={42} fontSize={18} />
        <SbPanel value={done}  label="DONE"  color="gold"  width={42} fontSize={18} />
        <SbPanel value={`${pct}%`} label="COMPL" color={pct === 100 ? "gold" : "dim"} width={46} fontSize={14} />
      </div>

      {/* ── Divider ── */}
      <div style={{ width: 1, alignSelf: "stretch", background: "rgba(255,255,255,0.1)", flexShrink: 0 }} />

      {/* ── Due date panels ── */}
      <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
        <SbPanel value={mon} label="MON" color={due ? "white" : "dim"} width={42} fontSize={13} />
        <SbPanel value={day} label="DAY" color={due ? "white" : "dim"} width={42} fontSize={18} />
      </div>

      {/* ── Divider ── */}
      <div style={{ width: 1, alignSelf: "stretch", background: "rgba(255,255,255,0.1)", flexShrink: 0 }} />

      {/* ── Due time panels ── */}
      <div style={{ display: "flex", gap: 4, alignItems: "flex-start" }}>
        <SbPanel value={hrs} label="HRS" color={due ? "gold" : "dim"} width={42} fontSize={18} />
        <Colon />
        <SbPanel value={min} label={ampm || "MIN"} color={due ? "gold" : "dim"} width={42} fontSize={18} />
      </div>

      {/* ── Chevron ── */}
      <ChevronRight size={20} color="#e8a820" style={{ flexShrink: 0 }} />
    </div>
  );
}

// ─── Project detail ────────────────────────────────────────────────────────────

function ProjectDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const qc = useQueryClient();

  const { data: p, isLoading } = useQuery<Project>({
    queryKey: ["project", id],
    queryFn: () => projectsApi.get(id),
  });

  const addTaskMut = useMutation({
    mutationFn: (title: string) => tasksApi.create({
      title,
      project_id: id,
      status: "today",
      priority: "medium",
      importance: 3,
      difficulty: 3,
      tag_ids: [],
      show_in_daily: true,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", id] });
      setNewTaskTitle("");
      setShowAddTask(false);
      toast.success("Task added to campaign");
    },
  });

  if (isLoading || !p) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "300px" }}>
        <Loader2 size={28} style={{ color: "#e8a820", animation: "spin 1s linear infinite" }} />
      </div>
    );
  }

  const allTasks = p.tasks || [];
  const completedCount = allTasks.reduce((acc, t) => {
    return acc + (t.status === "done" ? 1 : 0) + (t.subtasks || []).filter(s => s.status === "done").length;
  }, 0);
  const totalCount = allTasks.reduce((acc, t) => acc + 1 + (t.subtasks || []).length, 0);
  const remainingCount = totalCount - completedCount;
  const pct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const due = p.due_date ? new Date(p.due_date) : null;
  const dueStr  = due ? due.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "-";
  const timeStr = due ? due.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "-";

  return (
    <div className="sb-shell" style={{ minHeight: "100vh" }}>
      <div className="top-bar">
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: "#e8a820", display: "flex", alignItems: "center", gap: 8 }}>
          <ArrowLeft size={16} /> ALL CAMPAIGNS
        </button>
        <div className="top-title">{p.title.toUpperCase()}</div>
        <div style={{ display: "flex", gap: 20, marginLeft: 40 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 9, opacity: 0.5 }}>DUE DATE</div>
            <div style={{ color: "#e8a820", fontWeight: 700, fontSize: 14 }}>{dueStr}</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 9, opacity: 0.5 }}>DUE TIME</div>
            <div style={{ color: "#e8a820", fontWeight: 700, fontSize: 14 }}>{timeStr}</div>
          </div>
          <div style={{ textAlign: "center", minWidth: 100 }}>
            <div style={{ fontSize: 9, opacity: 0.5 }}>COUNTDOWN</div>
            <div style={{ color: "#d94040", fontWeight: 700, fontSize: 14 }}>
              {p.due_date ? <Countdown targetDate={p.due_date} /> : "-"}
            </div>
          </div>
          <div style={{ width: 2, background: "rgba(255,255,255,0.1)", margin: "5px 0" }} />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 9, opacity: 0.5 }}>TASKS</div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{totalCount}</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 9, opacity: 0.5 }}>DONE</div>
            <div style={{ color: "#e8a820", fontWeight: 700, fontSize: 14 }}>{completedCount}</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 9, opacity: 0.5 }}>LEFT</div>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: 14 }}>{remainingCount}</div>
          </div>
        </div>
      </div>
      <div className="stripe" />

      <div style={{ padding: "20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 15 }}>
          <div className="sb-header-label">CAMPAIGN OBJECTIVES</div>
          <button
            onClick={() => setShowAddTask(true)}
            style={{ background: "transparent", border: "1px solid #e8a820", color: "#e8a820", padding: "4px 10px", borderRadius: 4, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
          >
            <Plus size={14} /> ADD TASK
          </button>
        </div>

        {showAddTask && (
          <div className="sb-row" style={{ background: "#1e3629", padding: 12, marginBottom: 15, border: "1px solid #e8a820" }}>
            <input
              autoFocus
              style={{ background: "transparent", border: "none", width: "100%", color: "#fff", outline: "none", fontSize: 14 }}
              placeholder="ENTER NEW TASK TITLE..."
              value={newTaskTitle}
              onChange={e => setNewTaskTitle(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addTaskMut.mutate(newTaskTitle)}
            />
          </div>
        )}

        <div className="sb-header" style={{ gridTemplateColumns: "1fr 100px 100px" }}>
          <div className="sb-col-head" style={{ textAlign: "left", paddingLeft: 16 }}>OBJECTIVE</div>
          <div className="sb-col-head">STATUS</div>
          <div className="sb-col-head">SUBTASKS</div>
        </div>

        {allTasks.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "rgba(255,255,255,0.3)" }}>No tasks assigned to this campaign.</div>
        ) : (
          allTasks.map((t: Task) => (
            <div key={t.id} style={{ marginBottom: 10 }}>
              <div className="sb-row" style={{ display: "grid", gridTemplateColumns: "1fr 100px 100px", background: "#1e3629", padding: "12px 0", borderLeft: t.priority === "high" || t.priority === "critical" ? "4px solid #e8a820" : "none" }}>
                <div style={{ paddingLeft: 16, display: "flex", alignItems: "center", gap: 10 }}>
                  {t.status === "done" ? <CheckCircle2 size={16} color="#e8a820" /> : <Circle size={16} color="rgba(255,255,255,0.2)" />}
                  <span style={{ fontWeight: 600, fontSize: 14, color: t.status === "done" ? "rgba(255,255,255,0.4)" : "#fff" }}>{t.title}</span>
                </div>
                <div style={{ textAlign: "center", fontSize: 10, textTransform: "uppercase", opacity: 0.6 }}>{t.status}</div>
                <div style={{ textAlign: "center", fontWeight: 700, color: "#e8a820" }}>
                  {t.subtasks?.length ? `${t.subtasks.filter(s => s.status === "done").length}/${t.subtasks.length}` : "-"}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Projects list page ────────────────────────────────────────────────────────

export function ProjectsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [showNew, setShowNew] = useState(false);
  const qc = useQueryClient();

  const { data: projects = [], isLoading } = useQuery<(ProjectSummary & { due_date?: string })[]>({
    queryKey: ["projects"],
    queryFn: () => projectsApi.list(),
  });

  const createMut = useMutation({
    mutationFn: () => projectsApi.create({
      title: newTitle.trim(),
      status: "active",
      priority: "medium",
      importance: 3,
      difficulty: 3,
      tag_ids: [],
      show_in_daily: true,
    }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      setNewTitle("");
      setShowNew(false);
      setSelectedId(p.id);
      toast.success("Campaign created!");
    },
  });

  if (selectedId) return <ProjectDetail id={selectedId} onBack={() => setSelectedId(null)} />;

  return (
    <div className="sb-shell" style={{ minHeight: "100vh", background: "#162a1c" }}>
      <div className="top-bar">
        <div className="top-title">CAMPAIGNS / PROJECTS</div>
        <button
          onClick={() => setShowNew(true)}
          style={{ background: "#e8a820", border: "none", padding: "6px 12px", borderRadius: 4, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
        >
          <Plus size={16} /> NEW
        </button>
      </div>
      <div className="stripe" />

      <div style={{ padding: "20px" }}>
        {showNew && (
          <div className="sb-row" style={{ background: "#1e3629", padding: 16, marginBottom: 20, border: "1px solid #e8a820" }}>
            <input
              autoFocus
              className="panel-num"
              style={{ background: "transparent", border: "none", width: "100%", fontSize: 20, color: "#fff", outline: "none" }}
              placeholder="ENTER CAMPAIGN TITLE..."
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => e.key === "Enter" && createMut.mutate()}
            />
            <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
              <button onClick={() => createMut.mutate()} style={{ background: "#e8a820", border: "none", padding: "4px 12px", fontWeight: 700, cursor: "pointer" }}>SAVE</button>
              <button onClick={() => setShowNew(false)} style={{ background: "transparent", border: "1px solid #fff", color: "#fff", padding: "4px 12px", cursor: "pointer" }}>CANCEL</button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
            <Loader2 size={28} style={{ color: "#e8a820", animation: "spin 1s linear infinite" }} />
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {projects.map(p => (
              <ProjectRow key={p.id} p={p} onClick={() => setSelectedId(p.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
