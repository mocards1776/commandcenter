import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { habitsApi } from "@/lib/api";
import { X, Trash2 } from "lucide-react";
import type { Habit } from "@/types";
import toast from "react-hot-toast";
const ICONS = ["🔥","💪","📖","🧘","🚿","🏃","💧","🥗","😴","🎯","⭐","🇺🇸","☀️","🏋️","✍️","🎵"];
const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const INP: React.CSSProperties = {width:"100%",padding:"7px 10px",fontSize:12};
const SHEAD = (t:string) => <div style={{fontSize:9,fontWeight:600,letterSpacing:"0.18em",textTransform:"uppercase",color:"rgba(232,168,32,0.6)",marginBottom:4}}>{t}</div>;
interface Props { open:boolean; onClose:()=>void; habit?:Habit|null; }
export function HabitModal({ open, onClose, habit }: Props) {
  const qc = useQueryClient();
  const isEdit = !!habit;
  const [name,setName]=useState(habit?.name??"");
  const [description,setDescription]=useState(habit?.description??"");
  const [icon,setIcon]=useState(habit?.icon??"🔥");
  const [color,setColor]=useState(habit?.color??"#e8a820");
  const [frequency,setFrequency]=useState<string>(habit?.frequency??"daily");
  const [customDays,setCustomDays]=useState<number[]>(habit?.custom_days??[1,2,3,4,5]);
  const [targetMinutes,setTargetMinutes]=useState(habit?.target_minutes?.toString()??"");
  const [importance,setImportance]=useState(habit?.importance??3);
  const [difficulty,setDifficulty]=useState(habit?.difficulty??2);
  useEffect(()=>{
    if(!open)return;
    setName(habit?.name??""); setDescription(habit?.description??""); setIcon(habit?.icon??"🔥");
    setColor(habit?.color??"#e8a820"); setFrequency(habit?.frequency??"daily");
    setCustomDays(habit?.custom_days??[1,2,3,4,5]); setTargetMinutes(habit?.target_minutes?.toString()??"");
    setImportance(habit?.importance??3); setDifficulty(habit?.difficulty??2);
  },[open,habit?.id]);
  const inv = () => { qc.invalidateQueries({queryKey:["habits"]}); qc.invalidateQueries({queryKey:["dashboard"]}); };
  const payload = () => ({ name:name.trim(), description:description.trim()||undefined, icon, color, frequency:frequency as any, custom_days:frequency==="custom"?customDays:undefined, target_minutes:targetMinutes?parseInt(targetMinutes):undefined, importance, difficulty });
  const createMut = useMutation({ mutationFn:()=>habitsApi.create(payload()), onSuccess:()=>{inv();toast.success("Habit enlisted!");onClose();} });
  const updateMut = useMutation({ mutationFn:()=>habitsApi.update(habit!.id,payload()), onSuccess:()=>{inv();toast.success("Habit updated!");onClose();} });
  const deleteMut = useMutation({ mutationFn:()=>habitsApi.delete(habit!.id), onSuccess:()=>{inv();toast.success("Habit removed");onClose();} });
  const toggleDay = (d:number) => setCustomDays(p=>p.includes(d)?p.filter(x=>x!==d):[...p,d].sort());
  if(!open)return null;
  return (
    <div className="modal-backdrop" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{width:"100%",maxWidth:520,maxHeight:"90vh",display:"flex",flexDirection:"column",background:"#2a4a3a",border:"3px solid #e8a820",boxShadow:"0 0 40px rgba(0,0,0,0.8)",animation:"slideup 0.2s ease-out"}}>
        <div style={{height:3,background:"linear-gradient(90deg,transparent,#e8a820,transparent)"}}/>
        {/* Header */}
        <div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 16px",borderBottom:"2px solid #1e3629",background:"#1e3629",flexShrink:0}}>
          <span style={{fontSize:20}}>{icon}</span>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="Habit name…" autoFocus={!isEdit} style={{flex:1,background:"transparent",border:"none",fontSize:18,fontWeight:700,letterSpacing:"0.04em",textTransform:"uppercase",color:"#f5f0e0",caretColor:"#e8a820",padding:0,fontFamily:"'Oswald',Arial,sans-serif"}}/>
          <button type="button" onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",color:"rgba(245,240,224,0.3)",padding:4}} onMouseEnter={e=>(e.currentTarget.style.color="#d94040")} onMouseLeave={e=>(e.currentTarget.style.color="rgba(245,240,224,0.3)")}><X size={18}/></button>
        </div>
        {/* Body */}
        <div style={{flex:1,overflowY:"auto",padding:"14px 16px",display:"flex",flexDirection:"column",gap:14}}>
          {/* Icon picker */}
          <div>
            {SHEAD("Icon")}
            <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
              {ICONS.map(i=><button key={i} type="button" onClick={()=>setIcon(i)} style={{width:36,height:36,borderRadius:2,fontSize:16,cursor:"pointer",background:icon===i?"rgba(232,168,32,0.2)":"rgba(0,0,0,0.2)",border:`1px solid ${icon===i?"rgba(232,168,32,0.5)":"rgba(232,168,32,0.1)"}`,transition:"all 0.1s"}}>{i}</button>)}
            </div>
          </div>
          {/* Frequency */}
          <div>
            {SHEAD("Frequency")}
            <select value={frequency} onChange={e=>setFrequency(e.target.value)} style={INP}>
              <option value="daily">Daily</option>
              <option value="weekdays">Weekdays (Mon–Fri)</option>
              <option value="weekends">Weekends (Sat–Sun)</option>
              <option value="weekly">Weekly</option>
              <option value="custom">Custom days…</option>
            </select>
          </div>
          {/* Custom days */}
          {frequency==="custom"&&(
            <div>
              {SHEAD("Days of week")}
              <div style={{display:"flex",gap:5}}>
                {DAYS.map((d,i)=><button key={d} type="button" onClick={()=>toggleDay(i)} style={{flex:1,padding:"6px 4px",borderRadius:2,border:`1px solid ${customDays.includes(i)?"rgba(232,168,32,0.5)":"rgba(232,168,32,0.1)"}`,background:customDays.includes(i)?"rgba(232,168,32,0.15)":"rgba(0,0,0,0.2)",color:customDays.includes(i)?"#e8a820":"rgba(245,240,224,0.3)",fontSize:9,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",cursor:"pointer",fontFamily:"'Oswald',Arial,sans-serif"}}>{d}</button>)}
              </div>
            </div>
          )}
          {/* Description + target */}
          <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:10,alignItems:"start"}}>
            <div style={{display:"flex",flexDirection:"column",gap:4}}>
              {SHEAD("Description")}
              <textarea value={description} onChange={e=>setDescription(e.target.value)} placeholder="What does this habit involve…" rows={2} style={{...INP,resize:"none",lineHeight:1.5}}/>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:4,minWidth:90}}>
              {SHEAD("Target (min)")}
              <input type="number" value={targetMinutes} onChange={e=>setTargetMinutes(e.target.value)} placeholder="e.g. 30" min="1" style={{...INP}}/>
            </div>
          </div>
          {/* Importance / Difficulty */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div>
              {SHEAD("Importance")}
              <div style={{display:"flex",gap:3,marginTop:4}}>
                {[1,2,3,4,5].map(n=><button key={n} type="button" className="star-btn" style={{color:n<=importance?"#e8a820":"rgba(245,240,224,0.15)"}} onClick={()=>setImportance(n)}>★</button>)}
              </div>
            </div>
            <div>
              {SHEAD("Difficulty")}
              <div style={{display:"flex",gap:3,marginTop:4}}>
                {[1,2,3,4,5].map(n=><button key={n} type="button" className="star-btn" style={{color:n<=difficulty?"#d94040":"rgba(245,240,224,0.15)"}} onClick={()=>setDifficulty(n)}>★</button>)}
              </div>
            </div>
          </div>
          {/* Color */}
          <div>
            {SHEAD("Accent Color")}
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <input type="color" value={color} onChange={e=>setColor(e.target.value)} style={{width:44,height:36,borderRadius:2,border:"1px solid rgba(232,168,32,0.3)",cursor:"pointer",background:"transparent"}}/>
              <span style={{fontFamily:"'Oswald',Arial,sans-serif",fontSize:11,color:"rgba(245,240,224,0.4)",letterSpacing:"0.06em"}}>{color}</span>
              <div style={{width:36,height:36,borderRadius:2,background:color,border:"1px solid rgba(0,0,0,0.4)"}}/>
            </div>
          </div>
          {/* Stats if editing */}
          {isEdit&&habit&&(
            <div style={{background:"rgba(0,0,0,0.25)",border:"1px solid #1e3629",padding:"10px 12px"}}>
              {SHEAD("Stats")}
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginTop:6}}>
                {[{l:"Total completions",v:habit.completions.length},{l:"Focus score",v:`${importance*(6-difficulty)}`},{l:"Streak",v:`${habit.completions.length}🔥`}].map(({l,v})=>(
                  <div key={l} style={{textAlign:"center"}}>
                    <div style={{fontFamily:"'Oswald',Arial,sans-serif",fontSize:9,fontWeight:600,letterSpacing:"0.12em",textTransform:"uppercase",color:"rgba(245,240,224,0.3)",marginBottom:3}}>{l}</div>
                    <div className="panel panel-sm" style={{margin:"0 auto"}}><span className="panel-num gold" style={{fontSize:16}}>{v}</span></div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        {/* Footer */}
        <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 16px",borderTop:"2px solid #1e3629",background:"#1e3629",flexShrink:0}}>
          {isEdit&&<button type="button" className="btn btn-red" onClick={()=>confirm("Remove this habit?")&&deleteMut.mutate()}><Trash2 size={11}/></button>}
          <div style={{flex:1}}/>
          <button type="button" onClick={onClose} style={{padding:"5px 12px",background:"rgba(0,0,0,0.2)",border:"1px solid rgba(245,240,224,0.1)",color:"rgba(245,240,224,0.4)",fontSize:10,fontWeight:600,letterSpacing:"0.12em",textTransform:"uppercase",cursor:"pointer",fontFamily:"'Oswald',Arial,sans-serif"}}>Cancel</button>
          <button type="button" className="btn btn-solid-gold" onClick={()=>name.trim()&&(isEdit?updateMut.mutate():createMut.mutate())} disabled={!name.trim()||createMut.isPending||updateMut.isPending}>
            {createMut.isPending||updateMut.isPending?"Saving…":isEdit?"Save Changes":"Enlist Habit"}
          </button>
        </div>
      </div>
    </div>
  );
}
