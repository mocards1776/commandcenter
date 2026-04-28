import { battingAvgStr } from "@/lib/utils";
import type { GamificationStats } from "@/types";
interface Props { stats?: GamificationStats; }
function Cell({ value, sub, color="white" }: { value:string|number; sub?:string; color?:"gold"|"red"|"white"|"empty" }) {
  const c = color==="gold"?"#e8a820":color==="red"?"#d94040":color==="empty"?"rgba(255,255,255,0.12)":"#fff";
  const fs = String(value).length>5?13:String(value).length>3?18:26;
  return (
    <div className="sb-cell">
      <div className="panel"><span className="panel-num" style={{fontSize:fs,color:c}}>{value}</span></div>
      {sub&&<div className="panel-sub">{sub}</div>}
    </div>
  );
}
export function GameScoreboard({ stats }: Props) {
  const ba=stats?.batting_average??0, hrs=stats?.home_runs??0;
  const streak=stats?.hitting_streak??0, focus=stats?.total_focus_minutes??0;
  const h=Math.floor(focus/60),m=focus%60;
  const focusStr=h>0?`${h}h${m>0?` ${m}m`:""}`:m>0?`${m}m`:"0m";
  const tasksC=stats?.tasks_completed??0, tasksA=stats?.tasks_attempted??0;
  return (
    <div>
      <div className="sb-header" style={{gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr"}}>
        <div className="sb-col-head left">Stat</div>
        <div className="sb-col-head">Today</div>
        <div className="sb-col-head">Hits</div>
        <div className="sb-col-head">Outs</div>
        <div className="sb-col-head">Streak</div>
      </div>
      <div className="sb-row highlight" style={{gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr"}}>
        <div className="sb-label">Batting avg</div>
        <Cell value={battingAvgStr(ba)} sub={`${stats?.hits??0}H · ${tasksA}AB`} color="gold"/>
        <Cell value={stats?.hits??0} color="empty"/>
        <Cell value={stats?.strikeouts??0} color="empty"/>
        <Cell value={streak>0?`${streak}🔥`:0} color="empty"/>
      </div>
      <div className="sb-row" style={{gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr"}}>
        <div className="sb-label">Home runs</div>
        <Cell value={hrs} sub="Critical" color="red"/>
        <Cell value="—" color="empty"/>
        <Cell value="—" color="empty"/>
        <Cell value="—" color="empty"/>
      </div>
      <div className="sb-row" style={{gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr"}}>
        <div className="sb-label">Focus time</div>
        <Cell value={focusStr} sub="deep work" color="white"/>
        <Cell value="—" color="empty"/>
        <Cell value="—" color="empty"/>
        <Cell value="—" color="empty"/>
      </div>
      <div className="sb-row" style={{gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr"}}>
        <div className="sb-label">Tasks done</div>
        <Cell value={tasksC} sub={`of ${tasksA}`} color="gold"/>
        <Cell value="—" color="empty"/>
        <Cell value="—" color="empty"/>
        <Cell value="—" color="empty"/>
      </div>
    </div>
  );
}
