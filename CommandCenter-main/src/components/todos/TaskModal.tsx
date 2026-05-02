import { useState, useEffect, useRef } from "react";
import type React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tasksApi, projectsApi, categoriesApi, tagsApi } from "@/lib/api";
import { CompletionDialog } from "./CompletionDialog";
import { useActiveTimer } from "@/hooks/useTimer";
import { useTimerStore, useCelebrationStore } from "@/store";
import { calcPoints, formatDuration, formatMinutes } from "@/lib/utils";
import { X, Play, Square, Check, Trash2, Plus } from "lucide-react";
import type { Task, TaskStatus, Priority } from "@/types";
import toast from "react-hot-toast";

const impToPriority = (n: number): Priority => n >= 5 ? "critical" : n >= 4 ? "high" : n >= 3 ? "medium" : "low";
const impToLabel   = (n: number): string   => n >= 5 ? "URGENT" : n >= 4 ? "HIGH" : n >= 3 ? "MEDIUM" : "LOW";
const LABEL_COLOR: Record<string,string> = { URGENT:"#d94040", HIGH:"#e8a820", MEDIUM:"rgba(245,240,224,0.65)", LOW:"#4a8a5a" };
const PCOLOR: Record<string,string> = { low:"#4a8a5a", medium:"rgba(245,240,224,0.5)", high:"#e8a820", critical:"#d94040" };

const todayISO = () => new Date().toISOString().split("T")[0];

// Preset colors for new tags / categories
const SWATCHES = ["#e8a820","#d94040","#4a8a5a","#4a7fa8","#9b59b6","#e67e22","#1abc9c","#e91e63","#607d8b","#f5f0e0"];

function Stars({ value, onChange, color, label, sublabel }: { value:number; onChange:(n:number)=>void; color:string; label:string; sublabel?:string }) {
  const [hover, setHover] = useState(0);
  return (
    <div>
      <div style={{fontSize:9,fontWeight:600,letterSpacing:"0.18em",textTransform:"uppercase",color:"rgba(245,240,224,0.35)",marginBottom:4,display:"flex",alignItems:"center",gap:6}}>
        {label}
        {sublabel && <span style={{color,fontWeight:700,letterSpacing:"0.12em"}}>{sublabel}</span>}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:2}}>
        {[1,2,3,4,5].map(n=>(
          <button key={n} type="button" className="star-btn" style={{color:n<=(hover||value)?color:"rgba(245,240,224,0.15)"}} onMouseEnter={()=>setHover(n)} onMouseLeave={()=>setHover(0)} onClick={()=>onChange(n)}>★</button>
        ))}
        <span style={{fontSize:11,fontWeight:700,color,marginLeft:4}}>{hover||value}/5</span>
      </div>
    </div>
  );
}

