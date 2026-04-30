import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { habitsApi } from "@/lib/api";
import { HabitModal } from "./HabitModal";
import type { Habit } from "@/types";
import toast from "react-hot-toast";

interface Props { habit: Habit; todayStr: string; }

function fmtTime(h:number, m:number):string {
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2,"0")} ${ampm}`;
}

export function HabitRow({ habit, todayStr }: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const qc = useQueryClient();
  const isDone = habit.completions.some(c => c.completed_date === todayStr);
  const last7 = Array.from({length:7},(_,i)=>{
    const d=new Date();
    d.setDate(d.getDate()-(6-i));
    const ds=d.toISOString().split("T")[0];
    return{date:ds,done:habit.completions.some(c=>c.completed_date===ds),isToday:ds===todayStr};
  });
  const completeMut = useMutation({
    mutationFn:()=>habitsApi.complete(habit.id,{completed_date:todayStr}),
    onSuccess:()=>{
      qc.invalidateQueries({queryKey:["habits"]});
      qc.invalidateQueries({queryKey:["dashboard"]});
      toast.success(`${habit.name} ✓`,{icon:"🔥"});
    }
  });
  const uncompleteMut = useMutation({
    mutationFn:()=>habitsApi.uncomplete(habit.id,todayStr),
    onSuccess:()=>qc.invalidateQueries({queryKey:["habits"]})
  });

  const timeStr = (habit.time_hour != null)
    ? fmtTime(habit.time_hour, habit.time_minute ?? 0)
    : null;

  return (
    <>
      <div className="habit-row">
        {/* Circular scoreboard checkbox */}
        <button type="button"
          className={`sb-check ${isDone?"done":""}`}
          onClick={e=>{e.stopPropagation();isDone?uncompleteMut.mutate():completeMut.mutate();}}
          title={isDone?"Mark incomplete":"Mark complete"}>
          {isDone&&"✓"}
        </button>
        {/* Name + time — click to open modal */}
        <div style={{flex:1,cursor:"pointer",display:"flex",alignItems:"center",gap:6}} onClick={()=>setModalOpen(true)}>
          {habit.icon&&<span style={{fontSize:12}}>{habit.icon}</span>}
          <span className={`habit-name ${isDone?"done":""}`}>{habit.name}</span>
          {timeStr&&<span style={{fontFamily:"'Oswald',Arial,sans-serif",fontSize:9,fontWeight:600,color:"rgba(232,168,32,0.45)",letterSpacing:"0.08em",marginLeft:2}}>{timeStr}</span>}
        </div>
        {/* 7-day history — circles */}
        <div className="hdots">
          {last7.map(({date,done,isToday})=>(
            <div
              key={date}
              title={date}
              style={{
                width: isToday ? 9 : 6,
                height: isToday ? 9 : 6,
                borderRadius: "50%",
                background: done ? "#e8a820" : "rgba(255,255,255,0.1)",
                boxShadow: done ? "0 0 4px rgba(232,168,32,0.4)" : "none",
                transition: "all 0.15s",
                flexShrink: 0,
              }}
            />
          ))}
        </div>
        <span style={{fontFamily:"'Oswald',Arial,sans-serif",fontSize:10,fontWeight:600,color:"rgba(232,168,32,0.4)",marginLeft:4}}>{habit.completions.length}🔥</span>
      </div>
      <HabitModal open={modalOpen} onClose={()=>setModalOpen(false)} habit={habit}/>
    </>
  );
}
