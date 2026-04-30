import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { projectsApi, tasksApi } from "@/lib/api";
import { Loader2, ArrowLeft, Trash2, Plus, ChevronRight, CheckCircle2, Circle, Clock, Calendar, ListChecks } from "lucide-react";
import type { ProjectSummary, Task, Project } from "@/types";
import { toast } from "react-hot-toast";

function Countdown({ targetDate }: { targetDate: string }) {
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date().getTime();
      const target = new Date(targetDate).getTime();
      const diff = target - now;

      if (diff <= 0) {
        setTimeLeft("DUE NOW");
        clearInterval(timer);
        return;
      }

      const d = Math.floor(diff / (1000 * 60 * 60 * 24));
      const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      
      if (d > 0) setTimeLeft(`${d}d ${h}h`);
      else if (h > 0) setTimeLeft(`${h}h ${m}m`);
      else setTimeLeft(`${m}m remaining`);
    }, 1000);
    return () => clearInterval(timer);
  }, [targetDate]);

  return <span>{timeLeft}</span>;
}

function ProjectDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const qc = useQueryClient();

  const { data: p, isLoading } = useQuery<Project>({
    queryKey: ["project", id],
    queryFn: () => projectsApi.get(id)
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
      show_in_daily: true
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", id] });
      setNewTaskTitle("");
      setShowAddTask(false);
      toast.success("Task added to campaign");
    }
  });

  if (isLoading || !p) {
    return (
      <div style={{display:"flex", alignItems:"center", justifyContent:"center", height:"300px"}}>
        <Loader2 size={28} style={{color:"#e8a820", animation:"spin 1s linear infinite"}} />
      </div>
    );
  }

  const allTasks = p.tasks || [];
  const completedCount = allTasks.reduce((acc, t) => {
    const taskDone = t.status === "done" ? 1 : 0;
    const subtasksDone = (t.subtasks || []).filter(s => s.status === "done").length;
    return acc + taskDone + subtasksDone;
  }, 0);
  
  const totalCount = allTasks.reduce((acc, t) => acc + 1 + (t.subtasks || []).length, 0);
  const remainingCount = totalCount - completedCount;
  const pct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  // Format Due Date / Time
  const due = p.due_date ? new Date(p.due_date) : null;
  const dueStr = due ? due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : "-";
  const timeStr = due ? due.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : "-";

  return (
    <div className="sb-shell" style={{minHeight:"100vh"}}>
      <div className="top-bar">
        <button onClick={onBack} style={{background:"none", border:"none", cursor:"pointer", color:"#e8a820", display:"flex", alignItems:"center", gap:8}}>
          <ArrowLeft size={16} /> ALL CAMPAIGNS
        </button>
        <div className="top-title">{p.title.toUpperCase()}</div>
        
        {/* Scoreboard Headers */}
        <div style={{display:"flex", gap:20, marginLeft:40}}>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:9, opacity:0.5}}>DUE DATE</div>
            <div style={{color:"#e8a820", fontWeight:700, fontSize:14}}>{dueStr}</div>
          </div>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:9, opacity:0.5}}>DUE TIME</div>
            <div style={{color:"#e8a820", fontWeight:700, fontSize:14}}>{timeStr}</div>
          </div>
          <div style={{textAlign:"center", minWidth:100}}>
            <div style={{fontSize:9, opacity:0.5}}>COUNTDOWN</div>
            <div style={{color:"#d94040", fontWeight:700, fontSize:14}}>
              {p.due_date ? <Countdown targetDate={p.due_date} /> : "-"}
            </div>
          </div>
          <div style={{width:2, background:"rgba(255,255,255,0.1)", margin:"5px 0"}} />
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:9, opacity:0.5}}>TASKS</div>
            <div style={{fontWeight:700, fontSize:14}}>{totalCount}</div>
          </div>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:9, opacity:0.5}}>DONE</div>
            <div style={{color:"#e8a820", fontWeight:700, fontSize:14}}>{completedCount}</div>
          </div>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:9, opacity:0.5}}>LEFT</div>
            <div style={{color:"#fff", fontWeight:700, fontSize:14}}>{remainingCount}</div>
          </div>
        </div>
      </div>
      <div className="stripe" />

      <div style={{padding:"20px"}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:15}}>
          <div className="sb-header-label">CAMPAIGN OBJECTIVES</div>
          <button 
            onClick={() => setShowAddTask(true)}
            style={{background:"transparent", border:"1px solid #e8a820", color:"#e8a820", padding:"4px 10px", borderRadius:4, fontSize:12, cursor:"pointer", display:"flex", alignItems:"center", gap:5}}
          >
            <Plus size={14} /> ADD TASK
          </button>
        </div>

        {showAddTask && (
          <div className="sb-row" style={{background:"#1e3629", padding:12, marginBottom:15, border:"1px solid #e8a820"}}>
            <input 
              autoFocus
              style={{background:"transparent", border:"none", width:"100%", color:"#fff", outline:"none", fontSize:14}}
              placeholder="ENTER NEW TASK TITLE..."
              value={newTaskTitle}
              onChange={e => setNewTaskTitle(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addTaskMut.mutate(newTaskTitle)}
            />
          </div>
        )}

        <div className="sb-header" style={{gridTemplateColumns: "1fr 100px 100px"}}>
          <div className="sb-col-head" style={{textAlign:"left", paddingLeft:16}}>OBJECTIVE</div>
          <div className="sb-col-head">STATUS</div>
          <div className="sb-col-head">SUBTASKS</div>
        </div>

        {allTasks.length === 0 ? (
          <div style={{padding:40, textAlign:"center", color:"rgba(255,255,255,0.3)"}}>No tasks assigned to this campaign.</div>
        ) : (
          allTasks.map((t: Task) => (
            <div key={t.id} style={{marginBottom:10}}>
              <div className="sb-row" style={{display:"grid", gridTemplateColumns: "1fr 100px 100px", background:"#1e3629", padding:"12px 0", borderLeft: t.priority === "high" || t.priority === "critical" ? "4px solid #e8a820" : "none"}}>
                <div style={{paddingLeft:16, display:"flex", alignItems:"center", gap:10}}>
                  {t.status === "done" ? <CheckCircle2 size={16} color="#e8a820" /> : <Circle size={16} color="rgba(255,255,255,0.2)" />}
                  <span style={{fontWeight:600, fontSize:14, color: t.status === "done" ? "rgba(255,255,255,0.4)" : "#fff"}}>{t.title}</span>
                </div>
                <div style={{textAlign:"center", fontSize:10, textTransform:"uppercase", opacity:0.6}}>{t.status}</div>
                <div style={{textAlign:"center", fontWeight:700, color:"#e8a820"}}>
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

export function ProjectsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [showNew, setShowNew] = useState(false);
  const qc = useQueryClient();

  const { data: projects = [], isLoading } = useQuery<ProjectSummary[]>({
    queryKey: ["projects"],
    queryFn: () => projectsApi.list()
  });

  const createMut = useMutation({
    mutationFn: () => projectsApi.create({
      title: newTitle.trim(),
      status: "active",
      priority: "medium",
      importance: 3,
      difficulty: 3,
      tag_ids: [],
      show_in_daily: true
    }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      setNewTitle("");
      setShowNew(false);
      setSelectedId(p.id);
      toast.success("Campaign created!");
    }
  });

  if (selectedId) return <ProjectDetail id={selectedId} onBack={() => setSelectedId(null)} />;

  return (
    <div className="sb-shell" style={{minHeight:"100vh", background:"#162a1c"}}>
      <div className="top-bar">
        <div className="top-title">CAMPAIGNS / PROJECTS</div>
        <button 
          onClick={() => setShowNew(true)}
          style={{background:"#e8a820", border:"none", padding:"6px 12px", borderRadius:4, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", gap:4}}
        >
          <Plus size={16} /> NEW
        </button>
      </div>
      <div className="stripe" />

      <div style={{padding:"20px"}}>
        {showNew && (
          <div className="sb-row" style={{background:"#1e3629", padding:16, marginBottom:20, border:"1px solid #e8a820"}}>
            <input 
              autoFocus
              className="panel-num"
              style={{background:"transparent", border:"none", width:"100%", fontSize:20, color:"#fff", outline:"none"}}
              placeholder="ENTER CAMPAIGN TITLE..."
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => e.key === "Enter" && createMut.mutate()}
            />
            <div style={{marginTop:12, display:"flex", gap:10}}>
              <button onClick={() => createMut.mutate()} style={{background:"#e8a820", border:"none", padding:"4px 12px", fontWeight:700, cursor:"pointer"}}>SAVE</button>
              <button onClick={() => setShowNew(false)} style={{background:"transparent", border:"1px solid #fff", color:"#fff", padding:"4px 12px", cursor:"pointer"}}>CANCEL</button>
            </div>
          </div>
        )}

        <div style={{display:"grid", gap:12}}>
          {projects.map((p: ProjectSummary) => (
            <div 
              key={p.id} 
              className="sb-row highlight" 
              onClick={() => setSelectedId(p.id)}
              style={{background:"#1e3629", cursor:"pointer", padding:"16px 20px", display:"flex", justifyContent:"space-between", alignItems:"center"}}
            >
              <div>
                <div style={{fontSize:18, fontWeight:700, letterSpacing:"0.05em"}}>{p.title.toUpperCase()}</div>
                <div style={{fontSize:11, opacity:0.6, marginTop:4}}>{p.task_count || 0} OBJECTIVES / {p.completion_percentage || 0}% COMPLETE</div>
              </div>
              <ChevronRight size={20} color="#e8a820" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
