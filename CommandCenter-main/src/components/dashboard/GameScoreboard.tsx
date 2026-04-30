import { battingAvgStr } from "@/lib/utils";
import type { GamificationStats } from "@/types";

interface Props {
  stats?: GamificationStats;
  history?: GamificationStats[];
}

function avg(arr: number[]): number {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}
function best(arr: number[]): number {
  return arr.length ? Math.max(...arr) : 0;
}

function Cell({ value, sub, color = "white" }: { value: string | number; sub?: string; color?: "gold" | "red" | "white" | "empty" }) {
  const c = color === "gold" ? "#e8a820" : color === "red" ? "#d94040" : color === "empty" ? "rgba(255,255,255,0.12)" : "#fff";
  const fs = String(value).length > 5 ? 13 : String(value).length > 3 ? 18 : 26;
  return (
    <div className="sb-cell">
      <div className="panel"><span className="panel-num" style={{ fontSize: fs, color: c }}>{value}</span></div>
      {sub && <div className="panel-sub">{sub}</div>}
    </div>
  );
}

// Split HH : MM flip-panel cell for Focus Time
function FocusTimeCell({ minutes }: { minutes: number }) {
  const h = Math.min(Math.floor(minutes / 60), 99);
  const m = minutes % 60;
  const grayLabel = "rgba(245,240,224,0.35)";

  return (
    <div className="sb-cell" style={{ padding: "4px 2px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 3, justifyContent: "center" }}>
        {/* Hours */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <div className="panel"
            style={{ width: 36, height: 36, boxShadow: "inset 0 3px 6px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.04)" }}>
            <span className="panel-num" style={{ fontSize: 18, letterSpacing: "-0.02em", color: "#e8a820" }}>
              {String(h).padStart(2, "0")}
            </span>
          </div>
          <span className="panel-sub" style={{ fontSize: 7, letterSpacing: "0.14em" }}>HRS</span>
        </div>
        {/* Colon */}
        <span style={{
          fontFamily: "'Oswald',Arial,sans-serif", fontSize: 18, fontWeight: 700,
          color: grayLabel, lineHeight: "30px", userSelect: "none",
        }}>:</span>
        {/* Minutes */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <div className="panel"
            style={{ width: 36, height: 36, boxShadow: "inset 0 3px 6px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.04)" }}>
            <span className="panel-num" style={{ fontSize: 18, letterSpacing: "-0.02em", color: "#e8a820" }}>
              {String(m).padStart(2, "0")}
            </span>
          </div>
          <span className="panel-sub" style={{ fontSize: 7, letterSpacing: "0.14em" }}>MIN</span>
        </div>
      </div>
      <div className="panel-sub" style={{ marginTop: 2 }}>DEEP WORK</div>
    </div>
  );
}

export function GameScoreboard({ stats, history }: Props) {
  const ba = stats?.batting_average ?? 0;
  const hrs = stats?.home_runs ?? 0;
  const streak = stats?.hitting_streak ?? 0;
  const focus = stats?.total_focus_minutes ?? 0;
  const tasksC = stats?.tasks_completed ?? 0;
  const tasksA = stats?.tasks_attempted ?? 0;

  // Compute weekly average (last 7 days) and all-time best from history.
  const last7 = history && history.length ? history.slice(-7) : [];
  const all   = history && history.length ? history : [];

  // Batting avg
  const wkBA   = last7.length ? battingAvgStr(avg(last7.map(h => h.batting_average))) : null;
  const bestBA = all.length   ? battingAvgStr(best(all.map(h => h.batting_average)))  : null;

  // Home runs
  const wkHR   = last7.length ? Math.round(avg(last7.map(h => h.home_runs))) : null;
  const bestHR = all.length   ? best(all.map(h => h.home_runs))               : null;

  // Focus minutes
  const wkFocusMin = last7.length ? Math.round(avg(last7.map(h => h.total_focus_minutes))) : null;
  const bestFocusMin = all.length ? best(all.map(h => h.total_focus_minutes))               : null;
  const fmtFocus = (min: number | null) => {
    if (min === null) return "\u2014";
    const fh = Math.floor(min / 60), fm = min % 60;
    return fh > 0 ? `${fh}h${fm > 0 ? `${fm}m` : ""}` : fm > 0 ? `${fm}m` : "0m";
  };

  // Tasks
  const wkTasks   = last7.length ? Math.round(avg(last7.map(h => h.tasks_completed))) : null;
  const bestTasks = all.length   ? best(all.map(h => h.tasks_completed))               : null;

  const DASH = "\u2014";

  return (
    <div>
      <div className="sb-header" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr" }}>
        <div className="sb-col-head left">STAT</div>
        <div className="sb-col-head">TODAY</div>
        <div className="sb-col-head">WK AVG</div>
        <div className="sb-col-head">BEST</div>
        <div className="sb-col-head">STREAK</div>
      </div>

      {/* Batting Average */}
      <div className="sb-row highlight" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr" }}>
        <div className="sb-label">Batting Avg</div>
        <Cell value={battingAvgStr(ba)} sub={`${stats?.hits ?? 0}H \u00B7 ${tasksA}AB`} color="gold" />
        <Cell value={wkBA ?? DASH} color="empty" />
        <Cell value={bestBA ?? DASH} color="empty" />
        <Cell value={streak > 0 ? streak : DASH} color="empty" />
      </div>

      {/* Home Runs */}
      <div className="sb-row" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr" }}>
        <div className="sb-label">Home Runs</div>
        <Cell value={hrs} sub="Critical" color="red" />
        <Cell value={wkHR !== null ? wkHR : DASH} color="empty" />
        <Cell value={bestHR !== null ? bestHR : DASH} color="empty" />
        <Cell value={DASH} color="empty" />
      </div>

      {/* Hit Streak */}
      <div className="sb-row" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr" }}>
        <div className="sb-label">Hit Streak</div>
        <Cell value={streak > 0 ? `${streak}` : "0"} sub={streak > 0 ? "days \uD83D\uDD25" : "days"} color="white" />
        <Cell value={DASH} color="empty" />
        <Cell value={DASH} color="empty" />
        <Cell value={DASH} color="empty" />
      </div>

      {/* Focus Time — TODAY uses split HH:MM flip panels */}
      <div className="sb-row" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr" }}>
        <div className="sb-label">Focus Time</div>
        <FocusTimeCell minutes={focus} />
        <Cell value={fmtFocus(wkFocusMin)} color="empty" />
        <Cell value={fmtFocus(bestFocusMin)} color="empty" />
        <Cell value={DASH} color="empty" />
      </div>

      {/* Tasks Done */}
      <div className="sb-row" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr" }}>
        <div className="sb-label">Tasks Done</div>
        <Cell value={tasksC} sub={`of ${tasksA}`} color="gold" />
        <Cell value={wkTasks !== null ? wkTasks : DASH} color="empty" />
        <Cell value={bestTasks !== null ? bestTasks : DASH} color="empty" />
        <Cell value={DASH} color="empty" />
      </div>
    </div>
  );
}