// ── Inline tag picker: type-to-filter + create ──
function TagPicker({ selTagIds, setSelTagIds, allTags, onCreateTag }: {
  selTagIds: string[];
  setSelTagIds: (fn:(p:string[])=>string[]) => void;
  allTags: any[];
  onCreateTag: (name:string, color:string) => Promise<any>;
}) {
  const [q, setQ] = useState("");
  const [newColor, setNewColor] = useState(SWATCHES[0]);
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = allTags.filter((t:any) =>
    !selTagIds.includes(t.id) &&
    t.name.toLowerCase().includes(q.toLowerCase())
  );
  const exactMatch = allTags.some((t:any) => t.name.toLowerCase() === q.trim().toLowerCase());
  const showCreate = q.trim().length > 0 && !exactMatch;

  const handleCreate = async () => {
    if (!q.trim()) return;
    setCreating(true);
    try {
      const tag = await onCreateTag(q.trim(), newColor);
      setSelTagIds(p => [...p, tag.id]);
      setQ("");
      setNewColor(SWATCHES[0]);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      {/* Selected tag chips */}
      {selTagIds.length > 0 && (
        <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:6}}>
          {selTagIds.map(id => {
            const tag = allTags.find((t:any) => t.id === id);
            return tag ? (
              <span key={id} onClick={()=>setSelTagIds(p=>p.filter(i=>i!==id))}
                style={{padding:"2px 8px",border:`1px solid ${tag.color}40`,background:`${tag.color}14`,color:tag.color,fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",cursor:"pointer",fontFamily:"'Oswald',Arial,sans-serif",display:"flex",alignItems:"center",gap:4}}>
                {tag.name} <span style={{opacity:0.6,fontSize:9}}>×</span>
              </span>
            ) : null;
          })}
        </div>
      )}

      {/* Search / create input */}
      <div style={{display:"flex",gap:6,alignItems:"center"}}>
        <input ref={inputRef} value={q} onChange={e=>setQ(e.target.value)}
          placeholder="Type to search or create a tag…"
          style={{flex:1,padding:"6px 10px",fontSize:12,background:"rgba(0,0,0,0.25)",border:"1px solid rgba(245,240,224,0.1)",color:"#f5f0e0",caretColor:"#e8a820"}}
          onKeyDown={e=>{ if(e.key==="Enter"&&showCreate) handleCreate(); if(e.key==="Escape") setQ(""); }}
        />
        {showCreate && (
          <div style={{display:"flex",gap:4,alignItems:"center",flexShrink:0}}>
            {/* color swatches */}
            {SWATCHES.map(c => (
              <button key={c} type="button" onClick={()=>setNewColor(c)}
                style={{width:14,height:14,borderRadius:"50%",background:c,border:newColor===c?"2px solid #f5f0e0":"2px solid transparent",padding:0,cursor:"pointer",flexShrink:0}}/>
            ))}
            <button type="button" className="btn btn-gold" onClick={handleCreate} disabled={creating}
              style={{padding:"3px 10px",flexShrink:0}}>
              {creating ? "…" : `+ Create`}
            </button>
          </div>
        )}
      </div>

      {/* Filtered existing tags */}
      {q.length > 0 && filtered.length > 0 && (
        <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:6}}>
          {filtered.map((t:any) => (
            <span key={t.id} onClick={()=>{setSelTagIds(p=>[...p,t.id]);setQ("");}}
              style={{padding:"2px 8px",border:`1px solid ${t.color}40`,background:`${t.color}14`,color:t.color,fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",cursor:"pointer",fontFamily:"'Oswald',Arial,sans-serif"}}>
              + {t.name}
            </span>
          ))}
        </div>
      )}
      {/* All unselected tags when input is empty */}
      {q.length === 0 && allTags.filter((t:any)=>!selTagIds.includes(t.id)).length > 0 && (
        <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:6}}>
          {allTags.filter((t:any)=>!selTagIds.includes(t.id)).map((t:any) => (
            <span key={t.id} onClick={()=>setSelTagIds(p=>[...p,t.id])}
              style={{padding:"2px 7px",border:`1px solid ${t.color}30`,color:`${t.color}99`,fontSize:9,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",cursor:"pointer",fontFamily:"'Oswald',Arial,sans-serif"}}>
              {t.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Inline category picker: select + create ──
function CategoryPicker({ selCategory, setSelCategory, categories, onCreateCategory }: {
  selCategory: string;
  setSelCategory: (id:string) => void;
  categories: any[];
  onCreateCategory: (name:string, color:string, icon?:string) => Promise<any>;
}) {
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName]   = useState("");
  const [newColor, setNewColor] = useState(SWATCHES[0]);
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const cat = await onCreateCategory(newName.trim(), newColor);
      setSelCategory(cat.id);
      setNewName(""); setNewColor(SWATCHES[0]); setShowForm(false);
    } finally {
      setCreating(false);
    }
  };

  const selCat = categories.find((c:any) => c.id === selCategory);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:6}}>
      <div style={{display:"flex",gap:6,alignItems:"center"}}>
        <select value={selCategory} onChange={e=>setSelCategory(e.target.value)}
          style={{flex:1,padding:"9px 10px",fontSize:14}}>
          <option value="">— None —</option>
          {categories.map((c:any)=>(
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button type="button" className="btn btn-gold"
          onClick={()=>setShowForm(s=>!s)}
          style={{padding:"6px 10px",flexShrink:0,height:38}}>
          <Plus size={12}/>
        </button>
      </div>
      {selCat && (
        <div style={{display:"flex",alignItems:"center",gap:6,padding:"3px 8px",background:`${selCat.color}14`,border:`1px solid ${selCat.color}30`}}>
          <div style={{width:8,height:8,borderRadius:"50%",background:selCat.color,flexShrink:0}}/>
          <span style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:selCat.color,fontFamily:"'Oswald',Arial,sans-serif"}}>{selCat.name}</span>
          <button type="button" onClick={()=>setSelCategory("")} style={{marginLeft:"auto",background:"none",border:"none",cursor:"pointer",color:"rgba(245,240,224,0.3)",fontSize:10,padding:0}}>remove</button>
        </div>
      )}
      {showForm && (
        <div style={{padding:"10px 12px",background:"rgba(0,0,0,0.2)",border:"1px solid rgba(232,168,32,0.2)",display:"flex",flexDirection:"column",gap:8}}>
          <div style={{fontSize:9,fontWeight:600,letterSpacing:"0.15em",textTransform:"uppercase",color:"rgba(232,168,32,0.5)"}}>New Category</div>
          <input value={newName} onChange={e=>setNewName(e.target.value)}
            placeholder="Category name…"
            autoFocus
            style={{padding:"6px 10px",fontSize:13,background:"rgba(0,0,0,0.25)",border:"1px solid rgba(245,240,224,0.1)",color:"#f5f0e0",caretColor:"#e8a820"}}
            onKeyDown={e=>{ if(e.key==="Enter"&&newName.trim()) handleCreate(); if(e.key==="Escape") setShowForm(false); }}/>
          <div>
            <div style={{fontSize:9,letterSpacing:"0.12em",textTransform:"uppercase",color:"rgba(245,240,224,0.3)",marginBottom:4}}>Color</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {SWATCHES.map(c => (
                <button key={c} type="button" onClick={()=>setNewColor(c)}
                  style={{width:16,height:16,borderRadius:"50%",background:c,border:newColor===c?"2px solid #f5f0e0":"2px solid transparent",padding:0,cursor:"pointer"}}/>
              ))}
            </div>
          </div>
          <div style={{display:"flex",gap:6,justifyContent:"flex-end"}}>
            <button type="button" className="btn btn-red" onClick={()=>setShowForm(false)} style={{padding:"3px 10px"}}>Cancel</button>
            <button type="button" className="btn btn-gold" onClick={handleCreate} disabled={!newName.trim()||creating} style={{padding:"3px 10px"}}>{creating?"Saving…":"Create"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

interface SubtaskDraft {
  _id: string; title: string; priority: Priority; importance: number;
  difficulty: number; timeEst: string; status: TaskStatus;
}

const FIELD: React.CSSProperties = {display:"flex",flexDirection:"column",gap:4};
const INP: React.CSSProperties = {width:"100%",padding:"9px 10px",fontSize:14};
const SHEAD = (text:string) => <div style={{fontSize:11,fontWeight:600,letterSpacing:"0.18em",textTransform:"uppercase",color:"rgba(232,168,32,0.6)",marginBottom:4}}>{text}</div>;

interface Props {
  open: boolean;
  onClose: () => void;
  task?: Task | null;
  projectId?: string;
  parentId?: string;
  defaultStatus?: TaskStatus;
  /** Pre-fill title from NLP parsing (QuickAdd) */
  initialTitle?: string;
  /** Pre-fill due date "YYYY-MM-DD" from NLP parsing */
  initialDueDate?: string;
  /** Pre-fill due time "HH:MM" 24h from NLP parsing */
  initialDueTime?: string;
}

export function TaskModal({ open, onClose, task, projectId, parentId, defaultStatus, initialTitle, initialDueDate, initialDueTime }: Props) {
  const qc = useQueryClient();
  const isEdit = !!task;
  const [completionOpen, setCompletionOpen] = useState(false);
  const { isRunning, activeTimer, elapsedSeconds, start, stop } = useActiveTimer();
  const { setActiveTimer } = useTimerStore();
  const { triggerCelebration } = useCelebrationStore();
  const isThisRunning = isRunning && activeTimer?.task_id === task?.id;

  const [title,setTitle]             = useState(task?.title ?? initialTitle ?? "");
  const [description,setDescription] = useState(task?.description??"");
  const [notes,setNotes]             = useState(task?.notes??"");
  const [status,setStatus]           = useState<TaskStatus>(task?.status??defaultStatus??"today");
  const [importance,setImportanceRaw]= useState(task?.importance??3);
  const [difficulty,setDifficulty]   = useState(task?.difficulty??3);
  const [dueDate,setDueDate]         = useState(task?.due_date ?? initialDueDate ?? todayISO());
  const [dueTime,setDueTime]         = useState(task?.due_date ? task.due_date.includes("T") ? task.due_date.slice(11,16) : "" : initialDueTime ?? "");
  const [timeEst,setTimeEst]         = useState(task?.time_estimate_minutes?.toString()??"");
  const [selProject,setSelProject]   = useState(task?.project_id??projectId??"");
  const [selCategory,setSelCategory] = useState(task?.category_id??"");
  const [selTagIds,setSelTagIds]     = useState<string[]>(task?.tag_ids??[]);

  const priority   = impToPriority(importance);
  const urgLabel   = impToLabel(importance);
  const pColor     = PCOLOR[priority]??"#e8a820";
  const setImportance = (n:number) => setImportanceRaw(n);

  // Subtask state
  const [pendingSubtasks, setPendingSubtasks] = useState<SubtaskDraft[]>([]);
  const [subModalOpen, setSubModalOpen]       = useState(false);
  const [addingDraft, setAddingDraft]         = useState(false);
  const [draftTitle, setDraftTitle]           = useState("");
  const [draftImportance, setDraftImportance] = useState(3);
  const [draftDifficulty, setDraftDifficulty] = useState(3);
  const [draftTimeEst, setDraftTimeEst]       = useState("");
  const [draftStatus, setDraftStatus]         = useState<TaskStatus>("today");

  const focusScore = difficulty * importance;

  useEffect(()=>{
    if(!open) return;
    setTitle(task?.title ?? initialTitle ?? "");
    setDescription(task?.description??"");
    setNotes(task?.notes??"");
    setStatus(task?.status??defaultStatus??"today");
    setImportanceRaw(task?.importance??3);
    setDifficulty(task?.difficulty??3);
    setDueDate(task?.due_date ?? initialDueDate ?? todayISO());
    // Parse time out of task due_date if present, else use initialDueTime
    setDueTime(task?.due_date ? (task.due_date.includes("T") ? task.due_date.slice(11,16) : "") : (initialDueTime ?? ""));
    setTimeEst(task?.time_estimate_minutes?.toString()??"");
    setSelProject(task?.project_id??projectId??"");
    setSelCategory(task?.category_id??"");
    setSelTagIds(task?.tag_ids??[]);
    setPendingSubtasks([]); setAddingDraft(false);
  },[open, task?.id, initialTitle, initialDueDate, initialDueTime]);

  const { data:projects=[]   } = useQuery({ queryKey:["projects"],   queryFn:()=>projectsApi.list() });
  const { data:categories=[] } = useQuery({ queryKey:["categories"], queryFn:categoriesApi.list });
  const { data:allTags=[]    } = useQuery({ queryKey:["tags"],        queryFn:tagsApi.list });

  const inv = () => {
    qc.invalidateQueries({queryKey:["tasks"]});
    qc.invalidateQueries({queryKey:["dashboard"]});
    qc.invalidateQueries({queryKey:["projects"]});
  };
  const invMeta = () => {
    qc.invalidateQueries({queryKey:["tags"]});
    qc.invalidateQueries({queryKey:["categories"]});
  };

  const handleCreateTag = async (name:string, color:string) => {
    const tag = await tagsApi.create({name, color});
    invMeta();
    return tag;
  };
  const handleCreateCategory = async (name:string, color:string, icon?:string) => {
    const cat = await categoriesApi.create({name, color, icon});
    invMeta();
    return cat;
  };

  const payload = () => {
    // Always send a full ISO datetime string so FastAPI's Optional[datetime] can parse it.
    // A bare "YYYY-MM-DD" is rejected by Pydantic datetime — append T00:00:00 when no time given.
    let due_date: string | undefined;
    if (dueDate && dueTime) {
      due_date = `${dueDate}T${dueTime}:00`;
    } else if (dueDate) {
      due_date = `${dueDate}T00:00:00`;
    }
    return {
      title: title.trim(),
      description: description.trim() || undefined,
      notes: notes.trim() || undefined,
      status,
      priority,
      importance,
      difficulty,
      due_date,
      time_estimate_minutes: timeEst ? parseInt(timeEst) : undefined,
      project_id: selProject || undefined,
      category_id: selCategory || undefined,
      tag_ids: selTagIds,
      show_in_daily: true,
    };
  };

  const createMut = useMutation({
    mutationFn: async () => {
      const parent = await tasksApi.create({...payload(), parent_id: parentId});
      for (const sub of pendingSubtasks) {
        await tasksApi.create({ title:sub.title, status:sub.status, priority:sub.priority, importance:sub.importance, difficulty:sub.difficulty, time_estimate_minutes:sub.timeEst?parseInt(sub.timeEst):undefined, parent_id:parent.id, project_id:selProject||undefined, tag_ids:[], show_in_daily:true });
      }
      return parent;
    },
    onSuccess: () => { inv(); toast.success("Order posted!"); onClose(); },
    onError: (e:any) => { toast.error(`Save failed: ${e?.response?.data?.detail ?? e?.message ?? "unknown"}`); },
  });

  const updateMut = useMutation({
    mutationFn: () => tasksApi.update(task!.id, payload()),
    onSuccess: () => { inv(); toast.success("Updated!"); onClose(); },
    onError: (e:any) => { toast.error(`Save failed: ${e?.response?.data?.detail ?? e?.message ?? "unknown"}`); },
  });
  const completeMut = useMutation({ mutationFn:()=>tasksApi.complete(task!.id), onSuccess:()=>{ triggerCelebration({...task!,focus_score:focusScore,importance,difficulty},calcPoints({focus_score:focusScore})); inv(); onClose(); } });
  const deleteMut   = useMutation({ mutationFn:()=>tasksApi.delete(task!.id), onSuccess:()=>{inv();toast.success("Deleted");onClose();}, onError:(e:any)=>{toast.error(`Delete failed: ${e?.response?.data?.detail??e?.message??"unknown"}`);} });

  const handleTimer = () => { if(isThisRunning){stop();}else{if(task){setActiveTimer(null,task);start({task_id:task.id});}} };

  const resetDraft  = () => { setDraftTitle(""); setDraftImportance(3); setDraftDifficulty(3); setDraftTimeEst(""); setDraftStatus("today"); setAddingDraft(false); };
  const commitDraft = () => {
    if (!draftTitle.trim()) return;
    setPendingSubtasks(prev=>[...prev,{ _id:Math.random().toString(36).slice(2), title:draftTitle.trim(), priority:impToPriority(draftImportance), importance:draftImportance, difficulty:draftDifficulty, timeEst:draftTimeEst, status:draftStatus }]);
    setDraftTitle("");
  };

  if (!open) return null;

  const draftFS = draftImportance * draftDifficulty;
  const subtasks = task?.subtasks ?? [];
  const isSubtaskItself = !!(parentId || task?.parent_id);

  return (
    <>
      <div className="modal-backdrop" onClick={e=>e.target===e.currentTarget&&onClose()}>
        <div style={{width:"100%",maxWidth:640,maxHeight:"92vh",display:"flex",flexDirection:"column",background:"#2a4a3a",border:`3px solid ${pColor}`,boxShadow:`0 0 40px rgba(0,0,0,0.8), 0 0 0 1px rgba(0,0,0,0.5)`,animation:"slideup 0.2s ease-out"}}>
          <div style={{height:3,background:`linear-gradient(90deg,transparent,${pColor},transparent)`}}/>

          {/* Header */}
          <div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 16px",borderBottom:`2px solid #1e3629`,background:"#1e3629",flexShrink:0}}>
            <div style={{padding:"3px 10px",border:`1px solid ${pColor}`,color:pColor,fontSize:10,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",fontFamily:"'Oswald',Arial,sans-serif",flexShrink:0,minWidth:64,textAlign:"center"}}>{urgLabel}</div>
            <input value={title} onChange={e=>setTitle(e.target.value)}
              placeholder={isSubtaskItself ? "Subtask title…" : "Order title…"}
              autoFocus={!isEdit}
              style={{flex:1,background:"transparent",border:"none",fontSize:18,fontWeight:700,letterSpacing:"0.04em",textTransform:"uppercase",color:"#f5f0e0",caretColor:"#e8a820",padding:0,fontFamily:"'Oswald',Arial,sans-serif"}}
              onKeyDown={e=>e.key==="Enter"&&!isEdit&&title.trim()&&createMut.mutate()}/>
            <button type="button" onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",color:"rgba(245,240,224,0.3)",padding:4}} onMouseEnter={e=>(e.currentTarget.style.color="rgba(245,240,224,0.8)")} onMouseLeave={e=>(e.currentTarget.style.color="rgba(245,240,224,0.3)")}><X size={16}/></button>
          </div>

          {/* Body */}
          <div style={{flex:1,overflowY:"auto",padding:"16px",display:"flex",flexDirection:"column",gap:14}}>

            {/* Row 1: Status + Due Date + Time */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
              <div style={FIELD}>{SHEAD("Status")}
                <select value={status} onChange={e=>setStatus(e.target.value as TaskStatus)} style={INP}>
                  <option value="inbox">Inbox</option>
                  <option value="today">Today</option>
                  <option value="upcoming">Upcoming</option>
                  <option value="someday">Someday</option>
                  <option value="done">Done</option>
                </select>
              </div>
              <div style={FIELD}>{SHEAD("Due Date")}<input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)} style={INP}/></div>
              <div style={FIELD}>{SHEAD("Due Time")}<input type="time" value={dueTime} onChange={e=>setDueTime(e.target.value)} style={INP}/></div>
            </div>

            {/* Row 2: Importance + Difficulty */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
              <Stars value={importance} onChange={setImportance} color={LABEL_COLOR[urgLabel]} label="Importance" sublabel={urgLabel}/>
              <Stars value={difficulty} onChange={setDifficulty} color="#d94040" label="Difficulty"/>
            </div>

            {/* Row 3: Time Estimate */}
            <div style={FIELD}>{SHEAD("Time Estimate (min)")}<input type="number" min="0" step="5" value={timeEst} onChange={e=>setTimeEst(e.target.value)} placeholder="e.g. 30" style={INP}/></div>

            {/* Row 4: Project */}
            <div style={FIELD}>{SHEAD("Project")}
              <select value={selProject} onChange={e=>setSelProject(e.target.value)} style={INP}>
                <option value="">— None —</option>
                {projects.map((p:any)=>(<option key={p.id} value={p.id}>{p.title}</option>))}
              </select>
            </div>

            {/* Row 5: Category */}
            <div style={FIELD}>{SHEAD("Category")}
              <CategoryPicker selCategory={selCategory} setSelCategory={setSelCategory} categories={categories} onCreateCategory={handleCreateCategory}/>
            </div>

            {/* Row 6: Tags */}
            <div style={FIELD}>{SHEAD("Tags")}
              <TagPicker selTagIds={selTagIds} setSelTagIds={setSelTagIds} allTags={allTags} onCreateTag={handleCreateTag}/>
            </div>

            {/* Row 7: Description */}
            <div style={FIELD}>{SHEAD("Description")}<textarea value={description} onChange={e=>setDescription(e.target.value)} rows={3} placeholder="Notes, context, links…" style={{...INP,resize:"vertical",minHeight:72}}/></div>

            {/* Row 8: Notes */}
            <div style={FIELD}>{SHEAD("Notes")}<textarea value={notes} onChange={e=>setNotes(e.target.value)} rows={2} placeholder="Quick notes…" style={{...INP,resize:"vertical",minHeight:52}}/></div>

            {/* Subtasks (edit mode only, non-subtask tasks) */}
            {!isSubtaskItself && (
              <div style={FIELD}>
                {SHEAD(`Subtasks${subtasks.length+pendingSubtasks.length>0?` (${subtasks.length+pendingSubtasks.length})`:""}`)} 
                {/* Existing subtasks */}
                {subtasks.length > 0 && (
                  <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:6}}>
                    {subtasks.map((sub:any)=>(
                      <div key={sub.id} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 10px",background:"rgba(0,0,0,0.2)",border:"1px solid rgba(245,240,224,0.08)"}}>
                        <div style={{width:6,height:6,borderRadius:"50%",background:sub.status==="done"?"#4a8a5a":"rgba(245,240,224,0.2)",flexShrink:0}}/>
                        <span style={{flex:1,fontSize:12,color:sub.status==="done"?"rgba(245,240,224,0.3)":"#f5f0e0",textDecoration:sub.status==="done"?"line-through":"none"}}>{sub.title}</span>
                        <span style={{fontSize:9,color:"rgba(245,240,224,0.3)",letterSpacing:"0.1em"}}>{sub.status.toUpperCase()}</span>
                      </div>
                    ))}
                  </div>
                )}
                {/* Pending new subtasks */}
                {pendingSubtasks.length > 0 && (
                  <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:6}}>
                    {pendingSubtasks.map(sub=>(
                      <div key={sub._id} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 10px",background:"rgba(232,168,32,0.05)",border:"1px solid rgba(232,168,32,0.15)"}}>
                        <div style={{width:6,height:6,borderRadius:"50%",background:"rgba(232,168,32,0.4)",flexShrink:0}}/>
                        <span style={{flex:1,fontSize:12,color:"rgba(245,240,224,0.8)"}}>{sub.title}</span>
                        <span style={{fontSize:9,color:"rgba(232,168,32,0.4)",letterSpacing:"0.1em"}}>NEW</span>
                        <button type="button" onClick={()=>setPendingSubtasks(p=>p.filter(s=>s._id!==sub._id))} style={{background:"none",border:"none",cursor:"pointer",color:"rgba(245,240,224,0.2)",fontSize:12,padding:"0 2px"}}>×</button>
                      </div>
                    ))}
                  </div>
                )}
                {/* Add subtask button / inline form */}
                {isEdit ? (
                  <button type="button" className="btn btn-white" onClick={()=>setSubModalOpen(true)} style={{alignSelf:"flex-start",padding:"4px 10px",fontSize:10}}><Plus size={10}/>Add Subtask</button>
                ) : (
                  addingDraft ? (
                    <div style={{padding:"10px 12px",background:"rgba(0,0,0,0.2)",border:"1px solid rgba(232,168,32,0.15)",display:"flex",flexDirection:"column",gap:8}}>
                      <input value={draftTitle} onChange={e=>setDraftTitle(e.target.value)} autoFocus placeholder="Subtask title…"
                        style={{padding:"6px 10px",fontSize:13,background:"rgba(0,0,0,0.25)",border:"1px solid rgba(245,240,224,0.1)",color:"#f5f0e0",caretColor:"#e8a820",fontFamily:"'Oswald',Arial,sans-serif",letterSpacing:"0.04em"}}
                        onKeyDown={e=>{ if(e.key==="Enter"&&draftTitle.trim()) commitDraft(); if(e.key==="Escape") resetDraft(); }}/>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                        <Stars value={draftImportance} onChange={setDraftImportance} color={LABEL_COLOR[impToLabel(draftImportance)]} label="Importance" sublabel={impToLabel(draftImportance)}/>
                        <Stars value={draftDifficulty} onChange={setDraftDifficulty} color="#d94040" label="Difficulty"/>
                      </div>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                        <span style={{fontSize:9,color:"rgba(245,240,224,0.3)",letterSpacing:"0.1em"}}>FS: {draftFS} · Enter to add, Esc to cancel</span>
                        <div style={{display:"flex",gap:6}}>
                          <button type="button" className="btn btn-red" onClick={resetDraft} style={{padding:"3px 10px"}}>Done</button>
                          <button type="button" className="btn btn-gold" onClick={commitDraft} disabled={!draftTitle.trim()} style={{padding:"3px 10px"}}>+ Add</button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="btn btn-white" onClick={()=>setAddingDraft(true)} style={{alignSelf:"flex-start",padding:"4px 10px",fontSize:10}}><Plus size={10}/>Add Subtask</button>
                  )
                )}
              </div>
            )}

            {isEdit&&isThisRunning&&(
              <div style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",background:"rgba(217,64,64,0.08)",border:"1px solid rgba(217,64,64,0.3)"}}>
                <div className="live-dot"/>
                <span style={{fontSize:12,fontWeight:600,letterSpacing:"0.06em",color:"#d94040"}}>Timer running</span>
                <span className="timer-pulse" style={{marginLeft:"auto",fontFamily:"'Oswald',Arial,sans-serif",fontSize:20,fontWeight:700,color:"#d94040"}}>{formatDuration(elapsedSeconds)}</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 16px",borderTop:"2px solid #1e3629",background:"#1e3629",flexShrink:0,flexWrap:"wrap"}}>
            {isEdit&&(<button type="button" className={`btn ${isThisRunning?"btn-red":"btn-white"}`} onClick={handleTimer}>{isThisRunning?<><Square size={11} style={{fill:"currentColor"}}/>Stop</>:<><Play size={11} style={{fill:"currentColor"}}/>Timer</>}</button>)}
            {isEdit&&task?.status!=="done"&&(<button type="button" className="btn btn-gold" onClick={()=>setCompletionOpen(true)} disabled={completeMut.isPending}><Check size={11}/>Complete</button>)}
            <div style={{flex:1}}/>
            {isEdit&&(<button type="button" className="btn btn-red" onClick={()=>confirm("Delete this task?")&&deleteMut.mutate()}><Trash2 size={11}/></button>)}
            <button type="button" onClick={onClose} style={{padding:"5px 12px",background:"rgba(0,0,0,0.2)",border:"1px solid rgba(245,240,224,0.1)",color:"rgba(245,240,224,0.4)",fontSize:10,fontWeight:600,letterSpacing:"0.12em",textTransform:"uppercase",cursor:"pointer",fontFamily:"'Oswald',Arial,sans-serif"}}>Cancel</button>
            <button type="button" className="btn btn-solid-gold" onClick={()=>title.trim()&&(isEdit?updateMut.mutate():createMut.mutate())} disabled={!title.trim()||createMut.isPending||updateMut.isPending}>
              {createMut.isPending||updateMut.isPending?"Saving…":isEdit?"Save Changes":"Post Order"}
            </button>
          </div>
        </div>
      </div>

      {isEdit && task && (
        <TaskModal open={subModalOpen} onClose={()=>{ setSubModalOpen(false); inv(); }} parentId={task.id} projectId={selProject||undefined} defaultStatus="today"/>
      )}

      {completionOpen && task && (
        <CompletionDialog
          task={task}
          onClose={() => setCompletionOpen(false)}
          onDone={() => { setCompletionOpen(false); inv(); onClose(); }}
        />
      )}
    </>
  );
}
