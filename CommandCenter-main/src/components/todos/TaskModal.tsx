import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tasksApi, projectsApi, categoriesApi, tagsApi } from "@/lib/api";
import { useActiveTimer } from "@/hooks/useTimer";
import { useTimerStore, useCelebrationStore } from "@/store";
import { calcPoints, formatDuration, formatMinutes } from "@/lib/utils";
import { X, Play, Square, Check, Trash2, Plus } from "lucide-react";
import type { Task, TaskStatus, Priority } from "@/types";
import toast from "react-hot-toast";

function Stars({ value, onChange, color, label }: { value:number; onChange:(n:number)=>void; color:string; label:string }) {
  const [hover, setHover] = useState(0);
  return (
    <div>
      <div style={{fontSize:9,fontWeight:600,letterSpacing:"0.18em",textTransform:"uppercase",color:"rgba(245,240,224,0.35)",marginBottom:4}}>{label}</div>
      <div style={{display:"flex",alignItems:"center",gap:2}}>
        {[1,2,3,4,5].map(n=>(
          <button key={n} type="button" className="star-btn" style={{color:n<=(hover||value)?color:"rgba(245,240,224,0.15)"}} onMouseEnter={()=>setHover(n)} onMouseLeave={()=>setHover(0)} onClick={()=>onChange(n)}>★</button>
        ))}
        <span style={{fontSize:11,fontWeight:700,color,marginLeft:4}}>{hover||value}/5</span>
      </div>
    </div>
  );
}

const FIELD: React.CSSProperties = {display:"flex",flexDirection:"column",gap:4};
const INP: React.CSSProperties = {width:"100%",padding:"9px 10px",fontSize:14};
const SHEAD = (text:string) => <div style={{fontSize:11,fontWeight:600,letterSpacing:"0.18em",textTransform:"uppercase",color:"rgba(232,168,32,0.6)",marginBottom:4}}>{text}</div>;

interface Props { open:boolean; onClose:()=>void; task?:Task|null; projectId?:string; parentId?:string; defaultStatus?:TaskStatus; }

