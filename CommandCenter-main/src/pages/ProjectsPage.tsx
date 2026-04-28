import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { projectsApi } from "@/lib/api";
import { Loader2, ArrowLeft, Trash2 } from "lucide-react";
import type { ProjectSummary } from "@/types";
import toast from "react-hot-toast";

function ProjectDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { data: p, isLoading } = useQuery({ 
    queryKey: ["project", id], 
    queryFn: () => projectsApi.get(id) 
  });

  if (isLoading || !p) {
    return (
      <div style={{display:"flex", justifyContent:"center", padding:"60px 20px"}}>
        <Loader2 size={24} style={{color:"#e8a820", animation:"spin 1s linear infinite"}} />
      </div>
    );
  }

  return (
    <div>
      <div className="top-bar">
        <button onClick={onBack} style={{background:"none", border:"none", cursor:"pointer", color:"rgba(232,168,32,0.6)", display:"flex", alignItems:"center", gap:8}}>
          <ArrowLeft size={16} /> All Campaigns
        </button>
        <div style={{flex:1, textAlign:"center"}}>
          <div className="top-title">{p.title}</div>
        </div>
        <span style={{fontSize:20}}>📋</span>
      </div>
      <div className="stripe" />

      <div style={{padding: "20px"}}>
        <h2>Project Detail Coming Soon...</h2>
        <p>Tasks will appear here (this is a minimal version for now).</p>
        <pre style={{background:"#111", padding:12, borderRadius:4, fontSize:12, overflow:"auto"}}>
          {JSON.stringify(p, null, 2)}
        </pre>
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
    },
    onError: () => toast.error("Failed to create campaign")
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => projectsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Campaign deleted");
      if (selectedId) setSelectedId(null);
    },
    onError: () => toast.error("Failed to delete")
  });

  const handleDelete = (id: string, title: string) => {
    if (confirm(`Delete "${title}" and ALL its tasks?\n\nThis cannot be undone!`)) {
      deleteMut.mutate(id);
    }
  };

  if (selectedId) {
    return <ProjectDetail id={selectedId} onBack={() => setSelectedId(null)} />;
  }

  return (
    <div>
      <div className="top-bar">
        <span style={{fontSize:20}}>📋</span>
        <div className="top-title" style={{flex:1, paddingLeft:12}}>Active Campaigns</div>
        <button className="btn btn-gold" onClick={() => setShowNew(!showNew)}>+ New Campaign</button>
      </div>
      <div className="stripe" />

      {showNew && (
        <div style={{display:"flex", gap:8, padding:"12px", background:"#1e3629", borderBottom:"2px solid #2a4a3a"}}>
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && newTitle.trim() && createMut.mutate()}
            placeholder="New campaign title..."
            autoFocus
            style={{flex:1, padding:10, fontSize:14}}
          />
          <button className="btn btn-solid-gold" onClick={() => createMut.mutate()} disabled={!newTitle.trim() || createMut.isPending}>
            Create
          </button>
          <button className="btn btn-red" onClick={() => {setShowNew(false); setNewTitle("");}}>Cancel</button>
        </div>
      )}

      {isLoading ? (
        <div style={{textAlign:"center", padding:80}}>
          <Loader2 size={28} style={{color:"#e8a820", animation:"spin 1s linear infinite"}} />
        </div>
      ) : projects.length === 0 ? (
        <div style={{padding:"80px 20px", textAlign:"center", color:"#aaa"}}>
          <p>No campaigns yet.</p>
          <p>Click "+ New Campaign" above to get started.</p>
        </div>
      ) : (
        <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(320px, 1fr))", gap:2}}>
          {projects.map((p: ProjectSummary) => (
            <div key={p.id} style={{position:"relative", background:"#2a4a3a", borderBottom:"2px solid #1e3629"}}>
              <button
                onClick={() => setSelectedId(p.id)}
                style={{width:"100%", textAlign:"left", padding:16, border:"none", background:"transparent", cursor:"pointer"}}
              >
                <div style={{fontWeight:600, fontSize:15, marginBottom:6}}>{p.title}</div>
                <div style={{display:"flex", gap:12, fontSize:12, color:"#aaa"}}>
                  <span>{p.task_count} tasks</span>
                  <span>{p.completion_percentage}% complete</span>
                </div>
              </button>

              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(p.id, p.title); }}
                style={{position:"absolute", top:12, right:12, padding:6, background:"rgba(0,0,0,0.7)", border:"none", borderRadius:4, color:"#ff6666", cursor:"pointer"}}
                title="Delete campaign"
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
