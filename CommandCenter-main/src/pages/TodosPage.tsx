import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { tasksApi, dashboardApi, gamificationApi, categoriesApi } from "@/lib/api";
import { TaskCard } from "@/components/todos/TaskCard";
import { QuickAdd } from "@/components/todos/QuickAdd";
import { TaskModal } from "@/components/todos/TaskModal";
import { Loader2 } from "lucide-react";
import type { Priority, TaskStatus } from "@/types";
import { useTimerStore, useUIStore, usePinnedTaskStore } from "@/store";
import { battingAvgStr, toDateStr, todayStr } from "@/lib/utils";

type TodoMode = "today" | "upcoming" | "done";

function histAvg(arr: number[]): number {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}
function histBest(arr: number[]): number {
  return arr.length ? Math.max(...arr) : 0;
}
function fmtFocus(min: number | null): string {
  if (min === null) return "—";
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? `${h}h${m > 0 ? `${m}m` : ""}` : m > 0 ? `${m}m` : "0m";
}

function SbCell({ value, sub, color = "white" }: { value: string | number; sub?: string; color?: "gold" | "red" | "white" | "empty" }) {
  const c = color === "gold" ? "#e8a820" : color === "red" ? "#d94040" : color === "empty" ? "rgba(255,255,255,0.12)" : "#fff";
  const len = String(value).length;
  const fs = len > 5 ? 13 : len > 3 ? 18 : 26;
  return (
    <div className="sb-cell">
      <div className="panel"><span className="panel-num" style={{ fontSize: fs, color: c }}>{value}</span></div>
      {sub && <div className="panel-sub">{sub}</div>}
    </div>
  );
}

