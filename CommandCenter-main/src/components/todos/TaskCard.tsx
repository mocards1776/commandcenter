import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { tasksApi } from "@/lib/api";
import { useActiveTimer } from "@/hooks/useTimer";
import { useTimerStore, useCelebrationStore, useFocusStore, usePinnedTaskStore } from "@/store";
import { TaskModal } from "./TaskModal";
import { TaskContextMenu } from "./TaskContextMenu";
import { calcPoints, formatDuration, formatMinutes, isOverdue } from "@/lib/utils";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { CompletionDialog } from "./CompletionDialog";
import type { Task } from "@/types";
import toast from "react-hot-toast";

// ─── Design tokens ────────────────────────────────────────────
const GOLD   = "#e8a820";
const DIM    = "rgba(245,240,224,0.22)";
const MUTED  = "rgba(245,240,224,0.55)";
const FG     = "#f5f0e0";
const WIN    = "#4caf50";
const LOSS   = "#d94040";
const FONT   = "'Oswald',Arial,sans-serif";
const PANEL  = "#0e1f14";

const PRIORITY_COLOR: Record<string, string> = {
  critical: LOSS,
  high:     GOLD,
  medium:   MUTED,
  low:      DIM,
};

// ─── Shared label style ───────────────────────────────────────
const LBL: React.CSSProperties = {
  fontFamily: FONT, fontSize: 7, fontWeight: 700,
  letterSpacing: "0.15em", textTransform: "uppercase",
  color: DIM, textAlign: "center",
};

// ─── Single flip-panel cell ───────────────────────────────────
function PanelCell({
  value, sub, color = "muted", small = true,
}: {
  value: string | number;
  sub?: string;
  color?: "gold" | "red" | "green" | "white" | "muted" | "dim";
  small?: boolean;
}) {
  const c =
    color === "gold"  ? GOLD  :
    color === "red"   ? LOSS  :
    color === "green" ? WIN   :
    color === "white" ? FG    :
    color === "muted" ? MUTED : DIM;

  const v  = String(value);
  const fs = v.length > 8 ? 8 : v.length > 5 ? 10 : v.length > 3 ? 12 : small ? 16 : 20;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <div style={{
        background: PANEL,
        border: "1px solid rgba(0,0,0,0.5)",
        borderRadius: 3,
        boxShadow: "inset 0 3px 5px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.03)",
        minWidth: small ? 36 : 44,
        height: small ? 30 : 38,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "2px 5px",
      }}>
        <span style={{
          fontFamily: FONT, fontSize: fs, fontWeight: 700,
          letterSpacing: "0.02em", color: c,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          maxWidth: 72,
        }}>{v}</span>
      </div>
      {sub && <div style={{ ...LBL, color: c === DIM ? DIM : `${c.replace(")", ",0.6)").replace("rgba","rgba").replace("rgb","rgba")}` }}>{sub}</div>}
    </div>
  );
}

// ─── Priority badge panel ─────────────────────────────────────
function PriorityPanel({ priority }: { priority: string }) {
  const c = PRIORITY_COLOR[priority] ?? MUTED;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <div style={{
        background: PANEL,
        border: `1px solid ${c}44`,
        borderRadius: 3,
        boxShadow: `inset 0 3px 5px rgba(0,0,0,0.55), 0 0 6px ${c}22`,
        minWidth: 52, height: 30,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "2px 6px",
      }}>
        <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 800,
          letterSpacing: "0.1em", color: c, textTransform: "uppercase" }}>
          {priority.toUpperCase()}
        </span>
      </div>
      <div style={LBL}>PRIORITY</div>
    </div>
  );
}

// ─── Focus score panel (colored by intensity) ─────────────────
function FocusScorePanel({ score }: { score: number }) {
  const c = score >= 20 ? LOSS : score >= 12 ? GOLD : score >= 6 ? MUTED : DIM;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <div style={{
        background: PANEL,
        border: `1px solid ${c}44`,
        borderRadius: 3,
        boxShadow: "inset 0 3px 5px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.03)",
        minWidth: 36, height: 30,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ fontFamily: FONT, fontSize: 18, fontWeight: 800, color: c,
          fontVariantNumeric: "tabular-nums" }}>{score}</span>
      </div>
      <div style={LBL}>FS</div>
    </div>
  );
}

