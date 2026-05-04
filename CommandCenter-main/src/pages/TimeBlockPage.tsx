import { useState } from "react";
import { Plus, X } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { tasksApi, api } from "@/lib/api";
import toast from "react-hot-toast";

const HOURS = Array.from({ length: 16 }, (_, i) => i + 6);
const BLOCK_COLORS = [
  "#6366f1","#8b5cf6","#22c55e","#f59e0b",
  "#f43f5e","#38bdf8","#fb923c","#a78bfa",
];

interface Block {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  color: string;
}

interface LayoutBlock extends Block {
  col: number;
  totalCols: number;
}

// ── Overlap detection: assigns column (col) and total sibling columns (totalCols)
function computeLayout(blocks: Block[]): LayoutBlock[] {
  if (!blocks.length) return [];
  const sorted = [...blocks].sort(
    (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  );
  const colEnds: number[] = [];
  const assignments: { block: Block; col: number }[] = [];

  for (const block of sorted) {
    const startMs = new Date(block.start_time).getTime();
    const endMs   = new Date(block.end_time).getTime();
    let col = colEnds.findIndex((end) => end <= startMs);
    if (col === -1) { col = colEnds.length; colEnds.push(endMs); }
    else colEnds[col] = endMs;
    assignments.push({ block, col });
  }

  return assignments.map(({ block, col }) => {
    const startMs = new Date(block.start_time).getTime();
    const endMs   = new Date(block.end_time).getTime();
    const maxCol  = Math.max(
      ...assignments
        .filter(({ block: b }) => {
          const bs = new Date(b.start_time).getTime();
          const be = new Date(b.end_time).getTime();
          return bs < endMs && be > startMs;
        })
        .map((a) => a.col)
    );
    return { ...block, col, totalCols: maxCol + 1 };
  });
}

// ── Single time-block pill
function TimeSlotBlock({
  block, col, totalCols, onColorChange,
}: {
  block: Block; col: number; totalCols: number;
  onColorChange: (id: string, color: string) => void;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const start    = new Date(block.start_time);
  const end      = new Date(block.end_time);
  const startMin = start.getHours() * 60 + start.getMinutes();
  const endMin   = end.getHours()   * 60 + end.getMinutes();
  const top      = ((startMin - 360) / 60) * 64;
  const height   = Math.max(((endMin - startMin) / 60) * 64, 24);
  const wPct     = 100 / totalCols;
  const lPct     = col * wPct;

  return (
    <div
      style={{
        position: "absolute",
        top, height,
        left:  `calc(${lPct}% + ${col > 0 ? 3 : 0}px)`,
        width: `calc(${wPct}% - ${totalCols > 1 ? 5 : 2}px)`,
        backgroundColor: block.color + "22",
        borderLeft: `3px solid ${block.color}`,
        borderRadius: "0 6px 6px 0",
        padding: "4px 6px",
        overflow: "visible",
        cursor: "pointer",
        zIndex: showPicker ? 20 : 1,
      }}
      onClick={() => setShowPicker((p) => !p)}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: block.color,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        letterSpacing: "0.04em" }}>
        {block.title}
      </div>
      {height >= 36 && (
        <div style={{ fontSize: 10, color: block.color + "99" }}>
          {start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} –{" "}
          {end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      )}

      {/* ── Color picker popover */}
      {showPicker && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 50,
            background: "#1a1a2e", border: "1px solid #2a2a45", borderRadius: 8,
            padding: "8px 10px", display: "flex", gap: 6, flexWrap: "wrap",
            width: 160, boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ width: "100%", fontSize: 9, color: "rgba(245,240,224,0.4)",
            letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 2 }}>
            Change Color
          </div>
          {BLOCK_COLORS.map((c) => (
            <button key={c}
              onClick={() => { onColorChange(block.id, c); setShowPicker(false); }}
              style={{
                width: 22, height: 22, borderRadius: "50%", backgroundColor: c, padding: 0,
                border: block.color === c ? "2px solid #f5f0e0" : "2px solid transparent",
                cursor: "pointer",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── New block form
function NewBlockForm({ onClose, selectedDate }: { onClose: () => void; selectedDate: string }) {
  const [title, setTitle]         = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime]     = useState("10:00");
  const [color, setColor]         = useState(BLOCK_COLORS[0]);
  const qc = useQueryClient();

  const createMutation = useMutation({
    mutationFn: () =>
      api.post("/time-blocks/", {
        title,
        start_time: `${selectedDate}T${startTime}:00`,
        end_time:   `${selectedDate}T${endTime}:00`,
        color,
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["time-blocks"] }); toast.success("Time block created!"); onClose(); },
  });

  return (
    <div style={{ background: "#12121f", border: "1px solid #2a2a45", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#f5f0e0" }}>New Time Block</h3>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(245,240,224,0.3)" }}><X size={14} /></button>
      </div>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Block title…" autoFocus
        className="w-full bg-[#0d0d1f] border border-[#2a2a45] rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {[["Start", startTime, setStartTime], ["End", endTime, setEndTime]].map(([label, val, setter]: any) => (
          <div key={label}>
            <div style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(245,240,224,0.3)", marginBottom: 3 }}>{label}</div>
            <input type="time" value={val} onChange={(e) => setter(e.target.value)}
              className="w-full bg-[#0d0d1f] border border-[#2a2a45] rounded-xl px-3 py-2 text-sm text-white outline-none" />
          </div>
        ))}
      </div>
      <div>
        <div style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(245,240,224,0.3)", marginBottom: 6 }}>Color</div>
        <div style={{ display: "flex", gap: 6 }}>
          {BLOCK_COLORS.map((c) => (
            <button key={c} onClick={() => setColor(c)}
              className={cn("w-6 h-6 rounded-full transition-all", color === c && "ring-2 ring-white ring-offset-1 ring-offset-[#0d0d1f]")}
              style={{ backgroundColor: c }} />
          ))}
        </div>
      </div>
      <button onClick={() => title.trim() && createMutation.mutate()}
        disabled={!title.trim() || createMutation.isPending}
        className="w-full py-2 rounded-xl bg-indigo-500 text-white font-semibold text-sm hover:bg-indigo-600 disabled:opacity-50">
        Create Block
      </button>
    </div>
  );
}

// ── Main page
export function TimeBlockPage() {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  const [showNew, setShowNew]           = useState(false);
  const qc = useQueryClient();

  const { data: blocks } = useQuery({
    queryKey: ["time-blocks", selectedDate],
    queryFn: () => api.get(`/time-blocks/?date=${selectedDate}`).then((r) => r.data).catch(() => []),
  });

  // Backlog: fetch today's + inbox tasks
  const { data: backlogRaw } = useQuery({
    queryKey: ["tasks", "backlog-timeblock"],
    queryFn: () => tasksApi.list({ status: "today,inbox,in_progress", limit: 100 }),
    refetchInterval: 60_000,
  });
  const backlogTasks = (backlogRaw ?? []).filter(
    (t: any) => t.status !== "done" && t.status !== "cancelled"
  );

  const updateColorMutation = useMutation({
    mutationFn: ({ id, color }: { id: string; color: string }) =>
      api.put(`/time-blocks/${id}/`, { color }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["time-blocks"] }); toast.success("Color updated!"); },
    onError:   () => toast.error("Failed to update color"),
  });

  const now    = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowTop = ((nowMin - 360) / 60) * 64;
  const isToday = selectedDate === new Date().toISOString().split("T")[0];
  const layoutBlocks = computeLayout(blocks ?? []);

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>

      {/* ════ CALENDAR COLUMN ════ */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column",
        padding: "16px 20px", gap: 12, overflowY: "auto" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 16, fontWeight: 700, letterSpacing: "0.1em",
            textTransform: "uppercase", color: "#f5f0e0", margin: 0 }}>Time Blocks</h1>
          <button onClick={() => setShowNew(!showNew)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-300 hover:bg-amber-500/30 text-sm font-medium transition-all">
            <Plus size={14} /> New Block
          </button>
          <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
            className="bg-[#12121f] border border-[#2a2a45] rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-amber-500/40" />
          <button onClick={() => setSelectedDate(new Date().toISOString().split("T")[0])}
            className="px-3 py-2 rounded-xl border border-[#2a2a45] text-slate-400 text-sm hover:text-white hover:border-[#3d3d6b] transition-colors">
            Today
          </button>
        </div>

        {showNew && <NewBlockForm onClose={() => setShowNew(false)} selectedDate={selectedDate} />}

        {/* Timeline */}
        <div style={{ display: "flex", gap: 0 }}>
          {/* Hour labels */}
          <div style={{ width: 48, flexShrink: 0 }}>
            {HOURS.map((h) => (
              <div key={h} style={{ height: 64, display: "flex", alignItems: "flex-start", paddingTop: 2 }}>
                <span style={{ fontSize: 10, color: "rgba(245,240,224,0.25)", letterSpacing: "0.06em" }}>
                  {h > 12 ? `${h - 12}pm` : h === 12 ? "12pm" : `${h}am`}
                </span>
              </div>
            ))}
          </div>

          {/* Blocks area */}
          <div style={{ flex: 1, position: "relative", borderLeft: "1px solid #1e1e35" }}>
            {HOURS.map((h) => <div key={h} style={{ height: 64, borderTop: "1px solid #1e1e35" }} />)}

            {/* Current time indicator */}
            {isToday && nowMin >= 360 && nowMin <= 1320 && (
              <div style={{ position: "absolute", left: 0, right: 0, top: nowTop,
                height: 2, background: "#f43f5e", zIndex: 10, opacity: 0.8 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#f43f5e", marginTop: -3, marginLeft: -4 }} />
              </div>
            )}

            {/* Laid-out blocks (overlap-aware) */}
            {layoutBlocks.map((block) => (
              <TimeSlotBlock
                key={block.id}
                block={block}
                col={block.col}
                totalCols={block.totalCols}
                onColorChange={(id, color) => updateColorMutation.mutate({ id, color })}
              />
            ))}

            {blocks?.length === 0 && (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: 6, pointerEvents: "none" }}>
                <div style={{ fontSize: 13, color: "rgba(245,240,224,0.2)", fontWeight: 600, letterSpacing: "0.08em" }}>No blocks for this day</div>
                <div style={{ fontSize: 11, color: "rgba(245,240,224,0.12)" }}>Click "New Block" to add one</div>
              </div>
            )}
          </div>
        </div>

        <div style={{ fontSize: 10, color: "rgba(245,240,224,0.2)", textAlign: "center", padding: "8px 0" }}>
          💡 Google Calendar sync coming soon — connect your account in settings
        </div>
      </div>

      {/* ════ BACKLOG SIDEBAR ════ */}
      <div style={{
        width: 232, flexShrink: 0, borderLeft: "1px solid #1e1e35",
        display: "flex", flexDirection: "column", background: "#0d0d1a", overflowY: "auto",
      }}>
        <div style={{ padding: "14px 14px 10px", borderBottom: "1px solid #1e1e35" }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em",
            textTransform: "uppercase", color: "rgba(232,168,32,0.65)" }}>📋 Backlog</div>
          <div style={{ fontSize: 10, color: "rgba(245,240,224,0.2)", marginTop: 3 }}>
            Today's unscheduled tasks
          </div>
        </div>

        <div style={{ flex: 1, padding: "10px", display: "flex", flexDirection: "column", gap: 5 }}>
          {backlogTasks.length === 0 ? (
            <div style={{ fontSize: 11, color: "rgba(245,240,224,0.15)", fontStyle: "italic",
              textAlign: "center", marginTop: 24 }}>
              All clear — no pending tasks
            </div>
          ) : (
            backlogTasks.map((task: any) => (
              <div key={task.id} style={{
                padding: "8px 10px",
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(245,240,224,0.07)",
                borderRadius: 6,
              }}>
                <div style={{
                  fontSize: 11, fontWeight: 600, letterSpacing: "0.04em",
                  textTransform: "uppercase", color: "#f5f0e0",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  fontFamily: "'Oswald', Arial, sans-serif",
                }}>
                  {task.title}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 3, alignItems: "center" }}>
                  <span style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                    color: task.status === "today" ? "#e8a820"
                         : task.status === "in_progress" ? "#38bdf8"
                         : "rgba(245,240,224,0.3)",
                  }}>
                    {task.status === "today" ? "📌 Today"
                   : task.status === "in_progress" ? "⚡ Active"
                   : "📥 Inbox"}
                  </span>
                  {task.time_estimate_minutes && (
                    <span style={{ fontSize: 9, color: "rgba(245,240,224,0.25)" }}>
                      ~{task.time_estimate_minutes}m
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

    </div>
  );
}
