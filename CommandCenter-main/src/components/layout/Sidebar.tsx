import { LayoutDashboard,CheckSquare,FolderKanban,Flame,Calendar,Brain,StickyNote,Users,BarChart3,Trophy,Tags,Shapes,ChevronLeft,ChevronRight,NotebookText,CloudSun } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { useUIStore } from "@/store";

const NAV = [
  {id:"dashboard",label:"Dashboard",icon:LayoutDashboard},{id:"todos",label:"Daily Todos",icon:CheckSquare},
  {id:"daily-summary",label:"Daily Summary",icon:NotebookText},
  {id:"projects",label:"Projects",icon:FolderKanban},{id:"habits",label:"Habits",icon:Flame},
  {id:"calendar",label:"Calendar",icon:Calendar},
  {id:"weather",label:"Weather",icon:CloudSun},
  {id:"categories",label:"Categories",icon:Shapes},{id:"tags",label:"Tags",icon:Tags},
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
  const { sidebarCollapsed, toggleSidebar, setAddTaskOpen } = useUIStore();
  const navigate = useNavigate();
  const location = useLocation();
  const w = sidebarCollapsed ? 48 : 200;

  // Determine active page from URL
  const currentId = location.pathname.replace(/^\//, "").split("/")[0] || "dashboard";
  const weatherTheme = currentId === "weather";
  const railBg = weatherTheme ? "#0f172a" : "#1a2f22";
  /* Weather: navy rail + red accent (matches dashboard critical / live markers) */
  const railBorder = weatherTheme ? "4px solid #d94040" : "4px solid #e8a820";
  const headerBg = weatherTheme ? "#0b1220" : "#162a1c";
  const headerBorder = weatherTheme ? "4px solid #d94040" : "4px solid #e8a820";
  const activeBorder = weatherTheme ? "rgba(217,64,64,0.5)" : "rgba(232,168,32,0.35)";
  const activeBg = weatherTheme ? "rgba(217,64,64,0.14)" : "rgba(232,168,32,0.1)";
  const activeColor = weatherTheme ? "#f87171" : "#e8a820";
  const mutedColor = weatherTheme ? "rgba(226,232,240,0.35)" : "rgba(245,240,224,0.3)";

  function handleFlagClick() {
    navigate("/todos");
    setAddTaskOpen(true);
  }

  return (
    <aside style={{ position:"fixed",left:0,top:0,height:"100%",width:w,zIndex:40,background:railBg,borderRight:railBorder,display:"flex",flexDirection:"column",transition:"width 0.25s ease, background 0.25s ease, border-color 0.25s ease",overflow:"hidden" }}>
      <div style={{ minHeight:64,display:"flex",alignItems:"center",justifyContent:sidebarCollapsed?"center":"space-between",padding:sidebarCollapsed?"0 10px":"0 8px 0 4px",borderBottom:headerBorder,background:headerBg,flexShrink:0,transition:"background 0.25s ease, border-color 0.25s ease" }}>
        {!sidebarCollapsed && (
          <>
            <BrandMark collapsed={false} onFlagClick={handleFlagClick} />
            <button onClick={toggleSidebar} style={{background:"none",border:"none",cursor:"pointer",color:weatherTheme?"rgba(248,113,113,0.55)":"rgba(232,168,32,0.4)",padding:4,flexShrink:0}} onMouseEnter={e=>(e.currentTarget.style.color=weatherTheme?"#fca5a5":"#e8a820")} onMouseLeave={e=>(e.currentTarget.style.color=weatherTheme?"rgba(248,113,113,0.55)":"rgba(232,168,32,0.4)")}><ChevronLeft size={16}/></button>
          </>
        )}
        {sidebarCollapsed && <BrandMark collapsed={true} onFlagClick={handleFlagClick} />}
      </div>
        {sidebarCollapsed&&<button onClick={toggleSidebar} style={{margin:"8px auto",width:30,height:22,display:"flex",alignItems:"center",justifyContent:"center",background:"none",border:weatherTheme?"1px solid rgba(217,64,64,0.35)":"1px solid rgba(232,168,32,0.2)",borderRadius:2,cursor:"pointer",color:weatherTheme?"rgba(248,113,113,0.5)":"rgba(232,168,32,0.35)"}} onMouseEnter={e=>{e.currentTarget.style.color=weatherTheme?"#fca5a5":"#e8a820";e.currentTarget.style.borderColor=weatherTheme?"rgba(217,64,64,0.65)":"rgba(232,168,32,0.5)";}} onMouseLeave={e=>{e.currentTarget.style.color=weatherTheme?"rgba(248,113,113,0.5)":"rgba(232,168,32,0.35)";e.currentTarget.style.borderColor=weatherTheme?"rgba(217,64,64,0.35)":"rgba(232,168,32,0.2)"}}><ChevronRight size={13}/></button>}
      <nav style={{flex:1,overflowY:"auto",padding:"6px"}}>
        {NAV.map(({id,label,icon:Icon})=>{
          const active = currentId === id;
          return <button key={id} onClick={()=>navigate("/"+id)} title={sidebarCollapsed?label:undefined} style={{width:"100%",display:"flex",alignItems:"center",gap:8,padding:sidebarCollapsed?"8px 0":"7px 8px",justifyContent:sidebarCollapsed?"center":"flex-start",borderRadius:2,border:`1px solid ${active?activeBorder:"transparent"}`,background:active?activeBg:"transparent",color:active?activeColor:mutedColor,cursor:"pointer",marginBottom:1,transition:"all 0.1s",fontFamily:"'Oswald',Arial,sans-serif"}} onMouseEnter={e=>{if(!active){e.currentTarget.style.color="#f5f0e0";e.currentTarget.style.background="rgba(245,240,224,0.04)";}}} onMouseLeave={e=>{if(!active){e.currentTarget.style.color=mutedColor;e.currentTarget.style.background="transparent";}}}>
            <Icon size={14} style={{flexShrink:0}}/>
            {!sidebarCollapsed&&<span style={{fontSize:11,fontWeight:600,letterSpacing:"0.1em",textTransform:"uppercase",whiteSpace:"nowrap"}}>{label}</span>}
            {active&&!sidebarCollapsed&&<div style={{marginLeft:"auto",width:3,height:14,background:activeColor,borderRadius:1,flexShrink:0}}/>}
          </button>;
        })}
      </nav>
      {!sidebarCollapsed&&<div style={{padding:"8px 10px",borderTop:headerBorder,background:headerBg,flexShrink:0,transition:"background 0.25s ease, border-color 0.25s ease"}}><div style={{fontFamily:"'IM Fell English',Georgia,serif",fontStyle:"italic",fontSize:9,color:weatherTheme?"rgba(217,64,64,0.45)":"rgba(232,168,32,0.28)",textAlign:"center"}}>★ Liberty · Discipline · Execution ★</div></div>}
    </aside>
  );
}
