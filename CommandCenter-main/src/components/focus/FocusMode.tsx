import { useState, useRef } from "react";
import { X, Square, CheckCircle, Plus } from "lucide-react";
import { useFocusStore } from "@/store";
import { useActiveTimer } from "@/hooks/useTimer";
import { tasksApi } from "@/lib/api";
import { formatDuration, formatMinutes } from "@/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

const QUOTES = [
  "The secret of getting ahead is getting started. — Mark Twain",
  "Do or do not. There is no try. — Yoda",
  "Stay the course. The reward is worth the grind.",
  "Discipline is choosing between what you want now and what you want most.",
  "Every expert was once a beginner. Every pro was once an amateur.",
  "Hard work beats talent when talent doesn't work hard.",
  "You don't have to be great to start, but you have to start to be great.",
  "Press forward. Do not stop, do not linger. — Goethe",
];

const quote = QUOTES[Math.floor(Math.random() * QUOTES.length)];

export function FocusMode() {
  const { isFocusMode, setFocus } = useFocusStore();
  const { activeTask, elapsedSeconds, stop, completeAndStop, isRunning } = useActiveTimer();
  const [subtaskInput, setSubtaskInput] = useState("");
  const [showSubtask, setShowSubtask] = useState(false);
  const subtaskRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const est = activeTask?.time_estimate_minutes;
  const pct = est ? Math.min((elapsedSeconds / 60 / est) * 100, 100) : 0;
  const r = 90, circ = 2 * Math.PI * r, off = circ - (pct / 100) * circ;

  // ─── Complete task ───────────────────────────────────────
  const completeMut = useMutation({
    mutationFn: async () => {
      await completeAndStop();
    },
    onSuccess: () => {
      toast.success("✅ Task completed!", { duration: 2200 });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setFocus(false);
    },
    onError: () => toast.error("Failed to complete task"),
  });

  // ─── Add subtask ─────────────────────────────────────────
  const subtaskMut = useMutation({
    mutationFn: (title: string) =>
      tasksApi.create({
        title,
        status: "today",
        ...(activeTask?.project_id ? { project_id: activeTask.project_id } : {}),
      }),
    onSuccess: (task) => {
      toast.success(`+ ${task.title}`, { duration: 1800 });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      setSubtaskInput("");
      setShowSubtask(false);
    },
    onError: () => toast.error("Failed to add subtask"),
  });

  const handleSubtaskSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = subtaskInput.trim();
    if (!t) return;
    subtaskMut.mutate(t);
  };

  if (!isFocusMode) return null;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      background: "#1a2f22",
    }}>
      {/* Top + bottom accent bars */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 5, background: "#e8a820" }} />
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 5, background: "#e8a820" }} />

      {/* Close button */}
      <button
        onClick={() => setFocus(false)}
        style={{
          position: "absolute", top: 20, right: 20,
          background: "none", border: "1px solid rgba(232,168,32,0.2)",
          borderRadius: 2, cursor: "pointer", color: "rgba(232,168,32,0.4)", padding: 8,
        }}
        onMouseEnter={e => (e.currentTarget.style.color = "#e8a820")}
        onMouseLeave={e => (e.currentTarget.style.color = "rgba(232,168,32,0.4)")}>
        <X size={18} />
      </button>

      {/* Live indicator */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
        <div className="live-dot" />
        <span style={{
          fontFamily: "'Oswald',Arial,sans-serif", fontSize: 10, fontWeight: 700,
          letterSpacing: "0.25em", textTransform: "uppercase", color: "#d94040",
        }}>Focus Session 🇺🇸</span>
      </div>

      {/* Task title */}
      <div style={{
        fontFamily: "'Oswald',Arial,sans-serif",
        fontSize: "clamp(22px,4vw,40px)",
        fontWeight: 700, textAlign: "center",
        color: "#f5f0e0", maxWidth: 700, lineHeight: 1.2,
        marginBottom: 4, padding: "0 24px",
        letterSpacing: "0.04em", textTransform: "uppercase",
      }}>
        {activeTask?.title ?? "Deep Work Session"}
      </div>

      {/* Description */}
      {activeTask?.description && (
        <p style={{
          fontFamily: "'IM Fell English',Georgia,serif",
          fontStyle: "italic", fontSize: 13,
          color: "rgba(245,240,224,0.35)",
          textAlign: "center", maxWidth: 500,
          marginBottom: 24, lineHeight: 1.6,
        }}>
          {activeTask.description}
        </p>
      )}

      <div style={{ height: 3, width: 140, background: "#e8a820", marginBottom: 24 }} />

      {/* Timer ring */}
      <div style={{
        position: "relative", width: 220, height: 220,
        display: "flex", alignItems: "center", justifyContent: "center",
        marginBottom: 20,
      }}>
        <svg width={220} height={220} style={{ position: "absolute", transform: "rotate(-90deg)" }} viewBox="0 0 220 220">
          <circle cx={110} cy={110} r={r} fill="none" stroke="#1e3629" strokeWidth={4} />
          <circle
            cx={110} cy={110} r={r} fill="none"
            stroke="#e8a820" strokeWidth={4}
            strokeDasharray={circ} strokeDashoffset={off}
            strokeLinecap="square"
            style={{ filter: "drop-shadow(0 0 6px rgba(232,168,32,0.5))", transition: "stroke-dashoffset 1s linear" }}
          />
        </svg>
        <div style={{ textAlign: "center" }}>
          <div style={{
            fontFamily: "'Oswald',Arial,sans-serif",
            fontSize: 46, fontWeight: 700,
            color: "#e8a820",
            textShadow: "0 0 20px rgba(232,168,32,0.4)",
            lineHeight: 1,
          }}>{formatDuration(elapsedSeconds)}</div>
          <div style={{
            fontSize: 9, fontWeight: 600,
            letterSpacing: "0.18em", textTransform: "uppercase",
            color: "rgba(245,240,224,0.3)", marginTop: 4,
          }}>elapsed</div>
        </div>
      </div>

      {/* Stats row */}
      {activeTask && (
        <div style={{ display: "flex", gap: 24, marginBottom: 24 }}>
          {est && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(245,240,224,0.3)", marginBottom: 3 }}>Estimated</div>
              <div style={{ fontFamily: "'Oswald',Arial,sans-serif", fontSize: 14, fontWeight: 600, color: "#f5f0e0" }}>{formatMinutes(est)}</div>
            </div>
          )}
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(245,240,224,0.3)", marginBottom: 3 }}>Focus Score</div>
            <div style={{ fontFamily: "'Oswald',Arial,sans-serif", fontSize: 14, fontWeight: 600, color: "#e8a820" }}>{activeTask.focus_score}</div>
          </div>
        </div>
      )}

      {/* ─── Action buttons ─── */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>

        {/* Complete Task */}
        {activeTask && (
          <button
            onClick={() => completeMut.mutate()}
            disabled={completeMut.isPending}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "13px 32px",
              background: completeMut.isPending ? "rgba(50,140,60,0.5)" : "rgba(50,160,70,0.15)",
              border: "2px solid rgba(80,200,100,0.55)",
              borderRadius: 3, cursor: completeMut.isPending ? "not-allowed" : "pointer",
              color: "#7de87d",
              fontFamily: "'Oswald',Arial,sans-serif",
              fontSize: 14, fontWeight: 700,
              letterSpacing: "0.18em", textTransform: "uppercase",
              transition: "all 0.15s",
            }}
            onMouseEnter={e => { if (!completeMut.isPending) { e.currentTarget.style.background = "rgba(50,160,70,0.28)"; e.currentTarget.style.borderColor = "rgba(80,200,100,0.85)"; } }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(50,160,70,0.15)"; e.currentTarget.style.borderColor = "rgba(80,200,100,0.55)"; }}
          >
            <CheckCircle size={16} />
            {completeMut.isPending ? "Completing..." : "Complete Task"}
          </button>
        )}

        {/* Add Subtask */}
        {activeTask && !showSubtask && (
          <button
            onClick={() => { setShowSubtask(true); setTimeout(() => subtaskRef.current?.focus(), 50); }}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "9px 22px",
              background: "none",
              border: "1px solid rgba(232,168,32,0.25)",
              borderRadius: 3, cursor: "pointer",
              color: "rgba(232,168,32,0.55)",
              fontFamily: "'Oswald',Arial,sans-serif",
              fontSize: 12, fontWeight: 600,
              letterSpacing: "0.15em", textTransform: "uppercase",
              transition: "all 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.color = "#e8a820"; e.currentTarget.style.borderColor = "rgba(232,168,32,0.6)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "rgba(232,168,32,0.55)"; e.currentTarget.style.borderColor = "rgba(232,168,32,0.25)"; }}
          >
            <Plus size={13} /> Add Subtask
          </button>
        )}

        {/* Subtask inline form */}
        {showSubtask && (
          <form onSubmit={handleSubtaskSubmit} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              ref={subtaskRef}
              value={subtaskInput}
              onChange={e => setSubtaskInput(e.target.value)}
              placeholder="Subtask title..."
              style={{
                background: "rgba(0,0,0,0.35)",
                border: "1px solid rgba(232,168,32,0.4)",
                borderRadius: 3,
                color: "#f5f0e0",
                fontFamily: "'Oswald',Arial,sans-serif",
                fontSize: 13,
                padding: "9px 14px",
                outline: "none",
                width: 240,
                letterSpacing: "0.05em",
              }}
              onFocus={e => (e.target.style.borderColor = "rgba(232,168,32,0.8)")}
              onBlur={e => (e.target.style.borderColor = "rgba(232,168,32,0.4)")}
              onKeyDown={e => { if (e.key === "Escape") { setShowSubtask(false); setSubtaskInput(""); } }}
            />
            <button
              type="submit"
              disabled={subtaskMut.isPending || !subtaskInput.trim()}
              style={{
                padding: "9px 16px",
                background: "rgba(232,168,32,0.15)",
                border: "1px solid rgba(232,168,32,0.5)",
                borderRadius: 3, cursor: "pointer",
                color: "#e8a820",
                fontFamily: "'Oswald',Arial,sans-serif",
                fontSize: 12, fontWeight: 700,
                letterSpacing: "0.1em",
              }}
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => { setShowSubtask(false); setSubtaskInput(""); }}
              style={{
                padding: "9px 12px",
                background: "none",
                border: "1px solid rgba(245,240,224,0.12)",
                borderRadius: 3, cursor: "pointer",
                color: "rgba(245,240,224,0.35)",
                fontFamily: "'Oswald',Arial,sans-serif",
                fontSize: 12,
              }}
            >
              Cancel
            </button>
          </form>
        )}

        {/* Stop Timer (only show if running, separate from complete) */}
        {isRunning && (
          <button
            onClick={() => { stop(); setFocus(false); }}
            className="btn btn-red"
            style={{ padding: "11px 24px", fontSize: 12, fontWeight: 700, letterSpacing: "0.15em", marginTop: 4 }}
          >
            <Square size={13} style={{ fill: "currentColor" }} /> Stop Timer (no complete)
          </button>
        )}
      </div>

      {/* ─── Quote ─── */}
      <p style={{
        position: "absolute",
        bottom: 22,
        fontFamily: "'IM Fell English',Georgia,serif",
        fontStyle: "italic",
        fontSize: 15,
        color: "rgba(232,168,32,0.6)",
        letterSpacing: "0.06em",
        textAlign: "center",
        padding: "0 32px",
        maxWidth: 600,
        lineHeight: 1.5,
      }}>
        {quote}
      </p>
    </div>
  );
}
