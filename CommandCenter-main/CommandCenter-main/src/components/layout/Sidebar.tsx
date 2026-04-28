import { LayoutDashboard,CheckSquare,FolderKanban,Flame,Calendar,Brain,StickyNote,Users,BarChart3,Trophy,Focus,ChevronLeft,ChevronRight } from "lucide-react";
import { useUIStore } from "@/store";
const NAV = [
  {id:"dashboard",label:"Dashboard",icon:LayoutDashboard},{id:"todos",label:"Daily Todos",icon:CheckSquare},
  {id:"projects",label:"Projects",icon:FolderKanban},{id:"habits",label:"Habits",icon:Flame},
  {id:"timeblock",label:"Time Blocks",icon:Calendar},{id:"focus",label:"Focus Mode",icon:Focus},
  {id:"braindump",label:"AI Braindump",icon:Brain},{id:"notes",label:"Notes",icon:StickyNote},
  {id:"crm",label:"People CRM",icon:Users},{id:"stats",label:"Stats",icon:BarChart3},{id:"sports",label:"Sports",icon:Trophy},
];
export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar, activePage, setActivePage } = useUIStore();
  const w = sidebarCollapsed ? 48 : 200;
  return (
    <aside style={{ position:"fixed",left:0,top:0,height:"100%",width:w,zIndex:40,background:"#1a2f22",borderRight:"4px solid #e8a820",display:"flex",flexDirection:"column",transition:"width 0.25s ease",overflow:"hidden" }}>
      <div style={{ height:56,display:"flex",alignItems:"center",justifyContent:sidebarCollapsed?"center":"space-between",padding:"0 10px",borderBottom:"4px solid #e8a820",background:"#162a1c",flexShrink:0 }}>
        {!sidebarCollapsed&&<div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:18}}>🇺🇸</span><div><div style={{fontFamily:"'Oswald',Arial,sans-serif",fontSize:12,fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",color:"#f5f0e0",lineHeight:1}}>Command</div><div style={{fontFamily:"'Oswald',Arial,sans-serif",fontSize:9,fontWeight:400,letterSpacing:"0.2em",textTransform:"uppercase",color:"rgba(232,168,32,0.6)"}}>Center · Josh</div></div></div>}
        {sidebarCollapsed&&<span style={{fontSize:18}}>🇺🇸</span>}
        {!sidebarCollapsed&&<button onClick={toggleSidebar} style={{background:"none",border:"none",cursor:"pointer",color:"rgba(232,168,32,0.4)",padding:4}} onMouseEnter={e=>(e.currentTarget.style.color="#e8a820")} onMouseLeave={e=>(e.currentTarget.style.color="rgba(232,168,32,0.4)")}><ChevronLeft size={16}/></button>}
      </div>
      {sidebarCollapsed&&<button onClick={toggleSidebar} style={{margin:"8px auto",width:30,height:22,display:"flex",alignItems:"center",justifyContent:"center",background:"none",border:"1px solid rgba(232,168,32,0.2)",borderRadius:2,cursor:"pointer",color:"rgba(232,168,32,0.35)"}} onMouseEnter={e=>{e.currentTarget.style.color="#e8a820";e.currentTarget.style.borderColor="rgba(232,168,32,0.5)";}} onMouseLeave={e=>{e.currentTarget.style.color="rgba(232,168,32,0.35)";e.currentTarget.style.borderColor="rgba(232,168,32,0.2)"}}><ChevronRight size={13}/></button>}
      <nav style={{flex:1,overflowY:"auto",padding:"6px"}}>
        {NAV.map(({id,label,icon:Icon})=>{
          const active=activePage===id;
          return <button key={id} onClick={()=>setActivePage(id)} title={sidebarCollapsed?label:undefined} style={{width:"100%",display:"flex",alignItems:"center",gap:8,padding:sidebarCollapsed?"8px 0":"7px 8px",justifyContent:sidebarCollapsed?"center":"flex-start",borderRadius:2,border:`1px solid ${active?"rgba(232,168,32,0.35)":"transparent"}`,background:active?"rgba(232,168,32,0.1)":"transparent",color:active?"#e8a820":"rgba(245,240,224,0.3)",cursor:"pointer",marginBottom:1,transition:"all 0.1s",fontFamily:"'Oswald',Arial,sans-serif"}} onMouseEnter={e=>{if(!active){e.currentTarget.style.color="#f5f0e0";e.currentTarget.style.background="rgba(245,240,224,0.04)";}}} onMouseLeave={e=>{if(!active){e.currentTarget.style.color="rgba(245,240,224,0.3)";e.currentTarget.style.background="transparent";}}}>
            <Icon size={14} style={{flexShrink:0}}/>
            {!sidebarCollapsed&&<span style={{fontSize:11,fontWeight:600,letterSpacing:"0.1em",textTransform:"uppercase",whiteSpace:"nowrap"}}>{label}</span>}
            {active&&!sidebarCollapsed&&<div style={{marginLeft:"auto",width:3,height:14,background:"#e8a820",borderRadius:1,flexShrink:0}}/>}
          </button>;
        })}
      </nav>
      {!sidebarCollapsed&&<div style={{padding:"8px 10px",borderTop:"4px solid #e8a820",background:"#162a1c",flexShrink:0}}><div style={{fontFamily:"'IM Fell English',Georgia,serif",fontStyle:"italic",fontSize:9,color:"rgba(232,168,32,0.28)",textAlign:"center"}}>★ Liberty · Discipline · Execution ★</div></div>}
    </aside>
  );
}
