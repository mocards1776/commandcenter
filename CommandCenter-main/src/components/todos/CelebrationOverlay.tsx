import { useEffect, useRef, useCallback } from "react";
import { useCelebrationStore } from "@/store";
import type { Task } from "@/types";

export function calcPoints(task: Pick<Task, "focus_score">): number {
  return Math.round(task.focus_score * 18);
}

interface Particle {
  x: number; y: number; vx: number; vy: number;
  color: string; alpha: number; size: number; gravity: number;
  type: "spark" | "star" | "ring";
}

interface Rocket {
  x: number; y: number; vx: number; vy: number;
  color: string; trail: Array<{ x: number; y: number; alpha: number }>;
}

const FIREWORK_COLS = [
  "#e8a820","#f5f0e0","#d94040","#4285f4",
  "#22c55e","#f59e0b","#e879f9","#38bdf8",
  "#fbbf24","#fb923c","#a3e635",
];
function randomCol() { return FIREWORK_COLS[Math.floor(Math.random() * FIREWORK_COLS.length)]; }

function burst(ps: Particle[], x: number, y: number, col: string, count = 90) {
  for (let i = 0; i < count; i++) {
    const a = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
    const sp = 3 + Math.random() * 10;
    const type: Particle["type"] = i % 7 === 0 ? "star" : i % 11 === 0 ? "ring" : "spark";
    ps.push({
      x, y,
      vx: Math.cos(a) * sp * (0.7 + Math.random() * 0.6),
      vy: Math.sin(a) * sp * (0.7 + Math.random() * 0.6),
      color: i % 4 === 0 ? "#fff" : col,
      alpha: 1,
      size: type === "star" ? 3 + Math.random() * 3 : type === "ring" ? 4 + Math.random() * 4 : 1.5 + Math.random() * 3,
      gravity: 0.05 + Math.random() * 0.08,
      type,
    });
  }
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const spikes = 5; let rot = (Math.PI / 2) * 3; const step = Math.PI / spikes;
  ctx.beginPath(); ctx.moveTo(x, y - r);
  for (let i = 0; i < spikes; i++) {
    ctx.lineTo(x + Math.cos(rot) * r, y + Math.sin(rot) * r); rot += step;
    ctx.lineTo(x + Math.cos(rot) * (r * 0.45), y + Math.sin(rot) * (r * 0.45)); rot += step;
  }
  ctx.lineTo(x, y - r); ctx.closePath(); ctx.fill();
}

