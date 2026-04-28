import { useEffect, useRef, useCallback } from "react";
import { useCelebrationStore } from "@/store";
import type { Task } from "@/types";
export function calcPoints(task: Pick<Task,"focus_score">): number { return Math.round(task.focus_score * 18); }
interface Particle { x:number;y:number;vx:number;vy:number;color:string;alpha:number;size:number;gravity:number; }
const COLS = ["#e8a820","#f5f0e0","#d94040","#c9901a","#f5f0e0","#e8a820"];
function burst(ps: Particle[], x: number, y: number) {
  for(let i=0;i<48;i++){const a=(Math.PI*2*i)/48+(Math.random()-0.5)*0.5,sp=2+Math.random()*7;ps.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,color:COLS[Math.floor(Math.random()*COLS.length)],alpha:1,size:2+Math.random()*4,gravity:0.06+Math.random()*0.06});}
}
export function CelebrationOverlay() {
  const { celebrating, celebrationTask, pointsEarned, clearCelebration } = useCelebrationStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const psRef = useRef<Particle[]>([]);
  const rafRef = useRef<number>(0);
  const animate = useCallback(()=>{
    const c=canvasRef.current;if(!c)return;const ctx=c.getContext("2d");if(!ctx)return;
    ctx.clearRect(0,0,c.width,c.height);psRef.current=psRef.current.filter(p=>p.alpha>0.02);
    for(const p of psRef.current){ctx.save();ctx.globalAlpha=p.alpha;ctx.fillStyle=p.color;ctx.shadowColor=p.color;ctx.shadowBlur=6;ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,Math.PI*2);ctx.fill();ctx.restore();p.x+=p.vx;p.y+=p.vy;p.vy+=p.gravity;p.vx*=0.98;p.alpha-=0.018;p.size*=0.996;}
    rafRef.current=requestAnimationFrame(animate);
  },[]);
  useEffect(()=>{
    if(!celebrating){cancelAnimationFrame(rafRef.current);psRef.current=[];return;}
    const c=canvasRef.current;if(!c)return;c.width=window.innerWidth;c.height=window.innerHeight;
    rafRef.current=requestAnimationFrame(animate);let count=0;
    const fire=()=>{if(count>=10)return;count++;burst(psRef.current,c.width*(0.2+Math.random()*0.6),c.height*(0.1+Math.random()*0.4));setTimeout(fire,count<4?120:250+Math.random()*300);};fire();
    const t=setTimeout(clearCelebration,4000);return()=>{cancelAnimationFrame(rafRef.current);clearTimeout(t);};
  },[celebrating,animate,clearCelebration]);
  if(!celebrating||!celebrationTask)return null;
  return (
    <div style={{position:"fixed",inset:0,zIndex:200,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={clearCelebration}>
      <canvas ref={canvasRef} style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none"}}/>
      <div style={{position:"relative",zIndex:1,textAlign:"center",padding:"24px 32px",background:"#1e3629",border:"4px solid #e8a820",boxShadow:"0 0 40px rgba(232,168,32,0.3), 0 30px 80px rgba(0,0,0,0.8)",animation:"celebin 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards",pointerEvents:"none"}}>
        <div style={{fontFamily:"'Oswald',Arial,sans-serif",fontSize:10,fontWeight:700,letterSpacing:"0.25em",textTransform:"uppercase",color:"#e8a820",marginBottom:6}}>★ ORDER COMPLETE ★</div>
        <div style={{height:3,background:"#e8a820",marginBottom:12}}/>
        <div style={{fontFamily:"'Oswald',Arial,sans-serif",fontSize:15,fontWeight:600,letterSpacing:"0.06em",textTransform:"uppercase",color:"#f5f0e0",marginBottom:10}}>{celebrationTask.title}</div>
        <div className="panel" style={{width:80,height:66,margin:"0 auto 8px"}}><span className="panel-num gold" style={{fontSize:42}}>+{pointsEarned}</span></div>
        <div style={{fontFamily:"'IM Fell English',Georgia,serif",fontStyle:"italic",fontSize:10,color:"rgba(232,168,32,0.5)"}}>points · Focus Score {celebrationTask.focus_score} × 18</div>
        <div style={{height:3,background:"#e8a820",marginTop:12,marginBottom:6}}/>
        <div style={{fontFamily:"'IM Fell English',Georgia,serif",fontStyle:"italic",fontSize:9,color:"rgba(245,240,224,0.25)"}}>tap to dismiss</div>
      </div>
    </div>
  );
}
