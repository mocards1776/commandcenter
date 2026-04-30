import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { projectsApi } from "@/lib/api";
import { Loader2, ArrowLeft, Trash2, Plus, ChevronRight, CheckCircle2, Circle } from "lucide-react";
import type { ProjectSummary, Task } from "@/types";
import { toast } from "react-hot-toast";

function ProjectDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { data: p, isLoading } = useQuery({
    queryKey: ["project", id],
    queryFn: () => projectsApi.get(id)
  });

  if (isLoading || !p) {
    return (
      <div style={{display:"flex", alignItems:"center", justifyContent:"center", height:"300px"}}>
        <Loader2 size={28} style={{color:"#e8a820", animation:"spin 1s linear infinite"}} />
      </div>
    );
  }

  // Scoreboard calculation (tasks + subtasks)
  const allTasks = p.tasks || [];
  const completedCount = allTasks.reduce((acc, t) => {
    const taskDone = t.status === "done" ? 1 : 0;
    const subtasksDone = (t.subtasks || []).filter(s => s.status === "done").length;
    return acc + taskDone + subtasksDone;
  }, 0);
  
  const totalCount = allTasks.reduce((acc, t) => {
    return acc + 1 + (t.subtasks || []).length;
  }, 0);

  const pct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <div className="sb-shell" style={{minHeight:"100vh"}}>
      <div className="top-bar">
        <button onClick={onBack} style={{background:"none", border:"none", cursor:"pointer", color:"#e8a820", display:"flex", alignItems:"center", gap:8}}>
          <ArrowLeft size={16} /> ALL CAMPAIGNS
        </button>
        <div className="top-title">{p.title}</div>
        <div style={{width:80, textAlign:"right", color:"#e8a820", fontWeight:700}}>{pct}%</div>
      </div>
      <div className="stripe" />

      <div style={{padding:"20px"}}>
        <div className="sb-header" style={{gridTemplateColumns: "1fr 100px 100px"}}>
          <div className="sb-col-head" style={{textAlign:"left", paddingLeft:16}}>TASK / OBJECTIVE</div>
          <div className="sb-col-head">STATUS</div>
          <div className="sb-col-head">STATS</div>
        </div>

        {allTasks.length === 0 ? (
          <div style={{padding:40, textAlign:"center", color:"rgba(255,255,255,0.3)"}}>No tasks in this campaign.</div>
        ) : (
          allTasks.map((t: Task) => (
            <div key={t.id} style={{marginBottom:10}}>
              <div className="sb-row" style={{display:"grid", gridTemplateColumns: "1fr 100px 100px", background:"#1e3629", padding:"12px 0", borderLeft: t.priority === "high" || t.priority === "critical" ? "4px solid #e8a820" : "none"}}>
                <div style={{paddingLeft:16, display:"flex", alignItems:"center", gap:10}}>
                  {t.status === "done" ? <CheckCircle2 size={16} color="#e8a820" /> : <Circle size={16} color="rgba(255,255,255,0.2)" />}
                  <span style={{fontWeight:600, fontSize:14, color: t.status === "done" ? "rgba(255,255,255,0.4)" : "#fff"}}>{t.title}</span>
                </div>
                <div style={{display:"flex", alignItems:"center", justifyContent:"center"}}>
                  <div style={{fontSize:10, padding:"2px 8px", background:"rgba(255,255,255,0.05)", borderRadius:4, textTransform:"uppercase"}}>{t.status}</div>
                </div>
                <div style={{display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, color:"#e8a820"}}>
                  {t.subtasks?.length ? `${t.subtasks.filter(s => s.status === "done").length}/${t.subtasks.length}` : "-"}
                </div>
              </div>
              
              {/* Subtasks */}
              {t.subtasks?.map(sub => (
                <div key={sub.id} className="sb-row" style={{display:"grid", gridTemplateColumns: "1fr 100px 100px", background:"rgba(30,54,41,0.4)", padding:"8px 0", marginLeft:20, borderLeft:"1px solid rgba(232,168,32,0.2)"}}>
                  <div style={{paddingLeft:16, display:"flex", alignItems:"center", gap:8, opacity:0.8}}>
                    {sub.status === "done" ? <CheckCircle2 size={12} color="#e8a820" /> : <Circle size={12} color="rgba(255,255,255,0.2)" />}
                    <span style={{fontSize:13}}>{sub.title}</span>
                  </div>
                  <div style={{textAlign:"center", fontSize:9, opacity:0.5}}>{sub.status}</div>
                  <div style={{textAlign:"center", fontSize:12}}>-</div>
                </div>
              ))}
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

  const { data: projects = [], isLoading } = useQuery({
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

  const deleteMut = useMutation({
    mutationFn: (id: string) => projectsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Campaign deleted");
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

        {isLoading ? (
          <div style={{display:"flex", justifyContent:"center", padding:40}}><Loader2 className="animate-spin" /></div>
        ) : projects.length === 0 ? (
          <div style={{textAlign:"center", padding:40, opacity:0.3}}>NO ACTIVE CAMPAIGNS</div>
        ) : (
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
                <div style={{display:"flex", alignItems:"center", gap:15}}>
                  <div style={{width:100, height:8, background:"rgba(0,0,0,0.3)", borderRadius:4, overflow:"hidden"}}>
                    <div style={{width:`${p.completion_percentage}%`, height:"100%", background:"#e8a820"}} />
                  </div>
                  <ChevronRight size={20} color="#e8a820" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