export function CelebrationOverlay() {
  const { celebrating, celebrationTask, pointsEarned, clearCelebration } = useCelebrationStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const psRef = useRef<Particle[]>([]);
  const rocketsRef = useRef<Rocket[]>([]);
  const rafRef = useRef<number>(0);

  const animate = useCallback(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;

    ctx.fillStyle = "rgba(22,42,28,0.2)";
    ctx.fillRect(0, 0, c.width, c.height);

    // Rockets
    for (const r of rocketsRef.current) {
      r.trail.push({ x: r.x, y: r.y, alpha: 1 });
      if (r.trail.length > 20) r.trail.shift();
      r.trail.forEach((t, i) => {
        ctx.save(); ctx.globalAlpha = (i / r.trail.length) * 0.8 * t.alpha;
        ctx.fillStyle = r.color; ctx.shadowColor = r.color; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(t.x, t.y, 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.restore(); t.alpha -= 0.035;
      });
      r.x += r.vx; r.y += r.vy; r.vy += 0.15;
    }

    // Burst rockets that peaked
    const alive: Rocket[] = [];
    for (const r of rocketsRef.current) {
      if (r.vy >= -0.2) {
        burst(psRef.current, r.x, r.y, r.color, 90 + Math.floor(Math.random() * 50));
        // Ring burst
        for (let i = 0; i < 20; i++) {
          const a = (Math.PI * 2 * i) / 20;
          psRef.current.push({ x: r.x, y: r.y, vx: Math.cos(a) * 7, vy: Math.sin(a) * 7, color: "#fff", alpha: 0.9, size: 2, gravity: 0, type: "ring" });
        }
      } else { alive.push(r); }
    }
    rocketsRef.current = alive;

    // Particles
    psRef.current = psRef.current.filter(p => p.alpha > 0.015);
    for (const p of psRef.current) {
      ctx.save(); ctx.globalAlpha = p.alpha; ctx.fillStyle = p.color; ctx.strokeStyle = p.color;
      ctx.shadowColor = p.color; ctx.shadowBlur = p.type === "star" ? 12 : 5;
      if (p.type === "star") { drawStar(ctx, p.x, p.y, p.size); }
      else if (p.type === "ring") { ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.lineWidth = 1.5; ctx.stroke(); }
      else { ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
      p.x += p.vx; p.y += p.vy; p.vy += p.gravity; p.vx *= 0.975;
      p.alpha -= p.type === "ring" ? 0.035 : 0.017; p.size *= 0.994;
    }
    rafRef.current = requestAnimationFrame(animate);
  }, []);

  const launchRocket = useCallback(() => {
    const c = canvasRef.current; if (!c) return;
    const x = c.width * (0.1 + Math.random() * 0.8);
    const speed = 14 + Math.random() * 8;
    rocketsRef.current.push({ x, y: c.height, vx: (Math.random() - 0.5) * 3, vy: -speed, color: randomCol(), trail: [] });
  }, []);

  useEffect(() => {
    if (!celebrating) { cancelAnimationFrame(rafRef.current); psRef.current = []; rocketsRef.current = []; return; }
    const c = canvasRef.current; if (!c) return;
    c.width = window.innerWidth; c.height = window.innerHeight;
    rafRef.current = requestAnimationFrame(animate);

    let count = 0;
    const fire = () => {
      if (count >= 14) return; count++;
      launchRocket();
      if (Math.random() > 0.5) setTimeout(launchRocket, 150 + Math.random() * 200);
      setTimeout(fire, count < 5 ? 250 + Math.random() * 150 : 450 + Math.random() * 500);
    };
    fire();

    const t = setTimeout(clearCelebration, 5500);
    return () => { cancelAnimationFrame(rafRef.current); clearTimeout(t); };
  }, [celebrating, animate, launchRocket, clearCelebration]);

  if (!celebrating || !celebrationTask) return null;

  return (
    <div style={{ position:"fixed", inset:0, zIndex:200, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={clearCelebration}>
      <canvas ref={canvasRef} style={{ position:"absolute", inset:0, width:"100%", height:"100%", pointerEvents:"none" }}/>
      <div style={{ position:"relative", zIndex:1, textAlign:"center", padding:"24px 32px", background:"#1e3629", border:"4px solid #e8a820", boxShadow:"0 0 60px rgba(232,168,32,0.5), 0 0 120px rgba(232,168,32,0.2), 0 30px 80px rgba(0,0,0,0.9)", animation:"celebin 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards", pointerEvents:"none" }}>
        <div style={{ fontFamily:"'Oswald',Arial,sans-serif", fontSize:10, fontWeight:700, letterSpacing:"0.25em", textTransform:"uppercase", color:"#e8a820", marginBottom:6 }}>🎆 ORDER COMPLETE 🎆</div>
        <div style={{ height:3, background:"linear-gradient(90deg,transparent,#e8a820,transparent)", marginBottom:12 }}/>
        <div style={{ fontFamily:"'Oswald',Arial,sans-serif", fontSize:15, fontWeight:600, letterSpacing:"0.06em", textTransform:"uppercase", color:"#f5f0e0", marginBottom:10 }}>{celebrationTask.title}</div>
        <div className="panel" style={{ width:80, height:66, margin:"0 auto 8px" }}><span className="panel-num gold" style={{ fontSize:42 }}>+{pointsEarned}</span></div>
        <div style={{ fontFamily:"'IM Fell English',Georgia,serif", fontStyle:"italic", fontSize:10, color:"rgba(232,168,32,0.5)" }}>points · Focus Score {celebrationTask.focus_score} × 18</div>
        <div style={{ height:3, background:"linear-gradient(90deg,transparent,#e8a820,transparent)", marginTop:12, marginBottom:6 }}/>
        <div style={{ fontFamily:"'IM Fell English',Georgia,serif", fontStyle:"italic", fontSize:9, color:"rgba(245,240,224,0.25)" }}>tap to dismiss</div>
      </div>
    </div>
  );
}
