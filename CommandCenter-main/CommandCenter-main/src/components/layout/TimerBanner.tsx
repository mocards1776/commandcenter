import { Square, Maximize2 } from "lucide-react";
import { useActiveTimer } from "@/hooks/useTimer";
import { useFocusStore } from "@/store";
import { formatDuration } from "@/lib/utils";
export function TimerBanner() {
  const { isRunning, activeTask, elapsedSeconds, stop, isStopping } = useActiveTimer();
  const { setFocus } = useFocusStore();
  if (!isRunning) return null;
  return (
    <div style={{position:"fixed",top:0,left:0,right:0,zIndex:50,height:44,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 16px",background:"#162a1c",borderBottom:"4px solid #e8a820"}}>
      <div style={{display:"flex",alignItems:"center",gap:12,minWidth:0}}>
        <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
          <div className="live-dot"/>
          <span style={{fontFamily:"'Oswald',Arial,sans-serif",fontSize:9,fontWeight:700,letterSpacing:"0.2em",textTransform:"uppercase",color:"#d94040"}}>LIVE</span>
        </div>
        <div style={{width:1,height:16,background:"rgba(232,168,32,0.3)",flexShrink:0}}/>
        <div style={{minWidth:0}}>
          <div style={{fontSize:9,fontWeight:600,letterSpacing:"0.18em",textTransform:"uppercase",color:"rgba(232,168,32,0.5)"}}>NOW TRACKING</div>
          <div style={{fontFamily:"'Oswald',Arial,sans-serif",fontSize:12,fontWeight:600,color:"#f5f0e0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:300}}>{activeTask?.title??"Timer running…"}</div>
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
        <span className="timer-pulse" style={{fontFamily:"'Oswald',Arial,sans-serif",fontSize:20,fontWeight:700,color:"#e8a820",minWidth:72,textAlign:"right"}}>{formatDuration(elapsedSeconds)}</span>
        <button onClick={()=>setFocus(true)} style={{padding:6,background:"none",border:"none",cursor:"pointer",color:"rgba(232,168,32,0.4)",borderRadius:2}} onMouseEnter={e=>(e.currentTarget.style.color="#e8a820")} onMouseLeave={e=>(e.currentTarget.style.color="rgba(232,168,32,0.4)")}><Maximize2 size={14}/></button>
        <button onClick={stop} disabled={isStopping} className="btn btn-red" style={{padding:"4px 10px"}}><Square size={9} style={{fill:"currentColor"}}/>STOP</button>
      </div>
    </div>
  );
}
