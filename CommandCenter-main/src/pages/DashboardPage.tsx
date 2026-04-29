import { useQuery } from "@tanstack/react-query";
import { dashboardApi } from "@/lib/api";
import { GameScoreboard } from "@/components/dashboard/GameScoreboard";
import { TaskCard } from "@/components/todos/TaskCard";
import { HabitRow } from "@/components/habits/HabitRow";
import { QuickAdd } from "@/components/todos/QuickAdd";
import { useUIStore } from "@/store";
import { Loader2 } from "lucide-react";
import { todayStr, battingAvgStr } from "@/lib/utils";

export function DashboardPage() {
  const { setActivePage } = useUIStore();
  const today = todayStr();
  const hour = new Date().getHours();
  const greeting = hour<12?"MORNING":hour<17?"AFTERNOON":"EVENING";
  const { data, isLoading } = useQuery({ queryKey:["dashboard"], queryFn:dashboardApi.get, refetchInterval:60_000 });

  if (isLoading) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:300}}>
      <Loader2 size={28} style={{color:"#e8a820",animation:"spin 1s linear infinite"}}/>
    </div>
  );

  const pct = data ? Math.round((data.completed_tasks_today/Math.max(data.total_tasks_today,1))*100) : 0;
  const tasksToday = data?.today_tasks ?? [];
  const overdueT = data?.overdue_tasks ?? [];
  const habits = data?.today_habits ?? [];
  const projects = data?.active_projects ?? [];

  return (
    <div>
      {/* ── TOP BAR ── */}
      <div className="top-bar" style={{flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"18px 24px",position:"relative"}}>
        {/* Stars top */}
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:8}}>
          <div style={{width:70,height:1,background:"rgba(255,255,255,0.12)"}}/>
          <span style={{color:"#e8a820",fontSize:10,letterSpacing:6,opacity:0.6}}>★ ★ ★</span>
          <div style={{width:70,height:1,background:"rgba(255,255,255,0.12)"}}/>
        </div>

        {/* JOSH'S */}
        <div style={{fontFamily:"'Inter',sans-serif",fontSize:42,fontWeight:900,letterSpacing:"0.15em",color:"rgba(255,255,255,0.75)",textTransform:"uppercase",lineHeight:1,marginBottom:2}}>
          JOSH'S
        </div>

        {/* COMMAND CENTER */}
        <div style={{fontFamily:"'Inter',sans-serif",fontSize:68,fontWeight:900,letterSpacing:"-0.04em",lineHeight:1,color:"#ffffff",textTransform:"uppercase"}}>
          COMMAND CENTER
        </div>

        {/* Flag */}
        <div style={{fontSize:30,marginTop:10}}>🇺🇸</div>

        {/* Stars bottom */}
        <div style={{display:"flex",alignItems:"center",gap:12,marginTop:10}}>
          <div style={{width:70,height:1,background:"rgba(255,255,255,0.12)"}}/>
          <span style={{color:"#e8a820",fontSize:10,letterSpacing:6,opacity:0.6}}>★ ★ ★</span>
          <div style={{width:70,height:1,background:"rgba(255,255,255,0.12)"}}/>
        </div>

        {/* Completion badge — absolute top right */}
        <div style={{position:"absolute",right:24,top:"50%",transform:"translateY(-50%)",textAlign:"right"}}>
          <div style={{fontSize:9,fontWeight:600,letterSpacing:"0.15em",textTransform:"uppercase",color:"rgba(255,255,255,0.35)",marginBottom:3}}>Today's completion</div>
          <div style={{display:"flex",alignItems:"center",gap:6,justifyContent:"flex-end"}}>
            <div className="panel" style={{width:60,height:48}}>
              <span className="panel-num" style={{fontSize:28,color:pct>=80?"#e8a820":pct>=50?"#fff":"#d94040"}}>{pct}%</span>
            </div>
          </div>
          <div style={{fontSize:9,fontWeight:600,letterSpacing:"0.12em",textTransform:"uppercase",color:"rgba(255,255,255,0.25)",marginTop:3}}>{data?.completed_tasks_today??0} of {data?.total_tasks_today??0} tasks</div>
        </div>
      </div>

      <div className="stripe"/>

      {/* ── MAIN GRID: Scoreboard left · Tasks right ── */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",borderBottom:"3px solid #1e3629"}}>

        {/* LEFT: Scoreboard */}
        <div style={{borderRight:"3px solid #1e3629"}}>
          <GameScoreboard stats={data?.gamification}/>
        </div>

        {/* RIGHT: Today's Tasks */}
        <div style={{display:"flex",flexDirection:"column"}}>
          <div className="panel-header">
            <span className="panel-header-title">⚔ Today's Tasks</span>
            <button className="panel-header-link" onClick={()=>setActivePage("todos")}>View All →</button>
          </div>
          <QuickAdd defaultStatus="today"/>
          <div style={{flex:1,overflowY:"auto",maxHeight:280}}>
            {tasksToday.length===0 ? (
              <div style={{padding:"24px 16px",textAlign:"center"}}>
                <p style={{fontFamily:"'IM Fell English',Georgia,serif",fontStyle:"italic",fontSize:11,color:"rgba(245,240,224,0.2)"}}>All clear — no orders today</p>
              </div>
            ) : tasksToday.slice(0,8).map(t=><TaskCard key={t.id} task={t}/>)}
          </div>
        </div>
      </div>

      <div className="stripe-thin"/>
      <div className="stripe-3"/>

      {/* ── BOTTOM ROW: Habits · Projects · Completion ── */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr"}}>

        {/* Habits */}
        <div style={{borderRight:"3px solid #1e3629"}}>
          <div className="bottom-label" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span>Today's Habits</span>
            <button className="panel-header-link" onClick={()=>setActivePage("habits")} style={{fontSize:9}}>Manage →</button>
          </div>
          {habits.length===0 ? (
            <p style={{padding:"12px 14px",fontFamily:"'IM Fell English',Georgia,serif",fontStyle:"italic",fontSize:11,color:"rgba(245,240,224,0.2)"}}>No habits configured</p>
          ) : habits.slice(0,6).map(h=><HabitRow key={h.id} habit={h} todayStr={today}/>)}
        </div>

        {/* Projects */}
        <div style={{borderRight:"3px solid #1e3629"}}>
          <div className="bottom-label" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span>Active Projects</span>
            <button className="panel-header-link" onClick={()=>setActivePage("projects")} style={{fontSize:9}}>All →</button>
          </div>
          {projects.length===0 ? (
            <p style={{padding:"12px 14px",fontFamily:"'IM Fell English',Georgia,serif",fontStyle:"italic",fontSize:11,color:"rgba(245,240,224,0.2)"}}>No active projects</p>
          ) : projects.map(p=>(
            <div key={p.id} className="proj-row" onClick={()=>setActivePage("projects")}>
              <div className="proj-name-line">
                <span className="proj-name">{p.title}</span>
                <span className="proj-pct">{p.completion_percentage}%</span>
              </div>
              <div className="proj-track"><div className="proj-fill" style={{width:`${p.completion_percentage}%`}}/></div>
              <div style={{fontSize:9,fontWeight:600,letterSpacing:"0.1em",textTransform:"uppercase",color:"rgba(245,240,224,0.25)",marginTop:3}}>{p.task_count} tasks</div>
            </div>
          ))}
        </div>

        {/* Completion panel */}
        <div>
          <div className="bottom-label">Completion · Today</div>
          <div style={{padding:"8px 14px"}}>
            <div style={{display:"flex",alignItems:"flex-end",gap:12,marginBottom:14}}>
              <div>
                <div style={{fontSize:8,fontWeight:600,letterSpacing:"0.12em",textTransform:"uppercase",color:"rgba(255,255,255,0.3)",marginBottom:4}}>Tasks</div>
                <div style={{display:"flex",gap:3,alignItems:"center"}}>
                  <div className="panel panel-sm"><span className="panel-num gold" style={{fontSize:20}}>{data?.completed_tasks_today??0}</span></div>
                  <div style={{fontSize:18,color:"rgba(255,255,255,0.2)",lineHeight:"36px"}}>/</div>
                  <div className="panel panel-sm"><span className="panel-num empty" style={{fontSize:20}}>{data?.total_tasks_today??0}</span></div>
                </div>
              </div>
              <div>
                <div style={{fontSize:8,fontWeight:600,letterSpacing:"0.12em",textTransform:"uppercase",color:"rgba(255,255,255,0.3)",marginBottom:4}}>Habits</div>
                <div style={{display:"flex",gap:3,alignItems:"center"}}>
                  <div className="panel panel-sm"><span className="panel-num gold" style={{fontSize:20}}>{habits.filter(h=>h.completions.some((c:any)=>c.completed_date===today)).length}</span></div>
                  <div style={{fontSize:18,color:"rgba(255,255,255,0.2)",lineHeight:"36px"}}>/</div>
                  <div className="panel panel-sm"><span className="panel-num empty" style={{fontSize:20}}>{habits.length}</span></div>
                </div>
              </div>
            </div>
            {overdueT.length>0&&(
              <div>
                <div style={{fontSize:9,fontWeight:600,letterSpacing:"0.12em",textTransform:"uppercase",color:"rgba(255,255,255,0.2)",marginBottom:4}}>Overdue</div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div className="panel panel-sm"><span className="panel-num red" style={{fontSize:20}}>{overdueT.length}</span></div>
                  <span style={{fontFamily:"'Oswald',Arial,sans-serif",fontSize:10,color:"rgba(255,255,255,0.3)",letterSpacing:"0.1em",textTransform:"uppercase"}}>Need attention</span>
                </div>
              </div>
            )}
            {overdueT.length===0&&(
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div className="panel panel-sm"><span className="panel-num gold" style={{fontSize:20}}>✓</span></div>
                <span style={{fontFamily:"'Oswald',Arial,sans-serif",fontSize:10,color:"rgba(255,255,255,0.3)",letterSpacing:"0.1em",textTransform:"uppercase"}}>All clear</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer quote */}
      <div className="stripe-thin"/>
      <div style={{padding:"5px 16px",background:"#1e3629"}}>
        <p style={{fontFamily:"'IM Fell English',Georgia,serif",fontStyle:"italic",fontSize:9,color:"rgba(232,168,32,0.25)",textAlign:"center"}}>
          "It is not in the still calm of life that great characters are formed." — Abigail Adams
        </p>
      </div>
    </div>
  );
}