// ─── Timer display ────────────────────────────────────────────
function TimerPanel({ seconds }: { seconds: number }) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const fmt = h > 0
    ? `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`
    : `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <div style={{
        background: PANEL, border: `1px solid ${LOSS}55`, borderRadius: 3,
        boxShadow: `inset 0 3px 5px rgba(0,0,0,0.55), 0 0 8px ${LOSS}33`,
        minWidth: 60, height: 30, display: "flex", alignItems: "center", justifyContent: "center",
        padding: "2px 6px",
      }}>
        <span style={{ fontFamily: FONT, fontSize: 14, fontWeight: 700, color: LOSS,
          fontVariantNumeric: "tabular-nums", letterSpacing: "0.04em" }}
          className="timer-pulse">{fmt}</span>
      </div>
      <div style={{ ...LBL, color: `${LOSS}99` }}>ACTIVE</div>
    </div>
  );
}

// ─── Completed task row ───────────────────────────────────────
export function TaskCard({ task, isPinned = false, onPin, onUnpin }: { task: Task; isPinned?: boolean; onPin?: () => void; onUnpin?: () => void }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [subsOpen, setSubsOpen]   = useState(false);
  const [completionOpen, setCompletionOpen] = useState(false);
  const qc = useQueryClient();
  const { isRunning, activeTimer, elapsedSeconds, start, stop } = useActiveTimer();
  const { setActiveTimer }     = useTimerStore();
  const { setFocus }           = useFocusStore();

  const isThisRunning = isRunning && activeTimer?.task_id === task.id;
  const overdue       = isOverdue(task.due_date);
  const activeSubs    = task.subtasks.filter(s => s.status !== "done");
  const priColor      = PRIORITY_COLOR[task.priority] ?? MUTED;

  const { setPinnedTask, pinnedTaskId } = usePinnedTaskStore();

  const openCompletion = () => setCompletionOpen(true);
  const handleCompletionDone = () => {
    if (pinnedTaskId === task.id) setPinnedTask(null);
    setCompletionOpen(false);
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const deleteMut = useMutation({
    mutationFn: () => tasksApi.delete(task.id),
    onSuccess: () => {
      if (pinnedTaskId === task.id) setPinnedTask(null);
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Deleted");
    },
    onError: (e: any) => {
      toast.error(`Delete failed: ${e?.response?.data?.detail ?? e?.message ?? "unknown"}`);
    },
  });

  const toggleTimer = () => {
    if (isThisRunning) stop();
    else { setActiveTimer(null, task); start({ task_id: task.id }); }
  };
  const handleTimer = (e: React.MouseEvent) => { e.stopPropagation(); toggleTimer(); };
  const handleDelete = () => { if (confirm(`Delete "${task.title}"?`)) deleteMut.mutate(); };

  // ── Completed task ───────────────────────────────────────────
  if (task.status === "done") {
    return (
      <>
        <TaskContextMenu task={task} isTimerRunning={false}
          onEdit={() => setModalOpen(true)} onComplete={() => {}}
          onToggleTimer={() => {}} onDelete={() => deleteMut.mutate()}>
          <div style={{
            margin: "0 10px 3px", display: "flex", alignItems: "center", gap: 8,
            padding: "5px 10px", background: "rgba(0,0,0,0.15)",
            border: "1px solid rgba(0,0,0,0.25)", opacity: 0.5,
          }}>
            <span style={{ color: WIN, fontSize: 13, flexShrink: 0 }}>✓</span>
            <span style={{ flex: 1, fontFamily: FONT, fontSize: 11, fontWeight: 600,
              letterSpacing: "0.06em", textTransform: "uppercase",
              color: "rgba(245,240,224,0.35)", textDecoration: "line-through",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {task.title}
            </span>
            {task.completed_at && (
              <span style={{ fontSize: 9, color: DIM, letterSpacing: "0.08em", flexShrink: 0 }}>
                {new Date(task.completed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <button type="button" title="Delete" onClick={e => { e.stopPropagation(); if (confirm("Delete?")) deleteMut.mutate(); }}
              disabled={deleteMut.isPending}
              style={{ background: "none", border: "none", cursor: "pointer",
                color: "rgba(217,64,64,0.35)", padding: "2px 4px", flexShrink: 0 }}
              onMouseEnter={e => (e.currentTarget.style.color = LOSS)}
              onMouseLeave={e => (e.currentTarget.style.color = "rgba(217,64,64,0.35)")}>
              <Trash2 size={12} />
            </button>
          </div>
        </TaskContextMenu>
        <TaskModal open={modalOpen} onClose={() => setModalOpen(false)} task={task} />
      </>
    );
  }

  // ── Active task — scoreboard card ────────────────────────────
  return (
    <>
      <TaskContextMenu task={task} isTimerRunning={isThisRunning}
        isPinned={isPinned} onPin={onPin} onUnpin={onUnpin}
        onEdit={() => setModalOpen(true)} onComplete={() => openCompletion()}
        onToggleTimer={toggleTimer} onDelete={handleDelete}>
        <div style={{ margin: "0 10px 5px" }}>

          {/* ── Main card ── */}
          <div style={{
            background: isThisRunning ? "rgba(217,64,64,0.06)" : "rgba(14,31,20,0.7)",
            border: `1px solid ${isThisRunning ? `${LOSS}55` : `${priColor}33`}`,
            borderLeft: `3px solid ${priColor}`,
            borderRadius: 3,
            boxShadow: isThisRunning
              ? `0 0 12px ${LOSS}22, inset 0 1px 0 rgba(255,255,255,0.03)`
              : "inset 0 1px 0 rgba(255,255,255,0.03)",
          }}>

            {/* ── Main layout: left (checkbox+title+play) | right (scoreboard panels) ── */}
            <div style={{ display: "flex", alignItems: "stretch" }}>

              {/* LEFT: checkbox + title + subtasks toggle + play */}
              <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, padding: "7px 8px 7px 10px" }}>
                {/* Checkbox */}
                <button type="button"
                  className={`sb-check ${false ? "done" : ""}`}
                  onClick={e => { e.stopPropagation(); openCompletion(); }}
                  disabled={false} title="Mark complete" style={{ flexShrink: 0 }}>
                  {false && "✓"}
                </button>

                {/* Pin indicator */}
                {isPinned && !isThisRunning && (
                  <span title="Pinned to top" style={{ fontSize: 10, color: GOLD, flexShrink: 0, opacity: 0.8 }}>📌</span>
                )}

                {/* Title */}
                <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }}
                  onClick={() => isThisRunning ? setFocus(true) : setModalOpen(true)}>
                  <div style={{
                    fontFamily: FONT, fontSize: 13, fontWeight: 700,
                    letterSpacing: "0.06em", textTransform: "uppercase",
                    color: FG, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>{task.title}</div>
                </div>

                {/* Subtask toggle */}
                {activeSubs.length > 0 && (
                  <button type="button"
                    onClick={e => { e.stopPropagation(); setSubsOpen(v => !v); }}
                    style={{ background: "none", border: "none", cursor: "pointer",
                      color: DIM, display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}
                    onMouseEnter={e => (e.currentTarget.style.color = GOLD)}
                    onMouseLeave={e => (e.currentTarget.style.color = DIM)}>
                    {subsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: "0.08em" }}>{activeSubs.length}</span>
                  </button>
                )}

                {/* Play/Stop */}
                <div className="task-play" onClick={handleTimer}
                  title={isThisRunning ? "Stop timer" : "Start timer"} style={{ flexShrink: 0 }}>
                  {isThisRunning ? <div className="tri-stop" /> : <div className="tri" />}
                </div>
              </div>

              {/* RIGHT: scoreboard stat panels — vertical divider then cells */}
              <div style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "5px 10px 5px 8px",
                borderLeft: "1px solid rgba(0,0,0,0.35)",
                flexShrink: 0,
              }}>
                {/* Priority */}
                <PriorityPanel priority={task.priority} />

                {/* Focus Score */}
                <FocusScorePanel score={task.focus_score} />

                {/* Est. Time */}
                {task.time_estimate_minutes != null && task.time_estimate_minutes > 0 && (
                  <PanelCell value={formatMinutes(task.time_estimate_minutes)} sub="EST" color="muted" />
                )}

                {/* Due date */}
                {task.due_date && (
                  <PanelCell
                    value={task.due_date}
                    sub={overdue ? "⚠ OVR" : "DUE"}
                    color={overdue ? "red" : "muted"}
                  />
                )}

                {/* Category — always show, dash if none */}
                <PanelCell
                  value={(task as any).category_name || "—"}
                  sub="CAT"
                  color={(task as any).category_name ? "muted" : "dim"}
                />

                {/* Tags — always show up to 2, dash if none */}
                {(task.tag_ids?.length ?? 0) > 0 ? (
                  task.tag_ids.slice(0, 2).map((tag: any, i: number) => (
                    <PanelCell
                      key={i}
                      value={typeof tag === "string" && tag.length > 9 ? tag.slice(0, 9) + "…" : tag}
                      sub={i === 0 ? "TAG" : ""}
                      color="dim"
                    />
                  ))
                ) : (
                  <PanelCell value="—" sub="TAG" color="dim" />
                )}

                {/* Active timer */}
                {isThisRunning && <TimerPanel seconds={elapsedSeconds} />}
              </div>
            </div>
          </div>

          {/* ── Subtasks ── */}
          {subsOpen && activeSubs.length > 0 && (
            <div style={{
              marginLeft: 12, background: "rgba(0,0,0,0.2)",
              borderLeft: "2px solid #1e3629", marginBottom: 2,
            }}>
              {activeSubs.map(sub => (
                <div key={sub.id} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "5px 10px", borderBottom: "1px solid rgba(0,0,0,0.2)",
                }}>
                  <div style={{ width: 12, height: 12,
                    border: "1px solid rgba(232,168,32,0.25)", borderRadius: 1, flexShrink: 0 }} />
                  <span style={{ fontFamily: FONT, fontSize: 11, letterSpacing: "0.04em",
                    textTransform: "uppercase", color: "rgba(245,240,224,0.4)", flex: 1 }}>
                    {sub.title}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </TaskContextMenu>
      <TaskModal open={modalOpen} onClose={() => setModalOpen(false)} task={task} />
      {completionOpen && (
        <CompletionDialog
          task={task}
          elapsedSeconds={isThisRunning ? elapsedSeconds : 0}
          onClose={() => setCompletionOpen(false)}
          onDone={handleCompletionDone}
        />
      )}
    </>
  );
}

