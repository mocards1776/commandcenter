import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { habitsApi } from "@/lib/api";
import { HabitRow } from "@/components/habits/HabitRow";
import { HabitModal } from "@/components/habits/HabitModal";
import { Loader2 } from "lucide-react";
import { todayStr } from "@/lib/utils";
export function HabitsPage() {
  const [newOpen,setNewOpen]=useState(false);
  const today=todayStr();
  const { data:habits,isLoading } = useQuery({ queryKey:["habits"], queryFn:()=>habitsApi.list() });
  const done=habits?.filter(h=>h.completions.some((c:any)=>c.completed_date===today)).length??0;
  const total=habits?.length??0;
  const pct=total>0?Math.round((done/total)*100):0;
  return (
    <div>
      <div className="top-bar">
        <span style={{fontSize:18}}>🔥</span>
        <div style={{flex:1,paddingLeft:12}}>
          <div className="top-title">Habits</div>
          <div className="top-date">{done}/{total} enlisted today · {pct}%</div>
        </div>
        <button className="btn btn-gold" onClick={()=>setNewOpen(true)}>+ Enlist New</button>
      </div>
      <div className="stripe"/>
      {total>0&&<div style={{height:4,background:"#162a1c",overflow:"hidden"}}><div style={{height:"100%",width:`${pct}%`,background:"#e8a820",transition:"width 0.7s"}}/></div>}
      <HabitModal open={newOpen} onClose={()=>setNewOpen(false)}/>
      {isLoading?(<div style={{display:"flex",justifyContent:"center",padding:48}}><Loader2 size={20} style={{color:"#e8a820",animation:"spin 1s linear infinite"}}/></div>):habits?.length===0?(
        <div style={{padding:"48px 16px",textAlign:"center"}}>
          <p style={{fontFamily:"'Oswald',Arial,sans-serif",fontSize:11,fontWeight:600,letterSpacing:"0.15em",textTransform:"uppercase",color:"rgba(245,240,224,0.2)"}}>No Habits Enlisted</p>
          <p style={{fontFamily:"'IM Fell English',Georgia,serif",fontStyle:"italic",fontSize:10,marginTop:6,color:"rgba(245,240,224,0.1)"}}>Discipline is the soul of an army — enlist your first habit above</p>
        </div>
      ):habits?.map(h=><HabitRow key={h.id} habit={h} todayStr={today}/>)}
    </div>
  );
}