function FocusTimeCell({ minutes }: { minutes: number }) {
  const h = Math.min(Math.floor(minutes / 60), 99);
  const m = minutes % 60;
  const gray = "rgba(245,240,224,0.35)";
  return (
    <div className="sb-cell" style={{ padding: "4px 2px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 3, justifyContent: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <div className="panel" style={{ width: 36, height: 36, boxShadow: "inset 0 3px 6px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.04)" }}>
            <span className="panel-num" style={{ fontSize: 18, letterSpacing: "-0.02em", color: "#e8a820" }}>{String(h).padStart(2, "0")}</span>
          </div>
          <span className="panel-sub" style={{ fontSize: 7, letterSpacing: "0.14em" }}>HRS</span>
        </div>
        <span style={{ fontFamily: "'Oswald',Arial,sans-serif", fontSize: 18, fontWeight: 700, color: gray, lineHeight: "30px", userSelect: "none" }}>:</span>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <div className="panel" style={{ width: 36, height: 36, boxShadow: "inset 0 3px 6px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.04)" }}>
            <span className="panel-num" style={{ fontSize: 18, letterSpacing: "-0.02em", color: "#e8a820" }}>{String(m).padStart(2, "0")}</span>
          </div>
          <span className="panel-sub" style={{ fontSize: 7, letterSpacing: "0.14em" }}>MIN</span>
        </div>
      </div>
      <div className="panel-sub" style={{ marginTop: 2 }}>DEEP WORK</div>
    </div>
  );
}

const COLS = "2fr 1fr 1fr 1fr 1fr";
const DASH = "—";

export function TodosPage() {
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<TodoMode>(() => {
    const v = localStorage.getItem("todos_mode");
    return v === "today" || v === "upcoming" || v === "done" ? v : "today";
  });
  const [search, setSearch] = useState(() => localStorage.getItem("todos_search") ?? "");
  const [sortBy, setSortBy] = useState<"manual" | "due_date" | "importance" | "focus_score">(() => {
    const v = localStorage.getItem("todos_sort");
    return v === "manual" || v === "due_date" || v === "importance" || v === "focus_score" ? v : "manual";
  });
  const [priorityFilter, setPriorityFilter] = useState<"all" | Priority>(() => {
    const v = localStorage.getItem("todos_priority");
    return v === "all" || v === "critical" || v === "high" || v === "medium" || v === "low" ? v : "all";
  });
  const [hideNotStarted, setHideNotStarted] = useState(() => {
    const v = localStorage.getItem("todos_hide_not_started");
    return v == null ? true : v === "1";
  });
  const [categoryTab, setCategoryTab] = useState<string | null>(() => localStorage.getItem("todos_category_tab") || null);
  const [tagFilter, setTagFilter] = useState<{ id: string; name: string } | null>(() => {
    const id = localStorage.getItem("todos_tag_id");
    const name = localStorage.getItem("todos_tag_name");
    return id ? { id, name: name || "Selected Tag" } : null;
  });
  const [categoryFilter, setCategoryFilter] = useState<{ id: string; name: string } | null>(() => {
    const id = localStorage.getItem("todos_category_filter_id");
    const name = localStorage.getItem("todos_category_filter_name");
    return id ? { id, name: name || "Selected Category" } : null;
  });
  const [projectFilter, setProjectFilter] = useState<{ id: string; name: string } | null>(() => {
    const id = localStorage.getItem("todos_project_filter_id");
    const name = localStorage.getItem("todos_project_filter_name");
    return id ? { id, name: name || "Selected Project" } : null;
  });
  const { activeTimer } = useTimerStore();
  const { addTaskOpen, setAddTaskOpen } = useUIStore();
  const { pinnedTaskId, setPinnedTask } = usePinnedTaskStore();
  const qc = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  useEffect(() => {
    if (addTaskOpen) {
      setModalOpen(true);
      setAddTaskOpen(false);
    }
  }, [addTaskOpen, setAddTaskOpen]);
  useEffect(() => {
    const tagId = searchParams.get("tag");
    const tagName = searchParams.get("tagName");
    if (!tagId) return;
    setMode("upcoming");
    setSearch("");
    setTagFilter({ id: tagId, name: tagName || "Selected Tag" });
    setCategoryFilter(null);
    setProjectFilter(null);
    setCategoryTab(null);
  }, [searchParams]);
  useEffect(() => { localStorage.setItem("todos_mode", mode); }, [mode]);
  useEffect(() => { localStorage.setItem("todos_search", search); }, [search]);
  useEffect(() => { localStorage.setItem("todos_sort", sortBy); }, [sortBy]);
  useEffect(() => { localStorage.setItem("todos_priority", priorityFilter); }, [priorityFilter]);
  useEffect(() => { localStorage.setItem("todos_hide_not_started", hideNotStarted ? "1" : "0"); }, [hideNotStarted]);
  useEffect(() => {
    if (categoryTab) localStorage.setItem("todos_category_tab", categoryTab);
    else localStorage.removeItem("todos_category_tab");
  }, [categoryTab]);
  useEffect(() => {
    if (tagFilter) {
      localStorage.setItem("todos_tag_id", tagFilter.id);
      localStorage.setItem("todos_tag_name", tagFilter.name);
    } else {
      localStorage.removeItem("todos_tag_id");
      localStorage.removeItem("todos_tag_name");
    }
  }, [tagFilter]);
  useEffect(() => {
    if (categoryFilter) {
      localStorage.setItem("todos_category_filter_id", categoryFilter.id);
      localStorage.setItem("todos_category_filter_name", categoryFilter.name);
    } else {
      localStorage.removeItem("todos_category_filter_id");
      localStorage.removeItem("todos_category_filter_name");
    }
  }, [categoryFilter]);
  useEffect(() => {
    if (projectFilter) {
      localStorage.setItem("todos_project_filter_id", projectFilter.id);
      localStorage.setItem("todos_project_filter_name", projectFilter.name);
    } else {
      localStorage.removeItem("todos_project_filter_id");
      localStorage.removeItem("todos_project_filter_name");
    }
  }, [projectFilter]);

  const reorderMut = useMutation({
    mutationFn: (ids: string[]) => tasksApi.reorder(ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });

  const pinTask = (task: import("@/types").Task, allTasks: import("@/types").Task[]) => {
    setPinnedTask(task.id);
    // Persist: put pinned task at sort_order 0, shift others
    const others = allTasks.filter(t => t.id !== task.id && t.status !== "done");
    reorderMut.mutate([task.id, ...others.map(t => t.id)]);
  };

  const unpinTask = (allTasks: import("@/types").Task[]) => {
    setPinnedTask(null);
    // Restore natural order (by current sort_order)
    const sorted = [...allTasks].filter(t => t.status !== "done").sort((a, b) => a.sort_order - b.sort_order);
    reorderMut.mutate(sorted.map(t => t.id));
  };

  const { data: tasks, isLoading } = useQuery({
    queryKey: ["tasks", search],
    queryFn: () => {
      const p: any = {};
      if (search) p.search = search;
      return tasksApi.list(p);
    },
    refetchInterval: 30_000,
  });
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: categoriesApi.list,
    staleTime: 5 * 60_000,
  });

  const { data: dash } = useQuery({
    queryKey: ["dashboard"],
    queryFn: dashboardApi.get,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const { data: gamHistory } = useQuery({
    queryKey: ["gamification-history"],
    queryFn: () => gamificationApi.history(90),
    retry: false,
    staleTime: 5 * 60_000,
  });

  // ── Today stats ──────────────────────────────────────────────
  const gam = dash?.gamification;
  const tasksCompleted = gam?.tasks_completed ?? dash?.completed_tasks_today ?? 0;
  const tasksAttempted = gam?.tasks_attempted ?? dash?.total_tasks_today ?? 0;
  const focusMinutes   = gam?.total_focus_minutes ?? Math.round((dash?.time_tracked_seconds ?? 0) / 60);
  const critical       = gam?.home_runs ?? 0;
  const ba             = gam?.batting_average ?? 0;
  const completedTodayFocus = (tasks ?? [])
    .filter(t => t.status === "done" && !!t.completed_at)
    .reduce((sum, t) => sum + (t.focus_score ?? 0), 0);
  const focusScoreToday = dash?.focus_score_today ?? completedTodayFocus;

  // ── History stats ─────────────────────────────────────────────
  const all    = gamHistory ?? [];
  const last7  = all.slice(-7);
  const last30 = all.slice(-30);

  const wkAvgTasks   = last7.length  ? Math.round(histAvg(last7.map(h => h.tasks_completed)))  : null;
  const moAvgTasks   = last30.length ? Math.round(histAvg(last30.map(h => h.tasks_completed))) : null;
  const bestTasks    = all.length    ? histBest(all.map(h => h.tasks_completed))                : null;

  const wkFocusMin   = last7.length  ? Math.round(histAvg(last7.map(h => h.total_focus_minutes)))  : null;
  const moFocusMin   = last30.length ? Math.round(histAvg(last30.map(h => h.total_focus_minutes))) : null;
  const bestFocusMin = all.length    ? histBest(all.map(h => h.total_focus_minutes))                : null;

  const wkBA  = last7.length  ? battingAvgStr(histAvg(last7.map(h => h.batting_average)))  : null;
  const moBA  = last30.length ? battingAvgStr(histAvg(last30.map(h => h.batting_average))) : null;
  const bestBA = all.length   ? battingAvgStr(histBest(all.map(h => h.batting_average)))   : null;

  const todayISO = todayStr();
  const dateKey = (v?: string) => {
    if (!v) return undefined;
    const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    return toDateStr(v);
  };
  const parseStartMs = (v?: string) => {
    if (!v) return null;
    const ms = Date.parse(v);
    return Number.isNaN(ms) ? null : ms;
  };
  const filtered = (tasks ?? []).filter(t => {
    const statusPass = mode === "done" ? t.status === "done" : t.status !== "done" && t.status !== "cancelled";
    const scheduledRaw = (t as any).scheduled_start_at as string | undefined;
    const scheduledDay = dateKey(scheduledRaw);
    const scheduledToday = !!scheduledRaw && scheduledDay === todayISO;
    const dueDay = dateKey(t.due_date);
    const dueTodayOrOverdue = !!dueDay && dueDay <= todayISO;
    const modePass = mode === "today"
      ? (
          scheduledToday || dueTodayOrOverdue
        )
      : mode === "upcoming"
      ? (
          !scheduledToday && !dueTodayOrOverdue
        )
      : true;
    const priorityPass = priorityFilter === "all" || t.priority === priorityFilter;
    const categoryTabPass = !categoryTab || t.category_id === categoryTab;
    const tagPass = !tagFilter || (t.tag_ids ?? []).includes(tagFilter.id);
    const categoryPass = !categoryFilter || t.category_id === categoryFilter.id;
    const projectPass = !projectFilter || t.project_id === projectFilter.id;
    const startMs = parseStartMs(scheduledRaw);
    const startPass = !hideNotStarted || !scheduledRaw || (startMs !== null && startMs <= Date.now());
    return statusPass && modePass && priorityPass && categoryTabPass && tagPass && categoryPass && projectPass && startPass;
  });
  const activeTaskId = activeTimer?.task_id;

  // Clear pin if pinned task no longer exists in filtered list
  const pinnedExists = pinnedTaskId && filtered.some(t => t.id === pinnedTaskId);

  const visible = (() => {
    const base = [...filtered];

    // Sort body according to selected rule.
    if (sortBy === "due_date") {
      base.sort((a, b) => {
        const am = a.due_date ? new Date(a.due_date).getTime() : Number.MAX_SAFE_INTEGER;
        const bm = b.due_date ? new Date(b.due_date).getTime() : Number.MAX_SAFE_INTEGER;
        return am - bm;
      });
    } else if (sortBy === "importance") {
      base.sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
    } else if (sortBy === "focus_score") {
      base.sort((a, b) => (b.focus_score ?? 0) - (a.focus_score ?? 0));
    } else {
      base.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    }

    // Active timer/pin still float to top regardless of sort.
    if (activeTaskId) {
      base.sort((a, b) => (a.id === activeTaskId ? -1 : b.id === activeTaskId ? 1 : 0));
    } else if (pinnedExists) {
      base.sort((a, b) => (a.id === pinnedTaskId ? -1 : b.id === pinnedTaskId ? 1 : 0));
    }
    return base;
  })();

  return (
    <div>
      <div className="top-bar">
        <span style={{ fontSize: 18 }}>🇺🇸</span>
        <div className="top-title">Daily Todos</div>
        <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.15em", textTransform: "uppercase", color: "rgba(255,255,255,0.3)" }}>
          {visible.length} orders
        </span>
      </div>
      <div className="stripe" />

      {/* ── SCOREBOARD ──────────────────────────────────────────── */}
      <div>
        <div className="sb-header" style={{ gridTemplateColumns: COLS }}>
          <div className="sb-col-head left">STAT</div>
          <div className="sb-col-head">TODAY</div>
          <div className="sb-col-head">WK AVG</div>
          <div className="sb-col-head">MONTHLY</div>
          <div className="sb-col-head">BEST</div>
        </div>

        {/* Tasks Done */}
        <div className="sb-row highlight" style={{ gridTemplateColumns: COLS }}>
          <div className="sb-label">Tasks Done</div>
          <SbCell value={tasksCompleted} sub={`of ${tasksAttempted}`} color="gold" />
          <SbCell value={wkAvgTasks !== null ? wkAvgTasks : DASH} color="empty" />
          <SbCell value={moAvgTasks !== null ? moAvgTasks : DASH} color="empty" />
          <SbCell value={bestTasks !== null ? bestTasks : DASH} sub="best day" color="empty" />
        </div>

        {/* Focus Time */}
        <div className="sb-row" style={{ gridTemplateColumns: COLS }}>
          <div className="sb-label">Focus Time</div>
          <FocusTimeCell minutes={focusMinutes} />
          <SbCell value={fmtFocus(wkFocusMin)} color="empty" />
          <SbCell value={fmtFocus(moFocusMin)} color="empty" />
          <SbCell value={fmtFocus(bestFocusMin)} color="empty" />
        </div>

        {/* Critical Tasks */}
        <div className="sb-row" style={{ gridTemplateColumns: COLS }}>
          <div className="sb-label">Critical Tasks</div>
          <SbCell value={critical > 0 ? critical : DASH} sub="home runs" color="red" />
          <SbCell value={DASH} color="empty" />
          <SbCell value={DASH} color="empty" />
          <SbCell value={DASH} color="empty" />
        </div>

        {/* Batting Average */}
        <div className="sb-row" style={{ gridTemplateColumns: COLS }}>
          <div className="sb-label">Batting Average</div>
          <SbCell value={battingAvgStr(ba)} sub={`${gam?.hits ?? tasksCompleted}H · ${tasksAttempted}AB`} color="gold" />
          <SbCell value={wkBA ?? DASH} color="empty" />
          <SbCell value={moBA ?? DASH} color="empty" />
          <SbCell value={bestBA ?? DASH} color="empty" />
        </div>

        {/* Focus Score */}
        <div className="sb-row" style={{ gridTemplateColumns: COLS }}>
          <div className="sb-label">Focus Score</div>
          <SbCell value={Math.round(focusScoreToday)} sub="today" color="white" />
          <SbCell value={DASH} color="empty" />
          <SbCell value={DASH} color="empty" />
          <SbCell value={DASH} sub="best day" color="empty" />
        </div>
      </div>
      {/* ── END SCOREBOARD ──────────────────────────────────────── */}

      {/* Filter bar */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", padding: "8px 12px", background: "#1e3629", borderBottom: "2px solid #162a1c" }}>
        <button onClick={() => setMode("today")} style={{ padding: "4px 10px", border: `1px solid ${mode === "today" ? "rgba(232,168,32,0.5)" : "rgba(232,168,32,0.15)"}`, background: mode === "today" ? "rgba(232,168,32,0.1)" : "transparent", color: mode === "today" ? "#e8a820" : "rgba(245,240,224,0.3)", fontFamily: "'Oswald',Arial,sans-serif", fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer", borderRadius: 2 }}>{new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}</button>
        <button onClick={() => setMode("upcoming")} style={{ padding: "4px 10px", border: `1px solid ${mode === "upcoming" ? "rgba(232,168,32,0.5)" : "rgba(232,168,32,0.15)"}`, background: mode === "upcoming" ? "rgba(232,168,32,0.1)" : "transparent", color: mode === "upcoming" ? "#e8a820" : "rgba(245,240,224,0.3)", fontFamily: "'Oswald',Arial,sans-serif", fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer", borderRadius: 2 }}>Upcoming & Undated</button>
        <select
          value={priorityFilter}
          onChange={e => setPriorityFilter(e.target.value as "all" | Priority)}
          style={{ padding: "4px 8px", fontSize: 10, fontFamily: "'Oswald',Arial,sans-serif", letterSpacing: "0.08em", textTransform: "uppercase", background: "transparent", color: "#e8a820", border: "1px solid rgba(232,168,32,0.35)", borderRadius: 2 }}
          title="Filter by priority"
        >
          <option value="all">Priority: All</option>
          <option value="critical">Priority: Critical</option>
          <option value="high">Priority: High</option>
          <option value="medium">Priority: Medium</option>
          <option value="low">Priority: Low</option>
        </select>
        <button onClick={() => setMode("done")} style={{ padding: "4px 10px", border: `1px solid ${mode === "done" ? "rgba(232,168,32,0.5)" : "rgba(232,168,32,0.15)"}`, background: mode === "done" ? "rgba(232,168,32,0.1)" : "transparent", color: mode === "done" ? "#e8a820" : "rgba(245,240,224,0.3)", fontFamily: "'Oswald',Arial,sans-serif", fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer", borderRadius: 2 }}>Done</button>
        {categories.map((c: any) => (
          <button key={c.id} onClick={() => setCategoryTab(categoryTab === c.id ? null : c.id)} style={{ padding: "4px 10px", border: `1px solid ${categoryTab === c.id ? "rgba(232,168,32,0.5)" : "rgba(232,168,32,0.12)"}`, background: categoryTab === c.id ? "rgba(232,168,32,0.1)" : "transparent", color: categoryTab === c.id ? "#e8a820" : "rgba(245,240,224,0.25)", fontFamily: "'Oswald',Arial,sans-serif", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", borderRadius: 2 }}>{c.name}</button>
        ))}
        <label style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8, color: "rgba(245,240,224,0.6)", fontSize: 10, fontFamily: "'Oswald',Arial,sans-serif", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          <input type="checkbox" checked={hideNotStarted} onChange={e => setHideNotStarted(e.target.checked)} />
          Hide not started
        </label>
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as typeof sortBy)}
          style={{
            marginLeft: 8,
            padding: "4px 8px",
            fontSize: 10,
            fontFamily: "'Oswald',Arial,sans-serif",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            background: "transparent",
            color: "#e8a820",
            border: "1px solid rgba(232,168,32,0.35)",
            borderRadius: 2,
          }}
          title="Sort tasks"
        >
          <option value="manual">Sort: Manual</option>
          <option value="due_date">Sort: Due Date</option>
          <option value="importance">Sort: Importance</option>
          <option value="focus_score">Sort: Focus Score</option>
        </select>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" style={{ marginLeft: "auto", padding: "4px 10px", fontSize: 11, width: 130 }} />
        {(tagFilter || categoryFilter || projectFilter || categoryTab) && (
          <button
            onClick={() => { setTagFilter(null); setCategoryFilter(null); setProjectFilter(null); setCategoryTab(null); }}
            style={{ padding: "4px 10px", border: "1px solid rgba(217,64,64,0.45)", background: "transparent", color: "#d94040", fontFamily: "'Oswald',Arial,sans-serif", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer", borderRadius: 2 }}
          >
            Clear Context
          </button>
        )}
      </div>
      {(tagFilter || categoryFilter || projectFilter) && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", padding: "6px 12px", background: "#1a2e22", borderBottom: "1px solid rgba(0,0,0,0.35)" }}>
          {tagFilter && <span style={{ fontSize: 10, color: "#e8a820", letterSpacing: "0.08em", textTransform: "uppercase" }}>Tag: {tagFilter.name}</span>}
          {categoryFilter && <span style={{ fontSize: 10, color: "#e8a820", letterSpacing: "0.08em", textTransform: "uppercase" }}>Category: {categoryFilter.name}</span>}
          {projectFilter && <span style={{ fontSize: 10, color: "#e8a820", letterSpacing: "0.08em", textTransform: "uppercase" }}>Project: {projectFilter.name}</span>}
        </div>
      )}

      <QuickAdd defaultStatus={mode === "done" ? "today" : "today" as TaskStatus} />
      <TaskModal open={modalOpen} onClose={() => setModalOpen(false)} defaultStatus="today" />

      {isLoading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
          <Loader2 size={20} style={{ color: "#e8a820", animation: "spin 1s linear infinite" }} />
        </div>
      ) : visible.length === 0 ? (
        <div style={{ padding: "48px 16px", textAlign: "center" }}>
          <p style={{ fontFamily: "'Oswald',Arial,sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: "0.15em", textTransform: "uppercase", color: "rgba(245,240,224,0.2)" }}>No Tasks In This Category</p>
          <p style={{ fontFamily: "'IM Fell English',Georgia,serif", fontStyle: "italic", fontSize: 10, marginTop: 6, color: "rgba(245,240,224,0.1)" }}>Post a new order above to begin</p>
        </div>
      ) : visible.map(t => (
        <TaskCard
          key={t.id}
          task={t}
          isPinned={t.id === pinnedTaskId && !activeTaskId}
          onPin={() => pinTask(t, filtered)}
          onUnpin={() => unpinTask(filtered)}
          onTagClick={(id, name) => {
            setMode("upcoming");
            setSearch("");
            setTagFilter({ id, name });
            setCategoryFilter(null);
            setProjectFilter(null);
          }}
          onCategoryClick={(id, name) => {
            setMode("upcoming");
            setSearch("");
            setCategoryFilter({ id, name });
            setTagFilter(null);
            setProjectFilter(null);
          }}
          onProjectClick={(id, name) => {
            setMode("upcoming");
            setSearch("");
            setProjectFilter({ id, name });
            setTagFilter(null);
            setCategoryFilter(null);
          }}
        />
      ))}
    </div>
  );
}
