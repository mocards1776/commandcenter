import { useQuery } from "@tanstack/react-query";
import { dashboardApi, gamificationApi } from "@/lib/api";
import { GameScoreboard } from "@/components/dashboard/GameScoreboard";
import { NextUpPanel } from "@/components/dashboard/NextUpPanel";
import { HabitRow } from "@/components/habits/HabitRow";
import { QuickAdd } from "@/components/todos/QuickAdd";
import { TaskCard } from "@/components/todos/TaskCard";
import { useUIStore, useTimerStore } from "@/store";
import { Loader2 } from "lucide-react";
import { todayStr } from "@/lib/utils";

export function DashboardPage() {
  const { setActivePage } = useUIStore();
  const { activeTimer }   = useTimerStore();
  const today = todayStr();
  const hour  = new Date().getHours();

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: dashboardApi.get,
    refetchInterval: 60_000,
  });

  const { data: gamHistory } = useQuery({
    queryKey: ["gamification-history"],
    queryFn: () => gamificationApi.history(30),
    retry: false,
    staleTime: 5 * 60_000,
  });

  if (isLoading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:300 }}>
      <Loader2 size={28} style={{ color:"#e8a820", animation:"spin 1s linear infinite" }} />
    </div>
  );

  const pct          = data ? Math.round((data.completed_tasks_today / Math.max(data.total_tasks_today,1)) * 100) : 0;
  const overdueCount = data?.overdue_tasks?.length ?? 0;
  const completed    = data?.completed_tasks_today ?? 0;
  const attempted    = data?.total_tasks_today ?? 0;
  const focusMinutes = data ? Math.round((data.time_tracked_seconds ?? 0) / 60) : 0;

  const scoreboardStats = data?.gamification ?? {
    stat_date:           today,
    tasks_completed:     completed,
    tasks_attempted:     attempted,
    habits_completed:    0,
    total_focus_minutes: focusMinutes,
    home_runs: 0, hits: completed, strikeouts: overdueCount,
    batting_average: attempted > 0 ? completed / attempted : 0,
    hitting_streak:  0,
  };

  const tasksTodayRaw = data?.today_tasks ?? [];
  const overdueT      = data?.overdue_tasks ?? [];
  const habits        = data?.today_habits ?? [];
  const projects      = data?.active_projects ?? [];

  // All non-done tasks (today + overdue) for NextUpPanel prioritisation
  const allPending = [...tasksTodayRaw, ...overdueT];

  return (
    <div>
      {/* TOP BAR */}
      <div className="top-bar" style={{ flexDirection:"row", alignItems:"center",
        justifyContent:"center", padding:"8px 24px", position:"relative", gap:14 }}>
        <span style={{ color:"#e8a820", fontSize:9, letterSpacing:5, opacity:0.6 }}>&#9733; &#9733; &#9733;</span>
        <div style={{ display:"flex", alignItems:"baseline", gap:8, lineHeight:1 }}>
          <span style={{ fontFamily:"'Inter',sans-serif", fontSize:14, fontWeight:900,
            letterSpacing:"0.15em", color:"rgba(255,255,255,0.75)", textTransform:"uppercase" }}>JOSH'S</span>
          <span style={{ fontFamily:"'Inter',sans-serif", fontSize:24, fontWeight:900,
            letterSpacing:"-0.03em", color:"#ffffff", textTransform:"uppercase" }}>COMMAND CENTER</span>
          <span style={{ fontSize:14 }}>&#x1F1FA;&#x1F1F8;</span>
        </div>
        <span style={{ color:"#e8a820", fontSize:9, letterSpacing:5, opacity:0.6 }}>&#9733; &#9733; &#9733;</span>
        <div style={{ position:"absolute", right:24, top:"50%", transform:"translateY(-50%)", textAlign:"right" }}>
          <div style={{ fontSize:8, fontWeight:600, letterSpacing:"0.15em", textTransform:"uppercase",
            color:"rgba(255,255,255,0.35)", marginBottom:2 }}>Today's completion</div>
          <div style={{ display:"flex", alignItems:"center", gap:6, justifyContent:"flex-end" }}>
            <div className="panel" style={{ width:50, height:32 }}>
              <span className="panel-num" style={{ fontSize:18,
                color: pct>=80 ? "#e8a820" : pct>=50 ? "#fff" : "#d94040" }}>{pct}%</span>
            </div>
          </div>
          <div style={{ fontSize:8, fontWeight:600, letterSpacing:"0.12em",
            textTransform:"uppercase", color:"rgba(255,255,255,0.25)", marginTop:2 }}>
            {completed} of {attempted} tasks
          </div>
        </div>
      </div>

      <div className="stripe" />

      {/* MAIN GRID: Scoreboard LEFT · NextUpPanel RIGHT — same 1fr 1fr as before */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", borderBottom:"3px solid #1e3629" }}>

        {/* LEFT: Game Scoreboard */}
        <div style={{ borderRight:"3px solid #1e3629" }}>
          <GameScoreboard stats={scoreboardStats} history={gamHistory} />
        </div>

        {/* RIGHT: Next Up (replaces Today's Tasks in this box) */}
        <div style={{ display:"flex", flexDirection:"column" }}>
          <NextUpPanel tasks={allPending} />
        </div>

      </div>

      <div className="stripe-thin" />
      <div className="stripe-3" />

      {/* BOTTOM ROW: Habits · Projects · Quick-add + task list */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr" }}>

        {/* Habits */}
        <div style={{ borderRight:"3px solid #1e3629" }}>
          <div className="bottom-label" style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span>Today's Habits</span>
            <button className="panel-header-link" onClick={() => setActivePage("habits")} style={{ fontSize:9 }}>Manage &#8594;</button>
          </div>
          {habits.length === 0
            ? <p style={{ padding:"12px 14px", fontFamily:"'IM Fell English',Georgia,serif",
                fontStyle:"italic", fontSize:11, color:"rgba(245,240,224,0.2)" }}>No habits configured</p>
            : habits.slice(0,6).map(h => <HabitRow key={h.id} habit={h} todayStr={today} />)}
        </div>

        {/* Projects */}
        <div style={{ borderRight:"3px solid #1e3629" }}>
          <div className="bottom-label" style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span>Active Projects</span>
            <button className="panel-header-link" onClick={() => setActivePage("projects")} style={{ fontSize:9 }}>All &#8594;</button>
          </div>
          {projects.length === 0
            ? <p style={{ padding:"12px 14px", fontFamily:"'IM Fell English',Georgia,serif",
                fontStyle:"italic", fontSize:11, color:"rgba(245,240,224,0.2)" }}>No active projects</p>
            : projects.map(p => (
              <div key={p.id} className="proj-row" onClick={() => setActivePage("projects")}>
                <div className="proj-name-line">
                  <span className="proj-name">{p.title}</span>
                  <span className="proj-pct">{p.completion_percentage}%</span>
                </div>
                <div className="proj-track"><div className="proj-fill" style={{ width:`${p.completion_percentage}%` }} /></div>
                <div style={{ fontSize:9, fontWeight:600, letterSpacing:"0.1em",
                  textTransform:"uppercase", color:"rgba(245,240,224,0.25)", marginTop:3 }}>{p.task_count} tasks</div>
              </div>
            ))}
        </div>

        {/* Quick-add + today tasks */}
        <div style={{ display:"flex", flexDirection:"column" }}>
          <div className="bottom-label" style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span>Today's Tasks</span>
            <button className="panel-header-link" onClick={() => setActivePage("todos")} style={{ fontSize:9 }}>View All &#8594;</button>
          </div>
          <QuickAdd defaultStatus="today" />
          <div style={{ flex:1, overflowY:"auto", maxHeight:180 }}>
            {tasksTodayRaw.length === 0
              ? <p style={{ padding:"12px 14px", fontFamily:"'IM Fell English',Georgia,serif",
                  fontStyle:"italic", fontSize:11, color:"rgba(245,240,224,0.2)" }}>All clear</p>
              : tasksTodayRaw.slice(0,5).map(t => <TaskCard key={t.id} task={t} />)}
          </div>
        </div>

      </div>

      {/* Footer */}
      <div className="stripe-thin" />
      <div style={{ padding:"5px 16px", background:"#1e3629" }}>
        <p style={{ fontFamily:"'IM Fell English',Georgia,serif", fontStyle:"italic",
          fontSize:9, color:"rgba(232,168,32,0.25)", textAlign:"center" }}>
          &ldquo;It is not in the still calm of life that great characters are formed.&rdquo; &mdash; Abigail Adams
        </p>
      </div>
    </div>
  );
}
