import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { tasksApi } from "@/lib/api";
import { useActiveTimer } from "@/hooks/useTimer";
import { useTimerStore, useCelebrationStore } from "@/store";
import { TaskModal } from "./TaskModal";
import { calcPoints, formatDuration, formatMinutes, isOverdue } from "@/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Task } from "@/types";

const ACCENT: Record<string,string> = { critical:"#d94040", high:"#e8a820", medium:"rgba(255,255,255,0.3)", low:"rgba(255,255,255,0.12)" };

export function TaskCard({ task }: { task: Task }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [subsOpen, setSubsOpen] = useState(false);
  const qc = useQueryClient();
  const { isRunning, activeTimer, elapsedSeconds, start, stop } = useActiveTimer();
  const { setActiveTimer } = useTimerStore();
  const { triggerCelebration } = useCelebrationStore();
  const isThisRunning = isRunning && activeTimer?.task_id === task.id;
  const overdue = isOverdue(task.due_date);
  const activeSubs = task.subtasks.filter(s => s.status !== "done");

  const completeMut = useMutation({
    mutationFn: () => tasksApi.complete(task.id),
    onSuccess: () => { triggerCelebration(task, calcPoints(task)); qc.invalidateQueries({queryKey:["tasks"]}); qc.invalidateQueries({queryKey:["dashboard"]}); },
  });

  if (task.status === "done") return null;

  const handleTimer = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isThisRunning) stop();
    else { setActiveTimer(null, task); start({ task_id: task.id }); }
  };

  return (
    <>
      <div>
        <div className={`task-item ${task.priority}`} style={{ margin:"0 10px 4px", borderLeftColor: ACCENT[task.priority] }}>
          {/* Scoreboard checkbox */}
          <button type="button"
            className={`sb-check ${completeMut.isPending ? "done" : ""}`}
            onClick={e => { e.stopPropagation(); completeMut.mutate(); }}
            disabled={completeMut.isPending}
            title="Mark complete">
            {completeMut.isPending && "✓"}
          </button>

          {/* Title + meta — clicks to modal */}
          <div style={{ flex:1, minWidth:0, cursor:"pointer" }} onClick={() => setModalOpen(true)}>
            <div className="task-name">{task.title}</div>
            <div className="task-fs">
              <span style={{color:ACCENT[task.priority]}}>{task.priority.toUpperCase()}</span>
              {" · "}
              <span style={{color:task.focus_score>=20?"#d94040":task.focus_score>=12?"#e8a820":"rgba(245,240,224,0.4)"}}>FS:{task.focus_score}</span>
              {task.time_estimate_minutes && ` · ${formatMinutes(task.time_estimate_minutes)}`}
              {task.due_date && <span style={{color:overdue?"#d94040":"rgba(245,240,224,0.3)"}}>{` · ${overdue?"⚠ ":""}${task.due_date}`}</span>}
            </div>
          </div>

          {/* Subtask toggle */}
          {activeSubs.length > 0 && (
            <button type="button" onClick={e=>{e.stopPropagation();setSubsOpen(v=>!v);}}
              style={{background:"none",border:"none",cursor:"pointer",color:"rgba(245,240,224,0.2)",display:"flex",alignItems:"center",gap:2}}
              onMouseEnter={e=>(e.currentTarget.style.color="#e8a820")} onMouseLeave={e=>(e.currentTarget.style.color="rgba(245,240,224,0.2)")}>
              {subsOpen?<ChevronDown size={12}/>:<ChevronRight size={12}/>}
              <span style={{fontFamily:"'Oswald',Arial,sans-serif",fontSize:9,letterSpacing:"0.08em"}}>{activeSubs.length}</span>
            </button>
          )}

          {/* Running timer */}
          {isThisRunning && (
            <span className="timer-pulse" style={{fontFamily:"'Oswald',Arial,sans-serif",fontSize:14,fontWeight:700,color:"#d94040",flexShrink:0}}>
              {formatDuration(elapsedSeconds)}
            </span>
          )}

          {/* Play/Stop */}
          <div className="task-play" onClick={handleTimer} title={isThisRunning?"Stop timer":"Start timer"}>
            {isThisRunning ? <div className="tri-stop"/> : <div className="tri"/>}
          </div>
        </div>

        {/* Inline subtasks */}
        {subsOpen && activeSubs.length > 0 && (
          <div style={{marginLeft:20,marginRight:10,background:"rgba(0,0,0,0.2)",borderLeft:"2px solid #1e3629",marginBottom:4}}>
            {activeSubs.map(sub=>(
              <div key={sub.id} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 10px",borderBottom:"1px solid rgba(0,0,0,0.2)"}}>
                <div style={{width:12,height:12,border:"1px solid rgba(232,168,32,0.25)",borderRadius:1,flexShrink:0}}/>
                <span style={{fontFamily:"'Oswald',Arial,sans-serif",fontSize:11,letterSpacing:"0.04em",textTransform:"uppercase",color:"rgba(245,240,224,0.4)",flex:1}}>{sub.title}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <TaskModal open={modalOpen} onClose={()=>setModalOpen(false)} task={task}/>
    </>
  );
}
