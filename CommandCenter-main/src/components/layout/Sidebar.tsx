import { LayoutDashboard,CheckSquare,FolderKanban,Flame,Calendar,Brain,StickyNote,Users,BarChart3,Trophy,Focus,ChevronLeft,ChevronRight } from "lucide-react";
import { useUIStore } from "@/store";
const NAV = [
  {id:"dashboard",label:"Dashboard",icon:LayoutDashboard},{id:"todos",label:"Daily Todos",icon:CheckSquare},
  {id:"projects",label:"Projects",icon:FolderKanban},{id:"habits",label:"Habits",icon:Flame},
  {id:"calendar",label:"Calendar",icon:Calendar},{id:"focus",label:"Focus Mode",icon:Focus},
  {id:"braindump",label:"AI Braindump",icon:Brain},{id:"notes",label:"Notes",icon:StickyNote},
  {id:"crm",label:"People CRM",icon:Users},{id:"stats",label:"Stats",icon:BarChart3},{id:"sports",label:"Sports",icon:Trophy},
];

// Compact branding — mirrors the top-of-page "JOSH'S / COMMAND CENTER" design
function BrandMark({ collapsed, onFlagClick }: { collapsed: boolean; onFlagClick: () => void }) {
  if (collapsed) {
    return (
      <div
        onClick={onFlagClick}
        title="Add new task"
        style={{display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,cursor:"pointer"}}
        aria-label="Add task"
      >🇺🇸</div>
    );
  }
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",lineHeight:1,gap:2,flex:1,minWidth:0}} aria-label="Josh's Command Center">
      <span style={{color:"#e8a820",fontSize:7,letterSpacing:"0.4em",opacity:0.7}}>★ ★ ★</span>
      <span style={{fontFamily:"'Inter',sans-serif",fontSize:10,fontWeight:900,letterSpacing:"0.15em",color:"rgba(255,255,255,0.75)",textTransform:"uppercase"}}>JOSH'S</span>
      <span style={{fontFamily:"'Inter',sans-serif",fontSize:14,fontWeight:900,letterSpacing:"-0.02em",color:"#fff",textTransform:"uppercase",whiteSpace:"nowrap"}}>COMMAND CENTER</span>
      <span
        onClick={onFlagClick}
        title="Add new task"
        style={{fontSize:11,marginTop:1,cursor:"pointer"}}
        aria-label="Add task"
      >🇺🇸</span>
    </div>
  );
}

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar, activePage, setActivePage, setAddTaskOpen } = useUIStore();
  const w = sidebarCollapsed ? 48 : 200;

  function handleFlagClick() {
    setActivePage("todos");
    setAddTaskOpen(true);
  }

  return (
    <aside style={{ position:"fixed",left:0,top:0,height:"100%",width:w,zIndex:40,background:"#1a2f22",borderRight:"4px solid #e8a820",display:"flex",flexDirection:"column",transition:"width 0.25s ease",overflow:"hidden" }}>
      <div style={{ minHeight:64,display:"flex",alignItems:"center",justifyContent:sidebarCollapsed?"center":"space-between",padding:sidebarCollapsed?"0 10px":"0 8px 0 4px",borderBottom:"4px solid #e8a820",background:"#162a1c",flexShrink:0 }}>
        {!sidebarCollapsed && (
          <>
            <BrandMark collapsed={false} onFlagClick={handleFlagClick} />
            <button onClick={toggleSidebar} style={{background:"none",border:"none",cursor:"pointer",color:"rgba(232,168,32,0.4)",padding:4,flexShrink:0}} onMouseEnter={e=>(e.currentTarget.style.color="#e8a820")} onMouseLeave={e=>(e.currentTarget.style.color="rgba(232,168,32,0.4)")}><ChevronLeft size={16}/></button>
          </>
        )}
        {sidebarCollapsed && <BrandMark collapsed={true} onFlagClick={handleFlagClick} />}
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
