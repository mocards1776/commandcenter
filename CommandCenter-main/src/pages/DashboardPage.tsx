import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { dashboardApi, gamificationApi } from "@/lib/api";
import { GameScoreboard } from "@/components/dashboard/GameScoreboard";
import { NextUpPanel } from "@/components/dashboard/NextUpPanel";
import { BaseballPanel } from "@/components/dashboard/BaseballPanel";
import { HabitRow } from "@/components/habits/HabitRow";
import { useTimerStore } from "@/store";
import { Loader2 } from "lucide-react";
import { todayStr } from "@/lib/utils";

function useLiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// Normalize a raw entry from today_habits into a safe Habit-like object.
// The dashboard endpoint may return:
//   { habit: { ...habitFields }, completed: bool }  — wrapped
//   { id, name, completions: [...], ... }           — flat habit
//   { id, name, ... }                               — flat habit WITHOUT completions
// We always want a flat habit with completions guaranteed to be an array.
function normalizeHabit(entry: any): any | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;

  // Unwrap { habit: {...}, completed: bool } shape
  const raw = entry.habit && typeof entry.habit === "object" ? entry.habit : entry;

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (!raw.id) return null; // must have at least an id

  // Guarantee completions is always an array
  return { ...raw, completions: Array.isArray(raw.completions) ? raw.completions : [] };
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { activeTimer } = useTimerStore();
  const today = todayStr();
  const now = useLiveClock();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "MORNING" : hour < 17 ? "AFTERNOON" : "EVENING";

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
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300 }}>
      <Loader2 size={28} style={{ color: "#e8a820", animation: "spin 1s linear infinite" }} />
    </div>
  );

  const overdueCount = data?.overdue_tasks?.length ?? 0;
  const completed = data?.completed_tasks_today ?? 0;
  const attempted = data?.total_tasks_today ?? 0;
  const focusMinutes = data ? Math.round((data.time_tracked_seconds ?? 0) / 60) : 0;

  const scoreboardStats = data?.gamification ?? {
    stat_date: today,
    tasks_completed: completed,
    tasks_attempted: attempted,
    habits_completed: 0,
    total_focus_minutes: focusMinutes,
    home_runs: 0,
    hits: completed,
    strikeouts: overdueCount,
    batting_average: attempted > 0 ? completed / attempted : 0,
    hitting_streak: 0,
  };

  const overdueT = data?.overdue_tasks ?? [];

  // Normalize every today_habits entry so completions is always an array
  const rawHabits: any[] = data?.today_habits ?? [];
  const habits = rawHabits.map(normalizeHabit).filter(Boolean);

  const projects = data?.active_projects ?? [];

  const allPending = [...(data?.today_tasks ?? []), ...overdueT];

  // Live clock strings in CDT
  const timeStr = now.toLocaleTimeString("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  const dateStr = now.toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).toUpperCase();

  return (
    <div>
      {/* TOP BAR */}
      <div className="top-bar" style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", padding: "8px 24px", position: "relative", gap: 14 }}>
        <span style={{ color: "#e8a820", fontSize: 9, letterSpacing: 5, opacity: 0.6 }}>&#9733; &#9733; &#9733;</span>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, lineHeight: 1 }}>
          <span style={{ fontFamily: "'Inter',sans-serif", fontSize: 14, fontWeight: 900, letterSpacing: "0.15em", color: "rgba(255,255,255,0.75)", textTransform: "uppercase" }}>JOSH'S</span>
          <span style={{ fontFamily: "'Inter',sans-serif", fontSize: 24, fontWeight: 900, letterSpacing: "-0.03em", color: "#ffffff", textTransform: "uppercase" }}>COMMAND CENTER</span>
          <span style={{ fontSize: 14 }}>&#x1F1FA;&#x1F1F8;</span>
        </div>
        <span style={{ color: "#e8a820", fontSize: 9, letterSpacing: 5, opacity: 0.6 }}>&#9733; &#9733; &#9733;</span>

        {/* Date + Time */}
        <div style={{ position: "absolute", right: 24, top: "50%", transform: "translateY(-50%)", textAlign: "right" }}>
          <div style={{
            fontFamily: "'Oswald', Arial, sans-serif",
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: "0.06em",
            color: "#f4c842",
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
          }}>{timeStr}</div>
          <div style={{
            fontSize: 8,
            fontWeight: 600,
            letterSpacing: "0.14em",
            color: "rgba(255,255,255,0.3)",
            marginTop: 3,
          }}>{dateStr}</div>
        </div>
      </div>

      <div className="stripe" />

      {/* MAIN GRID */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderBottom: "3px solid #1e3629" }}>
        <div style={{ borderRight: "3px solid #1e3629" }}>
          <GameScoreboard stats={scoreboardStats} history={gamHistory} />
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <NextUpPanel tasks={allPending} />
        </div>
      </div>

      <div className="stripe-thin" />
      <div className="stripe-3" />

      {/* BOTTOM ROW */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr" }}>

        {/* Habits */}
        <div style={{ borderRight: "3px solid #1e3629" }}>
          <div className="bottom-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Today's Habits</span>
            <button className="panel-header-link" onClick={() => navigate("/habits")} style={{ fontSize: 9 }}>Manage &#8594;</button>
          </div>
          {habits.length === 0 ? (
            <p style={{ padding: "12px 14px", fontFamily: "'IM Fell English',Georgia,serif", fontStyle: "italic", fontSize: 11, color: "rgba(245,240,224,0.2)" }}>No habits configured</p>
          ) : habits.slice(0, 6).map((h: any) => <HabitRow key={h.id} habit={h} todayStr={today} />)}
        </div>

        {/* Projects */}
        <div style={{ borderRight: "3px solid #1e3629" }}>
          <div className="bottom-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Active Projects</span>
            <button className="panel-header-link" onClick={() => navigate("/projects")} style={{ fontSize: 9 }}>All &#8594;</button>
          </div>
          {projects.length === 0 ? (
            <p style={{ padding: "12px 14px", fontFamily: "'IM Fell English',Georgia,serif", fontStyle: "italic", fontSize: 11, color: "rgba(245,240,224,0.2)" }}>No active projects</p>
          ) : projects.map((p: any) => (
            <div key={p.id} className="proj-row" onClick={() => navigate("/projects")}>
              <div className="proj-name-line">
                <span className="proj-name">{p.title}</span>
                <span className="proj-pct">{p.completion_percentage ?? 0}%</span>
              </div>
              <div className="proj-track"><div className="proj-fill" style={{ width: `${p.completion_percentage ?? 0}%` }} /></div>
              <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(245,240,224,0.25)", marginTop: 3 }}>{p.task_count ?? 0} tasks</div>
            </div>
          ))}
        </div>

        {/* Completion panel */}
        <div>
          <div className="bottom-label">Completion &#183; Today</div>
          <div style={{ padding: "8px 14px" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 8, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.3)", marginBottom: 4 }}>Tasks</div>
                <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
                  <div className="panel panel-sm"><span className="panel-num gold" style={{ fontSize: 20 }}>{data?.completed_tasks_today ?? 0}</span></div>
                  <div style={{ fontSize: 18, color: "rgba(255,255,255,0.2)", lineHeight: "36px" }}>/</div>
                  <div className="panel panel-sm"><span className="panel-num empty" style={{ fontSize: 20 }}>{data?.total_tasks_today ?? 0}</span></div>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 8, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.3)", marginBottom: 4 }}>Habits</div>
                <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
                  <div className="panel panel-sm"><span className="panel-num gold" style={{ fontSize: 20 }}>{habits.filter((h: any) => (h.completions ?? []).some((c: any) => c.completed_date === today)).length}</span></div>
                  <div style={{ fontSize: 18, color: "rgba(255,255,255,0.2)", lineHeight: "36px" }}>/</div>
                  <div className="panel panel-sm"><span className="panel-num empty" style={{ fontSize: 20 }}>{habits.length}</span></div>
                </div>
              </div>
            </div>
            {overdueT.length > 0 && (
              <div>
                <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.2)", marginBottom: 4 }}>Overdue</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div className="panel panel-sm"><span className="panel-num red" style={{ fontSize: 20 }}>{overdueT.length}</span></div>
                  <span style={{ fontFamily: "'Oswald',Arial,sans-serif", fontSize: 10, color: "rgba(255,255,255,0.3)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Need attention</span>
                </div>
              </div>
            )}
            {overdueT.length === 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div className="panel panel-sm"><span className="panel-num gold" style={{ fontSize: 20 }}>&#10003;</span></div>
                <span style={{ fontFamily: "'Oswald',Arial,sans-serif", fontSize: 10, color: "rgba(255,255,255,0.3)", letterSpacing: "0.1em", textTransform: "uppercase" }}>All clear</span>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Footer quote */}
      <div className="stripe-thin" />
      <div style={{ padding: "5px 16px", background: "#1e3629" }}>
        <p style={{ fontFamily: "'IM Fell English',Georgia,serif", fontStyle: "italic", fontSize: 9, color: "rgba(232,168,32,0.25)", textAlign: "center" }}>
          &ldquo;It is not in the still calm of life that great characters are formed.&rdquo; &#8212; Abigail Adams
        </p>
      </div>

      {/* Baseball scoreboard panel */}
      <BaseballPanel />

    </div>
  );
}
