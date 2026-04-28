import { X, Square } from "lucide-react";
import { useFocusStore } from "@/store";
import { useActiveTimer } from "@/hooks/useTimer";
import { formatDuration, formatMinutes } from "@/lib/utils";
export function FocusMode() {
  const { isFocusMode, setFocus } = useFocusStore();
  const { activeTask, elapsedSeconds, stop, isRunning } = useActiveTimer();
  if (!isFocusMode) return null;
  const est=activeTask?.time_estimate_minutes, pct=est?Math.min((elapsedSeconds/60/est)*100,100):0;
  const r=90,circ=2*Math.PI*r,off=circ-(pct/100)*circ;
  return (
    <div style={{position:"fixed",inset:0,zIndex:100,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"#1a2f22"}}>
      <div style={{position:"absolute",top:0,left:0,right:0,height:5,background:"#e8a820"}}/>
      <div style={{position:"absolute",bottom:0,left:0,right:0,height:5,background:"#e8a820"}}/>
      <button onClick={()=>setFocus(false)} style={{position:"absolute",top:20,right:20,background:"none",border:"1px solid rgba(232,168,32,0.2)",borderRadius:2,cursor:"pointer",color:"rgba(232,168,32,0.4)",padding:8}} onMouseEnter={e=>(e.currentTarget.style.color="#e8a820")} onMouseLeave={e=>(e.currentTarget.style.color="rgba(232,168,32,0.4)")}><X size={18}/></button>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:20}}><div className="live-dot"/><span style={{fontFamily:"'Oswald',Arial,sans-serif",fontSize:10,fontWeight:700,letterSpacing:"0.25em",textTransform:"uppercase",color:"#d94040"}}>Focus Session 🇺🇸</span></div>
      <div style={{fontFamily:"'Oswald',Arial,sans-serif",fontSize:"clamp(22px,4vw,40px)",fontWeight:700,textAlign:"center",color:"#f5f0e0",maxWidth:700,lineHeight:1.2,marginBottom:4,padding:"0 24px",letterSpacing:"0.04em",textTransform:"uppercase"}}>{activeTask?.title??"Deep Work Session"}</div>
      {activeTask?.description&&<p style={{fontFamily:"'IM Fell English',Georgia,serif",fontStyle:"italic",fontSize:13,color:"rgba(245,240,224,0.35)",textAlign:"center",maxWidth:500,marginBottom:24,lineHeight:1.6}}>{activeTask.description}</p>}
      <div style={{height:3,width:140,background:"#e8a820",marginBottom:24}}/>
      <div style={{position:"relative",width:220,height:220,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:20}}>
        <svg width={220} height={220} style={{position:"absolute",transform:"rotate(-90deg)"}} viewBox="0 0 220 220">
          <circle cx={110} cy={110} r={r} fill="none" stroke="#1e3629" strokeWidth={4}/>
          <circle cx={110} cy={110} r={r} fill="none" stroke="#e8a820" strokeWidth={4} strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="square" style={{filter:"drop-shadow(0 0 6px rgba(232,168,32,0.5))",transition:"stroke-dashoffset 1s linear"}}/>
        </svg>
        <div style={{textAlign:"center"}}>
          <div style={{fontFamily:"'Oswald',Arial,sans-serif",fontSize:46,fontWeight:700,color:"#e8a820",textShadow:"0 0 20px rgba(232,168,32,0.4)",lineHeight:1}}>{formatDuration(elapsedSeconds)}</div>
          <div style={{fontSize:9,fontWeight:600,letterSpacing:"0.18em",textTransform:"uppercase",color:"rgba(245,240,224,0.3)",marginTop:4}}>elapsed</div>
        </div>
      </div>
      {activeTask&&(
        <div style={{display:"flex",gap:24,marginBottom:24}}>
          {est&&<div style={{textAlign:"center"}}><div style={{fontSize:9,fontWeight:600,letterSpacing:"0.18em",textTransform:"uppercase",color:"rgba(245,240,224,0.3)",marginBottom:3}}>Estimated</div><div style={{fontFamily:"'Oswald',Arial,sans-serif",fontSize:14,fontWeight:600,color:"#f5f0e0"}}>{formatMinutes(est)}</div></div>}
          <div style={{textAlign:"center"}}><div style={{fontSize:9,fontWeight:600,letterSpacing:"0.18em",textTransform:"uppercase",color:"rgba(245,240,224,0.3)",marginBottom:3}}>Focus Score</div><div style={{fontFamily:"'Oswald',Arial,sans-serif",fontSize:14,fontWeight:600,color:"#e8a820"}}>{activeTask.focus_score}</div></div>
        </div>
      )}
      {isRunning&&<button onClick={()=>{stop();setFocus(false);}} className="btn btn-red" style={{padding:"12px 28px",fontSize:13,fontWeight:700,letterSpacing:"0.15em"}}><Square size={14} style={{fill:"currentColor"}}/>Stop Timer</button>}
      <p style={{position:"absolute",bottom:20,fontFamily:"'IM Fell English',Georgia,serif",fontStyle:"italic",fontSize:9,color:"rgba(232,168,32,0.2)",letterSpacing:"0.15em"}}>🇺🇸 locked in · stay the course</p>
    </div>
  );
}
