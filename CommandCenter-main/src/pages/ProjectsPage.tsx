import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { projectsApi, tasksApi } from "@/lib/api";
import { Loader2, ArrowLeft, Plus, ChevronRight, CheckCircle2, Circle, Pencil, X, Save } from "lucide-react";
import type { ProjectSummary, Task, Project } from "@/types";
import { toast } from "react-hot-toast";

// ─── Flip-panel primitives ──────────────────────────────────────────────────────

function SbPanel({
  value, label, color = "white", width = 48, fontSize = 20,
}: {
  value: string | number;
  label?: string;
  color?: "gold" | "red" | "white" | "dim";
  width?: number;
  fontSize?: number;
}) {
  const c = color === "gold" ? "#e8a820" : color === "red" ? "#d94040" : color === "dim" ? "rgba(255,255,255,0.2)" : "#fff";
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
      {label && <span className="panel-sub" style={{ fontSize: 8, letterSpacing: "0.13em" }}>{label}</span>}
    </div>
  );
}

function PanelColon() {
  return (
    <span style={{
      fontFamily: "'Oswald', Arial, sans-serif", fontSize: 22, fontWeight: 700,
      color: "rgba(245,240,224,0.3)", lineHeight: "48px", userSelect: "none", flexShrink: 0,
    }}>:</span>
  );
}

function Divider() {
  return <div style={{ width: 1, alignSelf: "stretch", background: "rgba(255,255,255,0.09)", flexShrink: 0 }} />;
}

// ─── Countdown ──────────────────────────────────────────────────────────────────

