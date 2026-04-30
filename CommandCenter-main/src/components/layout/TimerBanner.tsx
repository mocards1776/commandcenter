import { Square, Maximize2 } from "lucide-react";
import { useRef, useEffect, useState } from "react";
import { useActiveTimer } from "@/hooks/useTimer";
import { useFocusStore } from "@/store";

// Minimal flip panel for the timer banner
function BannerFlip({ value }: { value: string }) {
  const prevRef = useRef(value);
  const [shown, setShown]       = useState(value);
  const [flipping, setFlipping] = useState(false);
  useEffect(() => {
    if (value !== prevRef.current) {
      setFlipping(true);
      const tid = setTimeout(() => { setShown(value); prevRef.current = value; setFlipping(false); }, 150);
      return () => clearTimeout(tid);
    } else { setShown(value); }
  }, [value]);
  return (
    <div className={`panel${flipping ? " flip-panel" : ""}`}
      style={{ width:38, height:34, boxShadow:"inset 0 2px 5px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.04)" }}>
      <span style={{ fontFamily:"'Oswald',Arial,sans-serif", fontSize:20, fontWeight:700,
        letterSpacing:"-0.02em", color:"#e8a820", lineHeight:1 }}>{shown}</span>
    </div>
  );
}

export function TimerBanner() {
  const { isRunning, activeTask, elapsedSeconds, stop, isStopping } = useActiveTimer();
  const { setFocus } = useFocusStore();
  if (!isRunning) return null;

  const totalMins = Math.floor(elapsedSeconds / 60);
  const hrs       = Math.floor(totalMins / 60);
  const mins      = totalMins % 60;
  const secs      = elapsedSeconds % 60;

  return (
    <div style={{position:"fixed",top:0,left:0,right:0,zIndex:50,height:44,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 16px",background:"#162a1c",borderBottom:"4px solid #e8a820"}}>
      <div
        onClick={() => setFocus(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && setFocus(true)}
        style={{display:"flex",alignItems:"center",gap:12,minWidth:0,cursor:"pointer"}}
        title="Open focus mode"
      >
        <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
          <div className="live-dot"/>
          <span style={{fontFamily:"'Oswald',Arial,sans-serif",fontSize:9,fontWeight:700,letterSpacing:"0.2em",textTransform:"uppercase",color:"#d94040"}}>LIVE</span>
        </div>
        <div style={{width:1,height:16,background:"rgba(232,168,32,0.3)",flexShrink:0}}/>
        <div style={{minWidth:0}}>
          <div style={{fontSize:9,fontWeight:600,letterSpacing:"0.18em",textTransform:"uppercase",color:"rgba(232,168,32,0.5)"}}>NOW TRACKING</div>
          <div
            style={{fontFamily:"'Oswald',Arial,sans-serif",fontSize:12,fontWeight:600,color:"#f5f0e0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:300,textDecoration:"underline",textDecorationColor:"rgba(232,168,32,0.3)",textUnderlineOffset:2}}
            onMouseEnter={e => (e.currentTarget.style.color = "#e8a820")}
            onMouseLeave={e => (e.currentTarget.style.color = "#f5f0e0")}
          >
            {activeTask?.title ?? "Timer running\u2026"}
          </div>
        </div>
      </div>

      {/* HRS : MIN : SEC flip display */}
      <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
        <div style={{display:"flex",alignItems:"flex-start",gap:3}}>
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
            <BannerFlip value={String(hrs).padStart(2,"0")} />
            <span style={{fontFamily:"'Oswald',Arial,sans-serif",fontSize:7,fontWeight:600,letterSpacing:"0.14em",color:"rgba(232,168,32,0.45)",textTransform:"uppercase"}}>HRS</span>
          </div>
          <span style={{fontFamily:"'Oswald',Arial,sans-serif",fontSize:18,fontWeight:700,color:"rgba(232,168,32,0.3)",lineHeight:"32px",userSelect:"none"}}>:</span>
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
            <BannerFlip value={String(mins).padStart(2,"0")} />
            <span style={{fontFamily:"'Oswald',Arial,sans-serif",fontSize:7,fontWeight:600,letterSpacing:"0.14em",color:"rgba(232,168,32,0.45)",textTransform:"uppercase"}}>MIN</span>
          </div>
          <span style={{fontFamily:"'Oswald',Arial,sans-serif",fontSize:18,fontWeight:700,color:"rgba(232,168,32,0.3)",lineHeight:"32px",userSelect:"none"}}>:</span>
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
            <BannerFlip value={String(secs).padStart(2,"0")} />
            <span style={{fontFamily:"'Oswald',Arial,sans-serif",fontSize:7,fontWeight:600,letterSpacing:"0.14em",color:"rgba(232,168,32,0.45)",textTransform:"uppercase"}}>SEC</span>
          </div>
        </div>
        <button onClick={()=>setFocus(true)} style={{padding:6,background:"none",border:"none",cursor:"pointer",color:"rgba(232,168,32,0.4)",borderRadius:2}} onMouseEnter={e=>(e.currentTarget.style.color="#e8a820")} onMouseLeave={e=>(e.currentTarget.style.color="rgba(232,168,32,0.4)")}><Maximize2 size={14}/></button>
        <button onClick={stop} disabled={isStopping} className="btn btn-red" style={{padding:"4px 10px"}}><Square size={9} style={{fill:"currentColor"}}/>STOP</button>
      </div>
    </div>
  );
}
