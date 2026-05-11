import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { projectsApi, tasksApi, tagsApi, categoriesApi } from "@/lib/api";
import { Loader2, ArrowLeft, Plus, ChevronRight, CheckCircle2, Circle, Pencil, X, Save, Star } from "lucide-react";
import { TaskModal } from "@/components/todos/TaskModal";
import { TaskContextMenu } from "@/components/todos/TaskContextMenu";
import { CompletionDialog } from "@/components/todos/CompletionDialog";
import { useActiveTimer } from "@/hooks/useTimer";
import { useTimerStore, useUIStore } from "@/store";
import type { ProjectSummary, Task, Project, TaskStatus } from "@/types";
import { toast } from "react-hot-toast";
import { useParams } from "react-router-dom";
import { todayStr } from "@/lib/utils";
import { parseTask } from "@/lib/nlp";

/** Flatten tasks in parent → children tree order for display. */
function orderProjectTasksForDisplay(tasks: Task[]): Task[] {
  const idSet = new Set(tasks.map(t => t.id));
  const isTop = (t: Task) => !t.parent_id || !idSet.has(t.parent_id!);
  const tops = tasks.filter(isTop).sort((a, b) => {
    const aDone = a.status === "done" || a.status === "cancelled";
    const bDone = b.status === "done" || b.status === "cancelled";
    if (aDone !== bDone) return aDone ? 1 : -1;
    return (a.sort_order ?? 0) - (b.sort_order ?? 0);
  });
  const childrenOf = (pid: string) =>
    tasks
      .filter(k => k.parent_id === pid)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const out: Task[] = [];
  const walk = (node: Task) => {
    out.push(node);
    for (const c of childrenOf(node.id)) walk(c);
  };
  for (const p of tops) walk(p);
  const seen = new Set(out.map(t => t.id));
  for (const t of tasks) {
    if (!seen.has(t.id)) {
      out.push(t);
      seen.add(t.id);
    }
  }
  return out;
}

function taskIndentDepth(t: Task, tasks: Task[]): number {
  const byId: Record<string, Task> = Object.fromEntries(tasks.map(x => [x.id, x]));
  let d = 0;
  let cur: Task | undefined = t;
  while (cur?.parent_id && byId[cur.parent_id]) {
    d++;
    cur = byId[cur.parent_id];
  }
  return d;
}