export function TaskModal({ open, onClose, task, projectId, parentId, defaultStatus }: Props) {
  const qc = useQueryClient();
  const isEdit = !!task;
  const { isRunning, activeTimer, elapsedSeconds, start, stop } = useActiveTimer();
  const { setActiveTimer } = useTimerStore();
  const { triggerCelebration } = useCelebrationStore();
  const isThisRunning = isRunning && activeTimer?.task_id === task?.id;

  const [title,setTitle]=useState(task?.title??"");
  const [description,setDescription]=useState(task?.description??"");
  const [notes,setNotes]=useState(task?.notes??"");
  const [status,setStatus]=useState<TaskStatus>(task?.status??defaultStatus??"today");
  const [priority,setPriority]=useState<Priority>(task?.priority??"medium");
  const [importance,setImportance]=useState(task?.importance??3);
  const [difficulty,setDifficulty]=useState(task?.difficulty??3);
  const [dueDate,setDueDate]=useState(task?.due_date??"");
  const [timeEst,setTimeEst]=useState(task?.time_estimate_minutes?.toString()??"");
  const [selProject,setSelProject]=useState(task?.project_id??projectId??"");
  const [selCategory,setSelCategory]=useState(task?.category_id??"");
  const [selTagIds,setSelTagIds]=useState<string[]>(task?.tag_ids??[]);
  const [subtaskTitle,setSubtaskTitle]=useState("");
  const [addingSubtask,setAddingSubtask]=useState(false);

  const focusScore = difficulty*importance;
  const pColor = {low:"#4a8a5a",medium:"#f5f0e0",high:"#e8a820",critical:"#d94040"}[priority]??"#e8a820";

  useEffect(()=>{
    if(!open)return;
    setTitle(task?.title??""); setDescription(task?.description??""); setNotes(task?.notes??"");
    setStatus(task?.status??defaultStatus??"today"); setPriority(task?.priority??"medium");
    setImportance(task?.importance??3); setDifficulty(task?.difficulty??3);
    setDueDate(task?.due_date??""); setTimeEst(task?.time_estimate_minutes?.toString()??"");
    setSelProject(task?.project_id??projectId??""); setSelCategory(task?.category_id??"");
    setSelTagIds(task?.tag_ids??[]);
  },[open,task?.id]);

  const { data:projects=[] } = useQuery({ queryKey:["projects"], queryFn:()=>projectsApi.list() });
  const { data:categories=[] } = useQuery({ queryKey:["categories"], queryFn:categoriesApi.list });
  const { data:allTags=[] } = useQuery({ queryKey:["tags"], queryFn:tagsApi.list });

  const inv = () => { qc.invalidateQueries({queryKey:["tasks"]}); qc.invalidateQueries({queryKey:["dashboard"]}); qc.invalidateQueries({queryKey:["projects"]}); };
  const payload = () => ({ title:title.trim(), description:description.trim()||undefined, notes:notes.trim()||undefined, status, priority, importance, difficulty, due_date:dueDate||undefined, time_estimate_minutes:timeEst?parseInt(timeEst):undefined, project_id:selProject||undefined, category_id:selCategory||undefined, tag_ids:selTagIds, show_in_daily:true });

  const createMut = useMutation({ mutationFn:()=>tasksApi.create({...payload(),parent_id:parentId}), onSuccess:()=>{inv();toast.success("Order posted!");onClose();} });
  const updateMut = useMutation({ mutationFn:()=>tasksApi.update(task!.id,payload()), onSuccess:()=>{inv();toast.success("Updated!");onClose();} });
  const completeMut = useMutation({ mutationFn:()=>tasksApi.complete(task!.id), onSuccess:()=>{ triggerCelebration({...task!,focus_score:focusScore,importance,difficulty},calcPoints({focus_score:focusScore})); inv(); onClose(); } });
  const deleteMut = useMutation({ mutationFn:()=>tasksApi.delete(task!.id), onSuccess:()=>{inv();toast.success("Deleted");onClose();} });
  const subtaskMut = useMutation({ mutationFn:()=>tasksApi.create({title:subtaskTitle.trim(),status:"inbox",priority:"medium",importance:3,difficulty:3,parent_id:task?.id,project_id:selProject||undefined,tag_ids:[],show_in_daily:true}), onSuccess:()=>{inv();setSubtaskTitle("");setAddingSubtask(false);toast.success("Subtask added!");} });

  const handleTimer = () => { if(isThisRunning){stop();}else{if(task){setActiveTimer(null,task);start({task_id:task.id});}} };

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{width:"100%",maxWidth:640,maxHeight:"92vh",display:"flex",flexDirection:"column",background:"#2a4a3a",border:`3px solid ${pColor}`,boxShadow:`0 0 40px rgba(0,0,0,0.8), 0 0 0 1px rgba(0,0,0,0.5)`,animation:"slideup 0.2s ease-out"}}>
        {/* Gold top stripe */}
        <div style={{height:3,background:`linear-gradient(90deg,transparent,${pColor},transparent)`}}/>

        {/* Header */}
        <div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 16px",borderBottom:`2px solid #1e3629`,background:"#1e3629",flexShrink:0}}>
          <select value={priority} onChange={e=>setPriority(e.target.value as Priority)} style={{background:`rgba(0,0,0,0.3)`,border:`1px solid ${pColor}50`,color:pColor,borderRadius:2,padding:"3px 8px",fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",cursor:"pointer",fontFamily:"'Oswald',Arial,sans-serif"}}>
            {["low","medium","high","critical"].map(p=><option key={p} value={p}>{p.toUpperCase()}</option>)}
          </select>
          <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Order title…" autoFocus={!isEdit}
            style={{flex:1,background:"transparent",border:"none",fontSize:18,fontWeight:700,letterSpacing:"0.04em",textTransform:"uppercase",color:"#f5f0e0",caretColor:"#e8a820",padding:0,fontFamily:"'Oswald',Arial,sans-serif"}}
            onKeyDown={e=>e.key==="Enter"&&!isEdit&&title.trim()&&createMut.mutate()}/>
          <button type="button" onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",color:"rgba(245,240,224,0.3)",padding:4}} onMouseEnter={e=>(e.currentTarget.style.color="#d94040")} onMouseLeave={e=>(e.currentTarget.style.color="rgba(245,240,224,0.3)")}><X size={18}/></button>
        </div>

        {/* Body */}
        <div style={{flex:1,overflowY:"auto",padding:"14px 16px",display:"flex",flexDirection:"column",gap:14}}>

          {/* Row 1: status / due / time */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
            <div style={FIELD}>{SHEAD("Status")}<select value={status} onChange={e=>setStatus(e.target.value as TaskStatus)} style={INP}>{[["inbox","📥 Inbox"],["today","📌 Today"],["in_progress","⚡ Active"],["waiting","⏳ Waiting"],["done","✅ Done"],["cancelled","🚫 Cancelled"]].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>
            <div style={FIELD}>{SHEAD("Due Date")}<input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)} style={INP}/></div>
            <div style={FIELD}>{SHEAD("Est. (min)")}<input type="number" value={timeEst} onChange={e=>setTimeEst(e.target.value)} placeholder="e.g. 45" min="1" style={INP}/></div>
          </div>

          {/* Stars + Focus Score */}
          <div style={{background:"rgba(0,0,0,0.25)",border:"1px solid #1e3629",padding:"12px 14px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
            <Stars value={importance} onChange={setImportance} color="#e8a820" label="Importance"/>
            <Stars value={difficulty} onChange={setDifficulty} color="#d94040" label="Difficulty"/>
            <div style={{gridColumn:"1/-1",height:1,background:"rgba(232,168,32,0.15)"}}/>
            <div style={{gridColumn:"1/-1",display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:9,fontWeight:600,letterSpacing:"0.18em",textTransform:"uppercase",color:"rgba(245,240,224,0.3)"}}>Focus Score = Importance × (6 − Difficulty)</span>
              <div className="panel panel-sm" style={{marginLeft:"auto",flexShrink:0}}>
                <span className="panel-num" style={{fontSize:22,color:focusScore>=20?"#d94040":focusScore>=12?"#e8a820":"#f5f0e0"}}>{focusScore}</span>
              </div>
            </div>
          </div>

          {/* Description */}
          <div style={FIELD}>{SHEAD("Description")}<textarea value={description} onChange={e=>setDescription(e.target.value)} placeholder="What needs to get done…" rows={2} style={{...INP,resize:"none",lineHeight:1.5}}/></div>

          {/* Project / Category */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div style={FIELD}>{SHEAD("Campaign (Project)")}<select value={selProject} onChange={e=>setSelProject(e.target.value)} style={INP}><option value="">— No Campaign —</option>{projects.map((p:any)=><option key={p.id} value={p.id}>{p.title}</option>)}</select></div>
            <div style={FIELD}>{SHEAD("Category")}<select value={selCategory} onChange={e=>setSelCategory(e.target.value)} style={INP}><option value="">— None —</option>{categories.map((c:any)=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          </div>

          {/* Tags */}
          <div style={FIELD}>
            {SHEAD("Tags")}
            <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:5}}>
              {selTagIds.map(id=>{const tag=allTags.find((t:any)=>t.id===id);return tag?(<span key={id} onClick={()=>setSelTagIds(p=>p.filter(i=>i!==id))} style={{padding:"2px 8px",border:"1px solid rgba(232,168,32,0.3)",color:"#e8a820",fontSize:10,fontWeight:600,letterSpacing:"0.1em",textTransform:"uppercase",cursor:"pointer",fontFamily:"'Oswald',Arial,sans-serif"}}>{tag.name} ×</span>):null;})}
            </div>
            <select value="" onChange={e=>{const v=e.target.value;if(v&&!selTagIds.includes(v))setSelTagIds(p=>[...p,v]);}} style={INP}><option value="">+ Add tag…</option>{allTags.filter((t:any)=>!selTagIds.includes(t.id)).map((t:any)=><option key={t.id} value={t.id}>{t.name}</option>)}</select>
          </div>

          {/* Notes */}
          <div style={FIELD}>{SHEAD("Notes")}<textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Private notes, links, context…" rows={2} style={{...INP,resize:"none",lineHeight:1.5}}/></div>

          {/* Subtasks */}
          {isEdit&&!task?.parent_id&&(
            <div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                <div style={{fontSize:9,fontWeight:600,letterSpacing:"0.18em",textTransform:"uppercase",color:"rgba(232,168,32,0.6)"}}>Subtasks {task.subtasks.length>0&&`· ${task.subtasks.filter(s=>s.status==="done").length}/${task.subtasks.length}`}</div>
                <button type="button" className="btn btn-gold" onClick={()=>setAddingSubtask(true)} style={{padding:"3px 10px"}}><Plus size={11}/>Add</button>
              </div>
              {task.subtasks.map(sub=>(
                <div key={sub.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",marginBottom:3,background:"#1e3629",border:"1px solid rgba(0,0,0,0.3)"}}>
                  <div className={`sb-check ${sub.status==="done"?"done":""}`} style={{cursor:"default"}}>{sub.status==="done"&&"✓"}</div>
                  <span style={{flex:1,fontSize:12,fontWeight:600,letterSpacing:"0.04em",textTransform:"uppercase",color:sub.status==="done"?"rgba(245,240,224,0.3)":"#f5f0e0",textDecoration:sub.status==="done"?"line-through":"none"}}>{sub.title}</span>
                  {sub.time_estimate_minutes&&<span style={{fontSize:9,color:"rgba(245,240,224,0.3)",letterSpacing:"0.08em"}}>{formatMinutes(sub.time_estimate_minutes)}</span>}
                  <span style={{fontSize:9,color:"rgba(232,168,32,0.5)",letterSpacing:"0.08em"}}>FS:{sub.focus_score}</span>
                </div>
              ))}
              {task.subtasks.length===0&&!addingSubtask&&<p style={{fontFamily:"'IM Fell English',Georgia,serif",fontStyle:"italic",fontSize:11,color:"rgba(245,240,224,0.2)",padding:"8px 0"}}>No subtasks — break this into steps</p>}
              {addingSubtask&&(
                <div style={{display:"flex",gap:6,marginTop:6}}>
                  <input value={subtaskTitle} onChange={e=>setSubtaskTitle(e.target.value)} placeholder="Subtask title…" autoFocus style={{flex:1,padding:"6px 10px",fontSize:12}} onKeyDown={e=>{if(e.key==="Enter"&&subtaskTitle.trim())subtaskMut.mutate();if(e.key==="Escape"){setAddingSubtask(false);setSubtaskTitle("");}}}/>
                  <button type="button" className="btn btn-gold" onClick={()=>subtaskTitle.trim()&&subtaskMut.mutate()}>Save</button>
                  <button type="button" className="btn btn-red" onClick={()=>{setAddingSubtask(false);setSubtaskTitle("");}}>✕</button>
                </div>
              )}
            </div>
          )}

          {/* Timer display */}
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
          {isEdit&&task?.status!=="done"&&(<button type="button" className="btn btn-gold" onClick={()=>completeMut.mutate()} disabled={completeMut.isPending}><Check size={11}/>Complete</button>)}
          <div style={{flex:1}}/>
          {isEdit&&(<button type="button" className="btn btn-red" onClick={()=>confirm("Delete this task?")&&deleteMut.mutate()}><Trash2 size={11}/></button>)}
          <button type="button" onClick={onClose} style={{padding:"5px 12px",background:"rgba(0,0,0,0.2)",border:"1px solid rgba(245,240,224,0.1)",color:"rgba(245,240,224,0.4)",fontSize:10,fontWeight:600,letterSpacing:"0.12em",textTransform:"uppercase",cursor:"pointer",fontFamily:"'Oswald',Arial,sans-serif"}}>Cancel</button>
          <button type="button" className="btn btn-solid-gold" onClick={()=>title.trim()&&(isEdit?updateMut.mutate():createMut.mutate())} disabled={!title.trim()||createMut.isPending||updateMut.isPending}>
            {createMut.isPending||updateMut.isPending?"Saving…":isEdit?"Save Changes":"Post Order"}
          </button>
        </div>
      </div>
    </div>
  );
}
