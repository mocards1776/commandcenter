import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { tasksApi } from "@/lib/api";
import { TaskCard } from "@/components/todos/TaskCard";
import { QuickAdd } from "@/components/todos/QuickAdd";
import { Loader2 } from "lucide-react";
import type { TaskStatus } from "@/types";
import { useTimerStore } from "@/store";

const FILTERS:[string,string][] = [["today","📌 Today"],["inbox","📥 Inbox"],["in_progress","⚡ Active"],["waiting","⏳ Waiting"],["all","All"],["done","✅ Done"]];

export function TodosPage() {
  const [filter,setFilter]=useState("today"); const [search,setSearch]=useState("");
  const { activeTimer } = useTimerStore();

  const { data:tasks,isLoading } = useQuery({
    queryKey:["tasks",filter,search],
    queryFn:()=>{
      const p:any={};
      // "today" tab shows both today + in_progress tasks so nothing falls through the cracks
      if(filter==="today") p.status="today,in_progress";
      else if(filter!=="all") p.status=filter;
      if(search) p.search=search;
      return tasksApi.list(p);
    },
    refetchInterval:30_000
  });

  const filtered = tasks?.filter(t=>filter==="done"?t.status==="done":t.status!=="done")??[];
  const activeTaskId = activeTimer?.task_id;
  const visible = activeTaskId
    ? [...filtered].sort((a,b) => (a.id===activeTaskId ? -1 : b.id===activeTaskId ? 1 : 0))
    : filtered;

  return (
    <div>
      <div className="top-bar"><span style={{fontSize:18}}>🇺🇸</span><div className="top-title">Daily Todos</div><span style={{fontSize:9,fontWeight:600,letterSpacing:"0.15em",textTransform:"uppercase",color:"rgba(255,255,255,0.3)"}}>{visible.length} orders</span></div>
      <div className="stripe"/>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",padding:"8px 12px",background:"#1e3629",borderBottom:"2px solid #162a1c"}}>
        {FILTERS.map(([id,label])=>(
          <button key={id} onClick={()=>setFilter(id)} style={{padding:"4px 10px",border:`1px solid ${filter===id?"rgba(232,168,32,0.5)":"rgba(232,168,32,0.15)"}`,background:filter===id?"rgba(232,168,32,0.1)":"transparent",color:filter===id?"#e8a820":"rgba(245,240,224,0.3)",fontFamily:"'Oswald',Arial,sans-serif",fontSize:10,fontWeight:600,letterSpacing:"0.1em",textTransform:"uppercase",cursor:"pointer",borderRadius:2,transition:"all 0.1s"}}>{label}</button>
        ))}
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search…" style={{marginLeft:"auto",padding:"4px 10px",fontSize:11,width:130}}/>
      </div>
      <QuickAdd defaultStatus={filter==="all"||filter==="done"?"today":filter as TaskStatus}/>
      {isLoading?(<div style={{display:"flex",justifyContent:"center",padding:48}}><Loader2 size={20} style={{color:"#e8a820",animation:"spin 1s linear infinite"}}/></div>):visible.length===0?(
        <div style={{padding:"48px 16px",textAlign:"center"}}>
          <p style={{fontFamily:"'Oswald',Arial,sans-serif",fontSize:11,fontWeight:600,letterSpacing:"0.15em",textTransform:"uppercase",color:"rgba(245,240,224,0.2)"}}>No Tasks In This Category</p>
          <p style={{fontFamily:"'IM Fell English',Georgia,serif",fontStyle:"italic",fontSize:10,marginTop:6,color:"rgba(245,240,224,0.1)"}}>Post a new order above to begin</p>
        </div>
      ):visible.map(t=><TaskCard key={t.id} task={t}/>)}
    </div>
  );
}