/** True if newParentId is dragId or an ancestor of dragId (would create a cycle). */
function wouldCreateParentCycle(tasks: Task[], dragId: string, newParentId: string): boolean {
  let cur: Task | undefined = tasks.find(x => x.id === newParentId);
  while (cur) {
    if (cur.id === dragId) return true;
    cur = cur.parent_id ? tasks.find(x => x.id === cur!.parent_id) : undefined;
  }
  return false;
}

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
  onComplete,
}: {
  p: ProjectSummary;
  onClick: () => void;
  onEdit: (e: React.MouseEvent) => void;
  onComplete: () => void;
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
      onContextMenu={e => {
        e.preventDefault();
        onComplete();
      }}
      title="Right-click to complete campaign (+30 Focus Score)"
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
  const addTaskInputRef = useRef<HTMLInputElement>(null);
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [showHierarchyModal, setShowHierarchyModal] = useState(false);
  const [pendingHierarchyTitle, setPendingHierarchyTitle] = useState("");
  const [modalParentPick, setModalParentPick] = useState("");
  /** When using context menu "Add child task", pre-select this parent in the modal */
  const [childShortcutParentId, setChildShortcutParentId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [completionTask, setCompletionTask] = useState<Task | null>(null);
  const [hideCompleted, setHideCompleted] = useState(false);
  const qc = useQueryClient();
  const { isRunning, activeTimer, elapsedSeconds, start, stop } = useActiveTimer();
  const { setActiveTimer } = useTimerStore();
  const { addTaskOpen, addTaskProjectId, clearAddTaskContext } = useUIStore();

  const { data: p, isLoading } = useQuery<Project>({
    queryKey: ["project", id],
    queryFn: () => projectsApi.get(id),
  });
  const { data: allTags = [] } = useQuery({
    queryKey: ["tags"],
    queryFn: tagsApi.list,
    staleTime: 5 * 60_000,
  });
  const { data: allProjects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => projectsApi.list(),
    staleTime: 60_000,
  });
  const { data: allCategories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: categoriesApi.list,
    staleTime: 60_000,
  });

  const addTaskMut = useMutation({
    mutationFn: ({ title, parentId }: { title: string; parentId?: string }) => {
      const p = parseTask(title);
      const cleanTitle = p.cleanTitle || title.trim();
      let due_date: string | undefined;
      if (p.dueDate && p.dueTime) due_date = `${p.dueDate}T${p.dueTime}:00`;
      else if (p.dueDate) due_date = `${p.dueDate}T00:00:00`;
      else if (p.dueTime) due_date = `${todayStr()}T${p.dueTime}:00`;
      const dateKey = due_date?.split("T")[0];
      const status: TaskStatus = dateKey === todayStr() ? "today" : "upcoming";
      return tasksApi.create({
        title: cleanTitle,
        project_id: id,
        parent_id: parentId,
        status,
        priority: "medium",
        importance: 3,
        difficulty: 3,
        due_date,
        tag_ids: [],
        show_in_daily: true,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      setNewTaskTitle("");
      setShowHierarchyModal(false);
      setPendingHierarchyTitle("");
      setModalParentPick("");
      setChildShortcutParentId(null);
      setShowAddTask(false);
      toast.success("Task added to campaign");
    },
  });

  useEffect(() => {
    if (!showAddTask) return;
    const id = window.setTimeout(() => addTaskInputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [showAddTask]);

  useEffect(() => {
    if (!addTaskOpen) return;
    if (addTaskProjectId !== id) return;
    setShowAddTask(true);
    setChildShortcutParentId(null);
    clearAddTaskContext();
  }, [addTaskOpen, addTaskProjectId, clearAddTaskContext, id]);

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
  const quickUpdateMut = useMutation({
    mutationFn: ({ taskId, patch }: { taskId: string; patch: Record<string, any> }) => tasksApi.update(taskId, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: () => toast.error("Update failed"),
  });

  if (isLoading || !p) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "300px" }}>
        <Loader2 size={28} style={{ color: "#e8a820", animation: "spin 1s linear infinite" }} />
      </div>
    );
  }

  const allTasks = p.tasks || [];
  const addToken = newTaskTitle.match(/(?:^|\s)([#@!])([^\s]*)$/);
  const addPrefix = addToken?.[1] ?? null;
  const addQuery = addToken?.[2] ?? "";
  const addSuggestions =
    addPrefix === "#"
      ? (allTags as any[])
          .filter((t: any) => t.name.toLowerCase().includes(addQuery.toLowerCase()))
          .slice(0, 6)
          .map((t: any) => ({ label: `#${t.name}`, value: `#${t.name}` }))
      : addPrefix === "!"
      ? [5, 4, 3, 2, 1]
          .filter((n) => String(n).startsWith(addQuery))
          .map((n) => ({ label: `!${n} importance`, value: `!${n}` }))
      : addPrefix === "@"
      ? [
          { label: "@easy difficulty", value: "@easy" },
          { label: "@medium difficulty", value: "@medium" },
          { label: "@hard difficulty", value: "@hard" },
          { label: "@veryhard difficulty", value: "@veryhard" },
        ].filter((o) => o.value.includes(addQuery.toLowerCase()))
      : [];

  const applyAddSuggestion = (tokenValue: string) => {
    setNewTaskTitle((prev) => prev.replace(/(?:^|\s)([#@!])([^\s]*)$/, (m) => {
      const lead = m.startsWith(" ") ? " " : "";
      return `${lead}${tokenValue} `;
    }));
  };
  const flattenedAllTasks = allTasks.flatMap((t) => [t, ...(t.subtasks ?? [])]) as Task[];
  const sortedTasks = [...flattenedAllTasks].sort((a, b) => {
    const aDone = a.status === "done" || a.status === "cancelled";
    const bDone = b.status === "done" || b.status === "cancelled";
    if (aDone !== bDone) return aDone ? 1 : -1;
    return (a.sort_order ?? 0) - (b.sort_order ?? 0);
  });
  const visibleTasks = hideCompleted ? sortedTasks.filter(t => t.status !== "done" && t.status !== "cancelled") : sortedTasks;
  const orderedVisibleTasks = orderProjectTasksForDisplay(visibleTasks);
  const parentCandidates = flattenedAllTasks.filter(t => !t.parent_id && t.status !== "done" && t.status !== "cancelled");
  const childCounts = new Map<string, number>();
  for (const task of orderedVisibleTasks) {
    if (!task.parent_id) continue;
    childCounts.set(task.parent_id, (childCounts.get(task.parent_id) ?? 0) + 1);
  }
  const parentBonusById = new Map<string, number>();
  childCounts.forEach((count, taskId) => {
    if (count > 0) parentBonusById.set(taskId, 5);
  });
  const childIndexByTaskId = new Map<string, number>();
  const runningChildIndex = new Map<string, number>();
  for (const task of orderedVisibleTasks) {
    if (!task.parent_id) continue;
    const idx = (runningChildIndex.get(task.parent_id) ?? 0) + 1;
    runningChildIndex.set(task.parent_id, idx);
    childIndexByTaskId.set(task.id, idx);
  }
  const tagMap: Record<string, string> = Object.fromEntries((allTags as any[]).map((t: any) => [t.id, t.name]));
  const completedCount = allTasks.reduce((acc, t) =>
    acc + (t.status === "done" ? 1 : 0) + (t.subtasks || []).filter(s => s.status === "done").length
  , 0);
  const totalCount = allTasks.reduce((acc, t) => acc + 1 + (t.subtasks || []).length, 0);
  const remainingCount = totalCount - completedCount;

  const due = p.due_date ? new Date(p.due_date) : null;
  const dueStr  = due ? due.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "-";
  const timeStr = due ? due.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "-";
  const formatTimer = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  };
  const derivedPriority = (t: Task): "critical" | "high" | "medium" | "low" => {
    const stars = Number(t.importance ?? 0);
    if (stars >= 5) return "critical";
    if (stars >= 4) return "high";
    if (stars >= 2) return "medium";
    return "low";
  };
  const priorityFromImportance = (n: number): "critical" | "high" | "medium" | "low" =>
    n >= 5 ? "critical" : n >= 4 ? "high" : n >= 2 ? "medium" : "low";

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
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              onClick={() => { setChildShortcutParentId(null); setShowAddTask(true); }}
              style={{ background: "transparent", border: "1px solid rgba(245,240,224,0.35)", color: "rgba(245,240,224,0.85)", padding: "4px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 5, letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: "'Oswald', Arial, sans-serif" }}
              title="Add a task — after Enter, choose parent vs child"
            >
              Add Parent Task
            </button>
            <button
              type="button"
              onClick={() => setShowAddTask(v => !v)}
              style={{ background: "transparent", border: "1px solid #e8a820", color: "#e8a820", padding: "4px 10px", borderRadius: 4, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
            >
              <Plus size={14} /> ADD TASK
            </button>
          </div>
        </div>
        <div style={{ fontSize: 10, letterSpacing: "0.07em", textTransform: "uppercase", color: "rgba(245,240,224,0.35)", marginBottom: 10, fontFamily: "'Oswald', Arial, sans-serif" }}>
          Drag a task row onto another row to make it a child task
        </div>

        {showAddTask && (
          <div className="sb-row" style={{ background: "#1e3629", padding: 12, marginBottom: 15, border: "1px solid #e8a820" }}>
            <input
              ref={addTaskInputRef}
              autoFocus
              style={{ background: "transparent", border: "none", width: "100%", color: "#fff", outline: "none", fontSize: 14 }}
              placeholder="NEW TASK TITLE… (Enter to choose parent vs child)"
              value={newTaskTitle}
              onChange={e => setNewTaskTitle(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && newTaskTitle.trim()) {
                  e.preventDefault();
                  if (childShortcutParentId) {
                    addTaskMut.mutate({ title: newTaskTitle.trim(), parentId: childShortcutParentId });
                    return;
                  }
                  setPendingHierarchyTitle(newTaskTitle.trim());
                  setModalParentPick("");
                  setShowHierarchyModal(true);
                }
                if (e.key === "Escape") setShowAddTask(false);
              }}
            />
            <div style={{ marginTop: 8, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(245,240,224,0.35)", fontFamily: "'Oswald', Arial, sans-serif" }}>
              Press Enter to place this task — parent task or child of another row
            </div>
            {addPrefix && addSuggestions.length > 0 && (
              <div style={{ marginTop: 8, border: "1px solid rgba(232,168,32,0.22)", background: "#162a1c", borderRadius: 3, overflow: "hidden" }}>
                {addSuggestions.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applyAddSuggestion(s.value);
                    }}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      background: "transparent",
                      border: "none",
                      color: "rgba(245,240,224,0.75)",
                      padding: "6px 10px",
                      fontSize: 11,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      cursor: "pointer",
                      fontFamily: "'Oswald', Arial, sans-serif",
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(245,240,224,0.55)", fontFamily: "'Oswald', Arial, sans-serif" }}>
            <input type="checkbox" checked={hideCompleted} onChange={e => setHideCompleted(e.target.checked)} />
            Hide Completed
          </label>
        </div>

        <div className="sb-header" style={{ gridTemplateColumns: "1fr 92px 86px 86px 100px 100px 120px" }}>
          <div className="sb-col-head" style={{ textAlign: "left", paddingLeft: 16 }}>OBJECTIVE</div>
          <div className="sb-col-head">PRIORITY</div>
          <div className="sb-col-head">FS</div>
          <div className="sb-col-head">EST</div>
          <div className="sb-col-head">DUE DATE</div>
          <div className="sb-col-head">DUE TIME</div>
          <div className="sb-col-head">TAG</div>
        </div>

        {orderedVisibleTasks.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "rgba(255,255,255,0.3)" }}>No tasks assigned to this campaign.</div>
        ) : (
          orderedVisibleTasks.map((t: Task) => {
            const hasChildren = (childCounts.get(t.id) ?? 0) > 0;
            const isChild = !!t.parent_id;
            const childIndex = isChild ? (childIndexByTaskId.get(t.id) ?? 0) : 0;
            const siblingCount = isChild && t.parent_id ? (childCounts.get(t.parent_id) ?? 0) : 0;
            const isLastChild = isChild && siblingCount > 0 && childIndex === siblingCount;
            const groupBorder = "1px solid rgba(245,240,224,0.45)";
            return (
            <TaskContextMenu
              key={t.id}
              task={t}
              projects={allProjects as any[]}
              categories={allCategories as any[]}
              tags={allTags as any[]}
              onSetDueDate={(dateIso?: string) => quickUpdateMut.mutate({ taskId: t.id, patch: { due_date: dateIso ? `${dateIso}T00:00:00Z` : null } })}
              onSetStartTime={(iso?: string) => quickUpdateMut.mutate({ taskId: t.id, patch: { scheduled_start_at: iso ?? null } })}
              onSetImportance={(n: number) => quickUpdateMut.mutate({ taskId: t.id, patch: { importance: n, priority: priorityFromImportance(n) } })}
              onSetDifficulty={(n: number) => quickUpdateMut.mutate({ taskId: t.id, patch: { difficulty: n } })}
              onSetProject={(projectId?: string) => quickUpdateMut.mutate({ taskId: t.id, patch: { project_id: projectId ?? null } })}
              onSetCategory={(categoryId?: string) => quickUpdateMut.mutate({ taskId: t.id, patch: { category_id: categoryId ?? null } })}
              onToggleTag={(tagId: string) => {
                const cur = t.tag_ids ?? [];
                const next = cur.includes(tagId) ? cur.filter(id => id !== tagId) : [...cur, tagId];
                quickUpdateMut.mutate({ taskId: t.id, patch: { tag_ids: next } });
              }}
              onEdit={() => setSelectedTask({ ...t, tag_ids: t.tag_ids ?? [], subtasks: t.subtasks ?? [] })}
              onAddChildTask={() => {
                setChildShortcutParentId(t.id);
                setShowAddTask(true);
                window.setTimeout(() => addTaskInputRef.current?.focus(), 80);
              }}
              onDelete={() => {
                if (!window.confirm(`Delete "${t.title}"?`)) return;
                tasksApi.delete(t.id).then(() => {
                  qc.invalidateQueries({ queryKey: ["project", id] });
                  qc.invalidateQueries({ queryKey: ["projects"] });
                });
              }}
            >
              <div
                className="sb-row"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/task-id", t.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => setDragOverId(null)}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDragOverId(t.id);
                }}
                onDragLeave={() => setDragOverId(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOverId(null);
                  const from = e.dataTransfer.getData("application/task-id");
                  if (!from || from === t.id) return;
                  if (wouldCreateParentCycle(flattenedAllTasks, from, t.id)) {
                    toast.error("Cannot nest a task under its own subtask");
                    return;
                  }
                  quickUpdateMut.mutate({ taskId: from, patch: { parent_id: t.id } });
                }}
                style={{
                  display: "grid", gridTemplateColumns: "1fr 92px 86px 86px 100px 100px 120px",
                  background: t.status === "done" ? "rgba(30,54,41,0.5)" : "#1e3629",
                  padding: "0",
                  marginBottom: isLastChild ? 14 : 8,
                  borderLeft: hasChildren || isChild ? groupBorder : (derivedPriority(t) === "critical" ? "4px solid #d94040" : derivedPriority(t) === "high" ? "4px solid #e8a820" : "none"),
                  borderRight: hasChildren || isChild ? groupBorder : undefined,
                  borderTop: hasChildren ? groupBorder : undefined,
                  borderBottom: isLastChild ? groupBorder : undefined,
                  outline: dragOverId === t.id ? "2px dashed rgba(232,168,32,0.65)" : "none",
                  outlineOffset: 0,
                  cursor: "pointer",
                  marginTop: hasChildren ? 14 : 0,
                  transition: "background 0.12s",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "#244232")}
                onMouseLeave={e => (e.currentTarget.style.background = t.status === "done" ? "rgba(30,54,41,0.5)" : "#1e3629")}
                onClick={() => setSelectedTask({ ...t, tag_ids: t.tag_ids ?? [], subtasks: t.subtasks ?? [] })}
                title="Drag onto another row to make it a subtask of that row"
              >
                <div style={{ padding: "12px 16px", paddingLeft: 12 + taskIndentDepth(t, flattenedAllTasks) * 22, display: "flex", alignItems: "center", gap: 10 }}>
                  <button
                    type="button"
                    draggable={false}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (t.status === "done") toggleTaskMut.mutate(t);
                      else setCompletionTask(t);
                    }}
                    style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center" }}
                    title={t.status === "done" ? "Mark active" : "Mark complete"}
                  >
                    {toggleTaskMut.isPending
                      ? <Loader2 size={16} style={{ color: "#e8a820", animation: "spin 1s linear infinite", flexShrink: 0 }} />
                      : t.status === "done"
                        ? <CheckCircle2 size={16} color="#e8a820" style={{ flexShrink: 0 }} />
                        : <Circle size={16} color="rgba(255,255,255,0.2)" style={{ flexShrink: 0 }} />}
                  </button>
                  {hasChildren && (
                    <Star
                      size={13}
                      color="#e8a820"
                      fill="#e8a820"
                      style={{ flexShrink: 0 }}
                      title="Parent task bonus: +5 Focus Score"
                    />
                  )}
                  <span style={{
                    fontWeight: hasChildren ? 900 : 600,
                    fontSize: hasChildren ? 17 : 14,
                    textTransform: hasChildren ? "uppercase" as const : "none",
                    letterSpacing: hasChildren ? "0.06em" : "normal",
                    color: t.status === "done" ? "rgba(255,255,255,0.35)" : "#fff",
                    textDecoration: t.status === "done" ? "line-through" : "none",
                  }}>
                    {hasChildren ? t.title.toUpperCase() : t.title}
                  </span>
                  <button
                    type="button"
                    draggable={false}
                    onClick={(e) => {
                      e.stopPropagation();
                      const isThisRunning = isRunning && activeTimer?.task_id === t.id;
                      if (isThisRunning) {
                        stop();
                        return;
                      }
                      setActiveTimer(null, t);
                      start({ task_id: t.id });
                    }}
                    title={(isRunning && activeTimer?.task_id === t.id) ? "Stop timer" : "Start timer"}
                    style={{
                      marginLeft: "auto",
                      width: 24,
                      height: 24,
                      borderRadius: 3,
                      border: "1px solid rgba(245,240,224,0.22)",
                      background: "transparent",
                      color: (isRunning && activeTimer?.task_id === t.id) ? "#d94040" : "rgba(245,240,224,0.55)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    {(isRunning && activeTimer?.task_id === t.id) ? (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect x="1" y="1" width="8" height="8" rx="1" /></svg>
                    ) : (
                      <svg width="9" height="10" viewBox="0 0 9 10" fill="currentColor"><path d="M1 1 L8 5 L1 9 Z" /></svg>
                    )}
                  </button>
                  {(isRunning && activeTimer?.task_id === t.id) && (
                    <span style={{ fontSize: 10, letterSpacing: "0.08em", color: "#d94040", fontFamily: "'Oswald', Arial, sans-serif", minWidth: 36, textAlign: "right" }}>
                      {formatTimer(elapsedSeconds)}
                    </span>
                  )}
                </div>
                <div style={{ textAlign: "center", fontSize: 10, textTransform: "uppercase", opacity: 0.75, display: "flex", alignItems: "center", justifyContent: "center", color: derivedPriority(t) === "critical" ? "#d94040" : derivedPriority(t) === "high" ? "#e8a820" : "rgba(245,240,224,0.75)", letterSpacing: "0.08em", fontFamily: "'Oswald', Arial, sans-serif" }}>
                  {derivedPriority(t)}
                </div>
                <div style={{ textAlign: "center", fontWeight: 700, color: "#e8a820", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Oswald', Arial, sans-serif", letterSpacing: "0.06em" }}>
                  {(t.focus_score ?? 0) + (parentBonusById.get(t.id) ?? 0)}
                </div>
                <div style={{ textAlign: "center", fontWeight: 700, color: "rgba(245,240,224,0.75)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Oswald', Arial, sans-serif", letterSpacing: "0.06em" }}>
                  {t.time_estimate_minutes ? `${t.time_estimate_minutes}m` : "—"}
                </div>
                <div style={{ textAlign: "center", fontWeight: 700, color: "rgba(245,240,224,0.75)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Oswald', Arial, sans-serif", letterSpacing: "0.06em" }}>
                  {t.scheduled_start_at ? new Date(t.scheduled_start_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : t.due_date ? new Date(t.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                </div>
                <div style={{ textAlign: "center", fontWeight: 700, color: "rgba(245,240,224,0.75)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Oswald', Arial, sans-serif", letterSpacing: "0.06em" }}>
                  {t.scheduled_start_at
                    ? new Date(t.scheduled_start_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                    : t.due_date
                    ? new Date(t.due_date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                    : "—"}
                </div>
                <div style={{ textAlign: "center", fontWeight: 700, color: "rgba(245,240,224,0.75)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Oswald', Arial, sans-serif", letterSpacing: "0.06em" }}>
                  {t.tag_ids?.[0] ? (tagMap[t.tag_ids[0]] || t.tag_ids[0]) : "—"}
                </div>
              </div>
            </TaskContextMenu>
          );
          })
        )}
      </div>

      {showHierarchyModal && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1100,
          }}
          onClick={e => {
            if (e.target === e.currentTarget) {
              setShowHierarchyModal(false);
              window.setTimeout(() => addTaskInputRef.current?.focus(), 0);
            }
          }}
        >
          <div
            style={{
              background: "#1e3629",
              border: "1px solid rgba(232,168,32,0.5)",
              borderRadius: 8,
              padding: "22px 24px",
              width: 460,
              maxWidth: "94vw",
              boxShadow: "0 24px 80px rgba(0,0,0,0.65)",
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontSize: 10, letterSpacing: "0.18em", color: "#e8a820", fontFamily: "'Oswald',Arial,sans-serif", marginBottom: 10 }}>
              PLACE TASK
            </div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", marginBottom: 18, fontFamily: "'Oswald',Arial,sans-serif", letterSpacing: "0.05em", lineHeight: 1.35 }}>
              {pendingHierarchyTitle}
            </div>
            <button
              type="button"
              disabled={addTaskMut.isPending}
              onClick={() => addTaskMut.mutate({ title: pendingHierarchyTitle, parentId: undefined })}
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 4,
                border: "1px solid rgba(232,168,32,0.45)",
                background: "rgba(232,168,32,0.12)",
                color: "#e8a820",
                fontFamily: "'Oswald',Arial,sans-serif",
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: "0.12em",
                cursor: addTaskMut.isPending ? "wait" : "pointer",
              }}
            >
              PARENT TASK (TOP-LEVEL)
            </button>
            <div style={{ margin: "16px 0", height: 1, background: "rgba(255,255,255,0.08)" }} />
            <div style={{ fontSize: 9, letterSpacing: "0.12em", color: "rgba(245,240,224,0.45)", marginBottom: 8, fontFamily: "'Oswald',Arial,sans-serif" }}>
              CHILD OF (SELECT PARENT)
            </div>
            <select
              value={modalParentPick}
              onChange={e => setModalParentPick(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                marginBottom: 12,
                background: "rgba(0,0,0,0.35)",
                color: "#f5f0e0",
                border: "1px solid rgba(245,240,224,0.2)",
                borderRadius: 4,
                fontSize: 13,
                fontFamily: "'Oswald',Arial,sans-serif",
              }}
            >
              <option value="">Choose parent task…</option>
              {parentCandidates.map((pt) => (
                <option key={pt.id} value={pt.id}>{pt.title}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={addTaskMut.isPending || !modalParentPick}
              onClick={() => {
                if (!modalParentPick) {
                  toast.error("Select a parent task");
                  return;
                }
                addTaskMut.mutate({ title: pendingHierarchyTitle, parentId: modalParentPick });
              }}
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 4,
                border: "1px solid rgba(245,240,224,0.25)",
                background: "rgba(255,255,255,0.06)",
                color: "#f5f0e0",
                fontFamily: "'Oswald',Arial,sans-serif",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.1em",
                cursor: addTaskMut.isPending || !modalParentPick ? "not-allowed" : "pointer",
                opacity: !modalParentPick ? 0.45 : 1,
              }}
            >
              ADD AS CHILD TASK
            </button>
            <button
              type="button"
              onClick={() => {
                setShowHierarchyModal(false);
                window.setTimeout(() => addTaskInputRef.current?.focus(), 0);
              }}
              style={{
                marginTop: 12,
                width: "100%",
                padding: "8px",
                background: "transparent",
                border: "none",
                color: "rgba(245,240,224,0.35)",
                fontSize: 11,
                letterSpacing: "0.1em",
                cursor: "pointer",
                fontFamily: "'Oswald',Arial,sans-serif",
              }}
            >
              CANCEL
            </button>
          </div>
        </div>
      )}

      {selectedTask && (
        <TaskModal
          open={true}
          task={selectedTask}
          onClose={() => {
            setSelectedTask(null);
            qc.invalidateQueries({ queryKey: ["project", id] });
          }}
        />
      )}
      {completionTask && (
        <CompletionDialog
          task={completionTask}
          elapsedSeconds={0}
          onClose={() => setCompletionTask(null)}
          onDone={() => {
            setCompletionTask(null);
            qc.invalidateQueries({ queryKey: ["project", id] });
            qc.invalidateQueries({ queryKey: ["projects"] });
            qc.invalidateQueries({ queryKey: ["tasks"] });
            qc.invalidateQueries({ queryKey: ["dashboard"] });
          }}
        />
      )}
    </div>
  );
}

// ─── Projects list page ────────────────────────────────────────────────────────

export function ProjectsPage() {
  const { projectId } = useParams<{ projectId?: string }>();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingProject, setEditingProject] = useState<ProjectSummary | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [hideCompleted, setHideCompleted] = useState(true);
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

  const completeProjectMut = useMutation({
    mutationFn: async (project: ProjectSummary) => {
      const fullProject = await projectsApi.get(project.id);
      await projectsApi.update(project.id, { status: "completed" });
      const openTasks = (fullProject.tasks ?? []).filter(t => t.status !== "done" && t.status !== "cancelled");
      if (openTasks.length > 0) {
        await Promise.all(openTasks.map(t => tasksApi.complete(t.id)));
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Campaign completed! +30 Focus Score bonus");
    },
    onError: () => toast.error("Could not complete campaign"),
  });

  useEffect(() => {
    if (projectId) setSelectedId(projectId);
  }, [projectId]);

  const visibleProjects = hideCompleted
    ? projects.filter(p => p.status !== "completed")
    : projects;

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
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <label style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 10,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "rgba(245,240,224,0.55)",
            fontFamily: "'Oswald', Arial, sans-serif",
          }}>
            <input
              type="checkbox"
              checked={hideCompleted}
              onChange={e => setHideCompleted(e.target.checked)}
            />
            Hide Completed
          </label>
          <button
            onClick={() => setShowNew(true)}
            style={{ background: "#e8a820", border: "none", padding: "6px 12px", borderRadius: 4, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
          >
            <Plus size={16} /> NEW
          </button>
        </div>
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
            {visibleProjects.map(p => (
              <ProjectRow
                key={p.id}
                p={p}
                onClick={() => setSelectedId(p.id)}
                onEdit={e => { e.stopPropagation(); setEditingProject(p); }}
                onComplete={() => {
                  if (p.status === "completed") {
                    toast("Campaign is already completed");
                    return;
                  }
                  const ok = window.confirm(`Complete "${p.title}" and mark remaining tasks done? (+30 Focus Score bonus)`);
                  if (ok) completeProjectMut.mutate(p);
                }}
              />
            ))}
            {visibleProjects.length === 0 && (
              <div style={{ padding: 24, textAlign: "center", color: "rgba(245,240,224,0.45)" }}>
                No campaigns match this filter.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

