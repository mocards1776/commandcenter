import { LayoutDashboard,CheckSquare,FolderKanban,Flame,Calendar,Brain,StickyNote,Users,BarChart3,Trophy,Focus,ChevronLeft,ChevronRight } from "lucide-react";
import { useUIStore } from "@/store";
const NAV = [
  {id:"dashboard",label:"Dashboard",icon:LayoutDashboard},{id:"todos",label:"Daily Todos",icon:CheckSquare},
  {id:"projects",label:"Projects",icon:FolderKanban},{id:"habits",label:"Habits",icon:Flame},
  {id:"calendar",label:"Calendar",icon:Calendar},{id:"focus",label:"Focus Mode",icon:Focus},
  {id:"braindump",label:"AI Braindump",icon:Brain},{id:"notes",label:"Notes",icon:StickyNote},
  {id:"crm",label:"People CRM",icon:Users},{id:"stats",label:"Stats",icon:BarChart3},{id:"sports",label:"Sports",icon:Trophy},
];

// Cardinals-style neon SVG logo
function CardinalsLogo({ collapsed }: { collapsed: boolean }) {
  if (collapsed) {
    // Collapsed: just the clock face
    return (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-label="Command Center">
        <circle cx="14" cy="14" r="12" stroke="#e8102a" strokeWidth="1.5" fill="none"
          style={{filter:"drop-shadow(0 0 3px #e8102a)"}} />
        <circle cx="14" cy="14" r="1.5" fill="#e8a820" />
        {/* Hour hand */}
        <line x1="14" y1="14" x2="14" y2="7" stroke="#e8a820" strokeWidth="1.5" strokeLinecap="round"
          style={{filter:"drop-shadow(0 0 2px #e8a820)"}} />
        {/* Minute hand */}
        <line x1="14" y1="14" x2="19" y2="14" stroke="#e8a820" strokeWidth="1" strokeLinecap="round"
          style={{filter:"drop-shadow(0 0 2px #e8a820)"}} />
      </svg>
    );
  }

  return (
    <svg width="176" height="52" viewBox="0 0 176 52" fill="none" aria-label="Josh's Command Center">
      <defs>
        <filter id="neon-red" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="neon-gold" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>

      {/* ── Left cardinal bird on bat ── */}
      {/* Bat diagonal \ */}
      <line x1="6" y1="10" x2="22" y2="30" stroke="#c8a060" strokeWidth="2.2" strokeLinecap="round"
        style={{filter:"drop-shadow(0 0 2px #c8a060)"}} />
      {/* Bird body */}
      <ellipse cx="8" cy="9" rx="4" ry="3" fill="#e8102a"
        style={{filter:"drop-shadow(0 0 4px #e8102a)"}} />
      {/* Crest */}
      <path d="M8 6 Q9 3 11 4 Q9 5 8 6Z" fill="#e8102a"
        style={{filter:"drop-shadow(0 0 3px #e8102a)"}} />
      {/* Beak */}
      <path d="M4 9 L1 8 L4 10Z" fill="#e8a820" />
      {/* Eye */}
      <circle cx="5" cy="8.5" r="0.8" fill="#1a2f22" />
      {/* Wing */}
      <path d="M8 10 Q11 13 9 14 Q7 12 8 10Z" fill="#c00018" />

      {/* ── Clock in the center ── */}
      <circle cx="88" cy="26" r="10" stroke="#e8a820" strokeWidth="1.5" fill="#162a1c"
        style={{filter:"drop-shadow(0 0 4px #e8a820)"}} />
      <circle cx="88" cy="26" r="1.2" fill="#e8a820" />
      {/* Hour hand pointing ~10 o'clock */}
      <line x1="88" y1="26" x2="84" y2="21" stroke="#e8a820" strokeWidth="1.5" strokeLinecap="round" />
      {/* Minute hand pointing ~2 o'clock */}
      <line x1="88" y1="26" x2="93" y2="22" stroke="#e8a820" strokeWidth="1" strokeLinecap="round" />
      {/* Tick marks */}
      {[0,30,60,90,120,150,180,210,240,270,300,330].map((deg, i) => {
        const r = Math.PI * deg / 180;
        const x1 = 88 + 8.5 * Math.cos(r);
        const y1 = 26 + 8.5 * Math.sin(r);
        const x2 = 88 + 10 * Math.cos(r);
        const y2 = 26 + 10 * Math.sin(r);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#e8a820" strokeWidth={i % 3 === 0 ? 1.2 : 0.6} opacity={0.7} />;
      })}

      {/* ── Right cardinal bird on bat ── */}
      {/* Bat diagonal / */}
      <line x1="170" y1="10" x2="154" y2="30" stroke="#c8a060" strokeWidth="2.2" strokeLinecap="round"
        style={{filter:"drop-shadow(0 0 2px #c8a060)"}} />
      {/* Bird body (mirrored) */}
      <ellipse cx="168" cy="9" rx="4" ry="3" fill="#e8102a"
        style={{filter:"drop-shadow(0 0 4px #e8102a)"}} />
      {/* Crest */}
      <path d="M168 6 Q167 3 165 4 Q167 5 168 6Z" fill="#e8102a"
        style={{filter:"drop-shadow(0 0 3px #e8102a)"}} />
      {/* Beak */}
      <path d="M172 9 L175 8 L172 10Z" fill="#e8a820" />
      {/* Eye */}
      <circle cx="171" cy="8.5" r="0.8" fill="#1a2f22" />
      {/* Wing */}
      <path d="M168 10 Q165 13 167 14 Q169 12 168 10Z" fill="#c00018" />

      {/* ── "Josh's" script above the main text ── */}
      <text
        x="88" y="20"
        textAnchor="middle"
        fontFamily="'Dancing Script', 'Brush Script MT', cursive"
        fontSize="10"
        fontWeight="700"
        fill="#e8a820"
        filter="url(#neon-gold)"
        style={{letterSpacing:"0.05em"}}
      >Josh&apos;s</text>

      {/* ── Main "Command Center" neon script ── */}
      <text
        x="88" y="42"
        textAnchor="middle"
        fontFamily="'Dancing Script', 'Brush Script MT', cursive"
        fontSize="18"
        fontWeight="700"
        fill="#e8102a"
        filter="url(#neon-red)"
        style={{letterSpacing:"0.02em"}}
      >Command Center</text>

      {/* Outer glow ring around whole sign area */}
      <rect x="1" y="1" width="174" height="50" rx="4" stroke="#e8102a" strokeWidth="0.5" fill="none" opacity="0.15" />
    </svg>
  );
}

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar, activePage, setActivePage } = useUIStore();
  const w = sidebarCollapsed ? 48 : 200;
  return (
    <aside style={{ position:"fixed",left:0,top:0,height:"100%",width:w,zIndex:40,background:"#1a2f22",borderRight:"4px solid #e8a820",display:"flex",flexDirection:"column",transition:"width 0.25s ease",overflow:"hidden" }}>
      <div style={{ minHeight:64,display:"flex",alignItems:"center",justifyContent:sidebarCollapsed?"center":"space-between",padding:sidebarCollapsed?"0 10px":"0 8px 0 4px",borderBottom:"4px solid #e8a820",background:"#162a1c",flexShrink:0 }}>
        {!sidebarCollapsed && (
          <>
            <CardinalsLogo collapsed={false} />
            <button onClick={toggleSidebar} style={{background:"none",border:"none",cursor:"pointer",color:"rgba(232,168,32,0.4)",padding:4,flexShrink:0}} onMouseEnter={e=>(e.currentTarget.style.color="#e8a820")} onMouseLeave={e=>(e.currentTarget.style.color="rgba(232,168,32,0.4)")}><ChevronLeft size={16}/></button>
          </>
        )}
        {sidebarCollapsed && <CardinalsLogo collapsed={true} />}
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
