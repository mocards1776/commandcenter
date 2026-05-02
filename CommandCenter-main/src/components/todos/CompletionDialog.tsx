import { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { tasksApi } from "@/lib/api";
import { useCelebrationStore } from "@/store";
import { calcPoints } from "./CelebrationOverlay";
import type { Task } from "@/types";
import toast from "react-hot-toast";

const FONT   = "'Oswald',Arial,sans-serif";
const SERIF  = "'IM Fell English',Georgia,serif";
const GOLD   = "#e8a820";
const FG     = "#f5f0e0";
const PANEL  = "#0e1f14";
const DIM    = "rgba(245,240,224,0.22)";
const MUTED  = "rgba(245,240,224,0.55)";
const LOSS   = "#d94040";
const WIN    = "#4caf50";
const BG     = "#162a1c";

// ── duration presets ─────────────────────────────────────────
const PRESETS = [
  { label: "5m",  value: 5  },
  { label: "10m", value: 10 },
  { label: "15m", value: 15 },
  { label: "20m", value: 20 },
  { label: "30m", value: 30 },
  { label: "45m", value: 45 },
  { label: "1h",  value: 60 },
  { label: "1.5h",value: 90 },
  { label: "2h",  value: 120},
];

interface Props {
  task: Task;
  onClose: () => void;
  /** Called after everything is done (celebration already triggered) */
  onDone: () => void;
  /** elapsed seconds from timer if task was timed */
  elapsedSeconds?: number;
}

type Step = "duration" | "followup";

export function CompletionDialog({ task, onClose, onDone, elapsedSeconds = 0 }: Props) {
  const [step, setStep] = useState<Step>("duration");
  const [selectedMin, setSelectedMin] = useState<number | null>(null);
  const [customMin, setCustomMin] = useState("");
  const [followupTitle, setFollowupTitle] = useState("");
  const [skipFollowup, setSkipFollowup] = useState(false);
  const qc = useQueryClient();
  const { triggerCelebration } = useCelebrationStore();
  const inputRef = useRef<HTMLInputElement>(null);

  // Pre-select duration from timer if available
  useEffect(() => {
    if (elapsedSeconds > 0) {
      const min = Math.round(elapsedSeconds / 60);
      setSelectedMin(min);
    }
  }, [elapsedSeconds]);

  useEffect(() => {
    if (step === "followup") inputRef.current?.focus();
  }, [step]);

  const completeMut = useMutation({
    mutationFn: async () => {
      const actualMin = selectedMin ?? (customMin ? parseInt(customMin) : undefined);
      // Patch actual_time_minutes (best-effort — don't block completion if it fails)
      if (actualMin && actualMin > 0) {
        try { await tasksApi.update(task.id, { actual_time_minutes: actualMin }); } catch {}
      }
      return tasksApi.complete(task.id);
    },
    onSuccess: async (completed) => {
      // Create follow-up task if requested
      if (followupTitle.trim()) {
        try {
          await tasksApi.create({
            title: followupTitle.trim(),
            status: "today",
            priority: task.priority,
            importance: task.importance,
            difficulty: task.difficulty,
            project_id: task.project_id ?? undefined,
            tag_ids: task.tag_ids ?? [],
            show_in_daily: true,
          });
          toast.success("Follow-up task added");
        } catch {
          toast.error("Follow-up task failed to save");
        }
      }
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      // NOW fire the fireworks
      triggerCelebration(completed, calcPoints(completed));
      onDone();
    },
    onError: (e: any) => {
      toast.error(`Complete failed: ${e?.response?.data?.detail ?? e?.message ?? "unknown"}`);
    },
  });

  const durationMin = selectedMin ?? (customMin ? parseInt(customMin) || 0 : 0);

  function handleDurationNext() {
    setStep("followup");
  }

  function handleFinish() {
    completeMut.mutate();
  }

  const btnBase: React.CSSProperties = {
    fontFamily: FONT, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em",
    textTransform: "uppercase", border: "1px solid", borderRadius: 2, padding: "7px 16px",
    cursor: "pointer", transition: "all 0.12s",
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 190,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)",
    }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: BG, border: "2px solid rgba(232,168,32,0.35)",
        boxShadow: "0 0 60px rgba(232,168,32,0.12), 0 30px 80px rgba(0,0,0,0.8)",
        width: "min(420px, 92vw)", borderRadius: 3,
        animation: "celebin 0.3s cubic-bezier(0.34,1.56,0.64,1) forwards",
      }}>
        {/* Header */}
        <div style={{ borderBottom: "1px solid rgba(232,168,32,0.2)", padding: "10px 16px" }}>
          <div style={{ fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: "0.25em", textTransform: "uppercase", color: GOLD }}>
            {step === "duration" ? "⏱ ORDER DEBRIEF — DURATION" : "📋 ORDER DEBRIEF — FOLLOW UP"}
          </div>
          <div style={{ fontFamily: FONT, fontSize: 13, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: FG, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {task.title}
          </div>
        </div>

        <div style={{ padding: "14px 16px 16px" }}>

          {/* ── STEP 1: Duration ── */}
          {step === "duration" && (
            <>
              <div style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: 11, color: MUTED, marginBottom: 12 }}>
                How long did this actually take?
              </div>

              {/* Preset chips — tap once to select AND advance */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 12 }}>
                {PRESETS.map(p => (
                  <button key={p.value} type="button"
                    onClick={() => { setSelectedMin(p.value); setCustomMin(""); setStep("followup"); }}
                    style={{
                      ...btnBase,
                      background: selectedMin === p.value ? "rgba(232,168,32,0.15)" : "transparent",
                      borderColor: selectedMin === p.value ? GOLD : "rgba(232,168,32,0.2)",
                      color: selectedMin === p.value ? GOLD : MUTED,
                      padding: "5px 10px", fontSize: 10,
                    }}>
                    {p.label}
                  </button>
                ))}
              </div>

              {/* Custom input */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <input
                  type="number" min={1} max={999}
                  placeholder="Custom minutes…"
                  value={customMin}
                  onChange={e => { setCustomMin(e.target.value); setSelectedMin(null); }}
                  style={{
                    flex: 1, fontFamily: FONT, fontSize: 11, letterSpacing: "0.04em",
                    background: PANEL, border: "1px solid rgba(232,168,32,0.2)",
                    color: FG, padding: "6px 10px", borderRadius: 2, outline: "none",
                  }}
                  onFocus={e => e.currentTarget.style.borderColor = GOLD}
                  onBlur={e => e.currentTarget.style.borderColor = "rgba(232,168,32,0.2)"}
                />
                <span style={{ fontFamily: FONT, fontSize: 9, color: DIM, letterSpacing: "0.1em" }}>MIN</span>
              </div>

              {/* Timer suggestion */}
              {elapsedSeconds > 0 && (
                <div style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: 10, color: `${GOLD}88`, marginBottom: 12 }}>
                  Timer recorded {Math.round(elapsedSeconds / 60)}m — pre-selected above
                </div>
              )}

              {/* Buttons */}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" onClick={onClose}
                  style={{ ...btnBase, background: "transparent", borderColor: "rgba(245,240,224,0.1)", color: DIM }}>
                  Cancel
                </button>
                <button type="button" onClick={handleDurationNext}
                  style={{ ...btnBase, background: durationMin > 0 ? "rgba(232,168,32,0.12)" : "transparent", borderColor: durationMin > 0 ? GOLD : "rgba(232,168,32,0.25)", color: durationMin > 0 ? GOLD : MUTED }}>
                  {durationMin > 0 ? `Next — ${durationMin}m logged` : "Skip →"}
                </button>
              </div>
            </>
          )}

          {/* ── STEP 2: Follow-up ── */}
          {step === "followup" && (
            <>
              <div style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: 11, color: MUTED, marginBottom: 12 }}>
                Does this order require a follow-up task?
              </div>

              <input
                ref={inputRef}
                type="text"
                placeholder="Follow-up task title… (leave blank to skip)"
                value={followupTitle}
                onChange={e => setFollowupTitle(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleFinish(); if (e.key === "Escape") onClose(); }}
                style={{
                  width: "100%", fontFamily: FONT, fontSize: 12, letterSpacing: "0.04em",
                  background: PANEL, border: "1px solid rgba(232,168,32,0.2)",
                  color: FG, padding: "8px 12px", borderRadius: 2, outline: "none",
                  marginBottom: 14, boxSizing: "border-box",
                }}
                onFocus={e => e.currentTarget.style.borderColor = GOLD}
                onBlur={e => e.currentTarget.style.borderColor = "rgba(232,168,32,0.2)"}
              />

              <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center" }}>
                <button type="button" onClick={() => setStep("duration")}
                  style={{ ...btnBase, background: "transparent", borderColor: "rgba(245,240,224,0.1)", color: DIM, fontSize: 10 }}>
                  ← Back
                </button>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" onClick={onClose}
                    style={{ ...btnBase, background: "transparent", borderColor: "rgba(245,240,224,0.1)", color: DIM }}>
                    Cancel
                  </button>
                  <button type="button" onClick={handleFinish} disabled={completeMut.isPending}
                    style={{ ...btnBase, background: "rgba(76,175,80,0.12)", borderColor: WIN, color: WIN }}>
                    {completeMut.isPending ? "Completing…" : followupTitle.trim() ? "✓ Complete + Add Follow-up" : "✓ Complete"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