function Countdown({ targetDate }: { targetDate: string }) {
  const [txt, setTxt] = useState("");
  useEffect(() => {
    const tick = () => {
      const diff = new Date(targetDate).getTime() - Date.now();
      if (diff <= 0) { setTxt("DUE NOW"); return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      if (d > 0) setTxt(`${d}d ${h}h remaining`);
      else if (h > 0) setTxt(`${h}h ${m}m remaining`);
      else setTxt(`${m}m remaining`);
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, [targetDate]);
  return <span>{txt}</span>;
}

// ─── Months ──────────────────────────────────────────────────────────────────────
const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

// ─── Edit Project Modal ────────────────────────────────────────────────────

function EditProjectModal({
  project,
  onClose,
}: {
  project: ProjectSummary;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const due = project.due_date ? new Date(project.due_date) : null;

  // Local form state
  const [title, setTitle] = useState(project.title);
  const [status, setStatus] = useState(project.status);
  const [priority, setPriority] = useState(project.priority);
  const [description, setDescription] = useState(project.description || "");
  const [dueDate, setDueDate] = useState(
    due ? due.toISOString().slice(0, 10) : ""
  );
  const [dueTime, setDueTime] = useState(
    due ? due.toTimeString().slice(0, 5) : "09:00"
  );

  const updateMut = useMutation({
    mutationFn: (data: any) => projectsApi.update(project.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["project", project.id] });
      toast.success("Campaign updated!");
      onClose();
    },
    onError: () => toast.error("Failed to save"),
  });

  const handleSave = () => {
    const payload: any = { title: title.trim(), status, priority, description };
    if (dueDate) {
      payload.due_date = dueTime ? `${dueDate}T${dueTime}:00` : `${dueDate}T23:59:00`;
    } else {
      payload.due_date = null;
    }
    updateMut.mutate(payload);
  };

  const inputStyle: React.CSSProperties = {
    background: "#162a1c",
    border: "1px solid rgba(255,255,255,0.15)",
    color: "#f5f0e0",
    padding: "8px 10px",
    borderRadius: 4,
    fontSize: 13,
    width: "100%",
    fontFamily: "'Oswald', Arial, sans-serif",
    outline: "none",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 8,
    letterSpacing: "0.14em",
    color: "rgba(245,240,224,0.4)",
    marginBottom: 4,
    display: "block",
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: "#1e3629", border: "1px solid rgba(232,168,32,0.3)",
        borderRadius: 6, padding: 24, width: 480, maxWidth: "95vw",
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div className="panel-num" style={{ fontSize: 14, letterSpacing: "0.1em", color: "#e8a820" }}>EDIT CAMPAIGN</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.4)", padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: "grid", gap: 14 }}>
          {/* Title */}
          <div>
            <label style={labelStyle}>CAMPAIGN TITLE</label>
            <input style={inputStyle} value={title} onChange={e => setTitle(e.target.value)} />
          </div>

          {/* Due Date + Time */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={labelStyle}>DUE DATE</label>
              <input type="date" style={inputStyle} value={dueDate} onChange={e => setDueDate(e.target.value)}
                onFocus={e => (e.target.style.borderColor = "#e8a820")}
                onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.15)")} />
            </div>
            <div>
              <label style={labelStyle}>DUE TIME</label>
              <input type="time" style={inputStyle} value={dueTime} onChange={e => setDueTime(e.target.value)}
                onFocus={e => (e.target.style.borderColor = "#e8a820")}
                onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.15)")} />
            </div>
          </div>

          {/* Status + Priority */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={labelStyle}>STATUS</label>
              <select style={inputStyle} value={status} onChange={e => setStatus(e.target.value as any)}>
                <option value="active">ACTIVE</option>
                <option value="on_hold">ON HOLD</option>
                <option value="completed">COMPLETED</option>
                <option value="archived">ARCHIVED</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>PRIORITY</label>
              <select style={inputStyle} value={priority} onChange={e => setPriority(e.target.value as any)}>
                <option value="low">LOW</option>
                <option value="medium">MEDIUM</option>
                <option value="high">HIGH</option>
                <option value="critical">CRITICAL</option>
              </select>
            </div>
          </div>

          {/* Description */}
          <div>
            <label style={labelStyle}>DESCRIPTION</label>
            <textarea
              style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", padding: "7px 16px", borderRadius: 4, cursor: "pointer", fontSize: 12, fontFamily: "'Oswald', Arial, sans-serif", letterSpacing: "0.1em" }}>CANCEL</button>
          <button
            onClick={handleSave}
            disabled={updateMut.isPending}
            style={{ background: "#e8a820", border: "none", padding: "7px 16px", borderRadius: 4, fontWeight: 700, cursor: "pointer", fontSize: 12, fontFamily: "'Oswald', Arial, sans-serif", letterSpacing: "0.1em", display: "flex", alignItems: "center", gap: 6 }}
          >
            {updateMut.isPending ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Save size={14} />}
            SAVE
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Project list row (scoreboard card) ─────────────────────────────────────

function ProjectRow({
  p,
  onClick,
  onEdit,
}: {
  p: ProjectSummary;
  onClick: () => void;
  onEdit: (e: React.MouseEvent) => void;
}) {
  const due = p.due_date ? new Date(p.due_date) : null;
  const mon  = due ? MONTHS[due.getMonth()] : "---";
  const day  = due ? String(due.getDate()).padStart(2, "0") : "--";
  const hrs  = due ? String(due.getHours() % 12 || 12).padStart(2, "0") : "--";
  const min  = due ? String(due.getMinutes()).padStart(2, "0") : "--";
  const ampm = due ? (due.getHours() >= 12 ? "PM" : "AM") : "";

  const total = p.task_count ?? 0;
  const pct   = p.completion_percentage ?? 0;
  const done  = Math.round((total * pct) / 100);

  return (
    <div
      style={{
        background: "#1e3629",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 4,
        padding: "12px 16px",
        display: "grid",
        gridTemplateColumns: "minmax(160px, 26%) 1fr auto",
        alignItems: "center",
        gap: 0,
        transition: "background 0.15s",
      }}
      onMouseEnter={e => (e.currentTarget.style.background = "#244232")}
      onMouseLeave={e => (e.currentTarget.style.background = "#1e3629")}
    >
      {/* ── Name + countdown + edit btn ── */}
      <div style={{ paddingRight: 16, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            className="panel-num"
            style={{
              fontSize: 16, fontWeight: 700, letterSpacing: "0.06em",
              color: "#f5f0e0", textTransform: "uppercase",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              flex: 1, minWidth: 0, cursor: "pointer",
            }}
            onClick={onClick}
          >
            {p.title}
          </div>
          <button
            onClick={onEdit}
            title="Edit campaign"
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "rgba(232,168,32,0.5)", padding: 4, borderRadius: 3,
              flexShrink: 0, display: "flex", alignItems: "center",
            }}
            onMouseEnter={e => (e.currentTarget.style.color = "#e8a820")}
            onMouseLeave={e => (e.currentTarget.style.color = "rgba(232,168,32,0.5)")}
          >
            <Pencil size={13} />
          </button>
        </div>
        {due && (
          <div style={{ fontSize: 9, color: "#d94040", marginTop: 3, letterSpacing: "0.08em", fontFamily: "'Oswald', Arial, sans-serif" }}>
            <Countdown targetDate={p.due_date!} />
          </div>
        )}
      </div>

      {/* ── Panels area — spread across full remaining width ── */}
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-evenly", cursor: "pointer" }}
        onClick={onClick}
      >
        <Divider />

        {/* Tasks + Done + Pct */}
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "0 20px" }}>
          <SbPanel value={total} label="TASKS" color="white" width={48} fontSize={20} />
          <SbPanel value={done}  label="DONE"  color="gold"  width={48} fontSize={20} />
          <SbPanel value={`${pct}%`} label="COMPL" color={pct === 100 ? "gold" : pct > 0 ? "white" : "dim"} width={52} fontSize={16} />
        </div>

        <Divider />

        {/* Due Date: MON + DAY */}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "0 20px" }}>
          <SbPanel value={mon} label="MON" color={due ? "white" : "dim"} width={48} fontSize={14} />
          <SbPanel value={day} label="DAY" color={due ? "white" : "dim"} width={48} fontSize={20} />
        </div>

        <Divider />

        {/* Due Time: HH : MM */}
        <div style={{ display: "flex", gap: 6, alignItems: "flex-start", padding: "0 20px" }}>
          <SbPanel value={hrs} label="HRS" color={due ? "gold" : "dim"} width={48} fontSize={20} />
          <PanelColon />
          <SbPanel value={min} label={ampm || "MIN"} color={due ? "gold" : "dim"} width={48} fontSize={20} />
        </div>

        <Divider />
      </div>

      {/* ── Chevron ── */}
      <div style={{ paddingLeft: 12, cursor: "pointer" }} onClick={onClick}>
        <ChevronRight size={20} color="#e8a820" />
      </div>
    </div>
  );
}

// ─── Project Detail ──────────────────────────────────────────────────────────

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
      qc.invalidateQueries({ queryKey: ["projects"] });
      setNewTaskTitle("");
      setShowAddTask(false);
      toast.success("Task added to campaign");
    },
  });

  // Toggle task done / undone
  const toggleTaskMut = useMutation({
    mutationFn: (t: Task) =>
      t.status === "done"
        ? tasksApi.update(t.id, { status: "today" })
        : tasksApi.complete(t.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: () => toast.error("Failed to update task"),
  });

  if (isLoading || !p) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "300px" }}>
        <Loader2 size={28} style={{ color: "#e8a820", animation: "spin 1s linear infinite" }} />
      </div>
    );
  }

  const allTasks = p.tasks || [];
  const completedCount = allTasks.reduce((acc, t) =>
    acc + (t.status === "done" ? 1 : 0) + (t.subtasks || []).filter(s => s.status === "done").length
  , 0);
  const totalCount = allTasks.reduce((acc, t) => acc + 1 + (t.subtasks || []).length, 0);
  const remainingCount = totalCount - completedCount;

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
            onClick={() => setShowAddTask(v => !v)}
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
              onKeyDown={e => {
                if (e.key === "Enter" && newTaskTitle.trim()) addTaskMut.mutate(newTaskTitle.trim());
                if (e.key === "Escape") setShowAddTask(false);
              }}
            />
          </div>
        )}

        <div className="sb-header" style={{ gridTemplateColumns: "1fr 110px 100px" }}>
          <div className="sb-col-head" style={{ textAlign: "left", paddingLeft: 16 }}>OBJECTIVE</div>
          <div className="sb-col-head">STATUS</div>
          <div className="sb-col-head">SUBTASKS</div>
        </div>

        {allTasks.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "rgba(255,255,255,0.3)" }}>No tasks assigned to this campaign.</div>
        ) : (
          allTasks.map((t: Task) => (
            <div
              key={t.id}
              className="sb-row"
              style={{
                display: "grid", gridTemplateColumns: "1fr 110px 100px",
                background: t.status === "done" ? "rgba(30,54,41,0.5)" : "#1e3629",
                padding: "0",
                marginBottom: 8,
                borderLeft: t.priority === "critical" ? "4px solid #d94040" : t.priority === "high" ? "4px solid #e8a820" : "none",
                cursor: "pointer",
                transition: "background 0.12s",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "#244232")}
              onMouseLeave={e => (e.currentTarget.style.background = t.status === "done" ? "rgba(30,54,41,0.5)" : "#1e3629")}
              onClick={() => toggleTaskMut.mutate(t)}
            >
              <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
                {toggleTaskMut.isPending
                  ? <Loader2 size={16} style={{ color: "#e8a820", animation: "spin 1s linear infinite", flexShrink: 0 }} />
                  : t.status === "done"
                    ? <CheckCircle2 size={16} color="#e8a820" style={{ flexShrink: 0 }} />
                    : <Circle size={16} color="rgba(255,255,255,0.2)" style={{ flexShrink: 0 }} />}
                <span style={{ fontWeight: 600, fontSize: 14, color: t.status === "done" ? "rgba(255,255,255,0.35)" : "#fff", textDecoration: t.status === "done" ? "line-through" : "none" }}>
                  {t.title}
                </span>
              </div>
              <div style={{ textAlign: "center", fontSize: 9, textTransform: "uppercase", opacity: 0.5, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {t.status}
              </div>
              <div style={{ textAlign: "center", fontWeight: 700, color: "#e8a820", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {t.subtasks?.length ? `${t.subtasks.filter(s => s.status === "done").length}/${t.subtasks.length}` : "-"}
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
  const [editingProject, setEditingProject] = useState<ProjectSummary | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [showNew, setShowNew] = useState(false);
  const qc = useQueryClient();

  const { data: projects = [], isLoading } = useQuery<ProjectSummary[]>({
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
      {/* Edit modal */}
      {editingProject && (
        <EditProjectModal
          project={editingProject}
          onClose={() => setEditingProject(null)}
        />
      )}

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
              onKeyDown={e => {
                if (e.key === "Enter" && newTitle.trim()) createMut.mutate();
                if (e.key === "Escape") setShowNew(false);
              }}
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
              <ProjectRow
                key={p.id}
                p={p}
                onClick={() => setSelectedId(p.id)}
                onEdit={e => { e.stopPropagation(); setEditingProject(p); }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
