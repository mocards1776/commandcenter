import { useState } from "react";
import { Calendar, Plus, Clock, X } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { cn } from "@/lib/utils";
import toast from "react-hot-toast";

const HOURS = Array.from({ length: 16 }, (_, i) => i + 6); // 6 AM to 10 PM

const BLOCK_COLORS = [
  "#6366f1", "#8b5cf6", "#22c55e", "#f59e0b",
  "#f43f5e", "#38bdf8", "#fb923c", "#a78bfa",
];

interface Block {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  color: string;
}

function timeToMinutes(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function TimeSlotBlock({ block }: { block: Block }) {
  const start = new Date(block.start_time);
  const end = new Date(block.end_time);
  const startMin = start.getHours() * 60 + start.getMinutes();
  const endMin = end.getHours() * 60 + end.getMinutes();
  const top = ((startMin - 6 * 60) / 60) * 64; // 64px per hour
  const height = ((endMin - startMin) / 60) * 64;

  return (
    <div
      className="absolute left-1 right-1 rounded-lg px-2 py-1 overflow-hidden cursor-pointer hover:brightness-110 transition-all"
      style={{ top, height: Math.max(height, 24), backgroundColor: block.color + "33", borderLeft: `3px solid ${block.color}` }}
      title={block.title}
    >
      <p className="text-xs font-semibold truncate" style={{ color: block.color }}>{block.title}</p>
      <p className="text-[10px] opacity-60" style={{ color: block.color }}>
        {start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} –
        {end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </p>
    </div>
  );
}

function NewBlockForm({ onClose, selectedDate }: { onClose: () => void; selectedDate: string }) {
  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [color, setColor] = useState(BLOCK_COLORS[0]);
  const qc = useQueryClient();

  const createMutation = useMutation({
    mutationFn: () => axios.post("/api/time-blocks/", {
      title,
      start_time: `${selectedDate}T${startTime}:00`,
      end_time: `${selectedDate}T${endTime}:00`,
      color,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["time-blocks"] });
      toast.success("Time block created!");
      onClose();
    },
  });

  return (
    <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-indigo-300">New Time Block</h3>
        <button onClick={onClose}><X className="w-4 h-4 text-slate-500" /></button>
      </div>
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Block title…" autoFocus
        className="w-full bg-[#0d0d1f] border border-[#2a2a45] rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none" />
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-xs text-slate-500 mb-1 block">Start</label>
          <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
            className="w-full bg-[#0d0d1f] border border-[#2a2a45] rounded-xl px-3 py-2 text-sm text-white outline-none" />
        </div>
        <div className="flex-1">
          <label className="text-xs text-slate-500 mb-1 block">End</label>
          <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
            className="w-full bg-[#0d0d1f] border border-[#2a2a45] rounded-xl px-3 py-2 text-sm text-white outline-none" />
        </div>
      </div>
      <div className="flex gap-2 items-center">
        <span className="text-xs text-slate-500">Color:</span>
        {BLOCK_COLORS.map(c => (
          <button key={c} onClick={() => setColor(c)}
            className={cn("w-6 h-6 rounded-full transition-all", color === c && "ring-2 ring-white ring-offset-1 ring-offset-[#0d0d1f]")}
            style={{ backgroundColor: c }} />
        ))}
      </div>
      <button
        onClick={() => title.trim() && createMutation.mutate()}
        disabled={!title.trim() || createMutation.isPending}
        className="w-full py-2 rounded-xl bg-indigo-500 text-white font-semibold text-sm hover:bg-indigo-600 disabled:opacity-50"
      >
        Create Block
      </button>
    </div>
  );
}

export function TimeBlockPage() {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  const [showNew, setShowNew] = useState(false);
  const qc = useQueryClient();

  const { data: blocks } = useQuery<Block[]>({
    queryKey: ["time-blocks", selectedDate],
    queryFn: () =>
      axios.get(`/api/time-blocks/?date=${selectedDate}`).then(r => r.data).catch(() => []),
  });

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowTop = ((nowMin - 6 * 60) / 60) * 64;
  const isToday = selectedDate === new Date().toISOString().split("T")[0];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black text-white flex items-center gap-2">
          <Calendar className="w-6 h-6 text-amber-400" />
          Time Blocks
        </h1>
        <button
          onClick={() => setShowNew(!showNew)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-300 hover:bg-amber-500/30 text-sm font-medium transition-all"
        >
          <Plus className="w-4 h-4" /> New Block
        </button>
      </div>

      {/* Date picker */}
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={selectedDate}
          onChange={e => setSelectedDate(e.target.value)}
          className="bg-[#12121f] border border-[#2a2a45] rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-amber-500/40"
        />
        <button
          onClick={() => setSelectedDate(new Date().toISOString().split("T")[0])}
          className="px-3 py-2 rounded-xl border border-[#2a2a45] text-slate-400 text-sm hover:text-white hover:border-[#3d3d6b] transition-colors"
        >
          Today
        </button>
      </div>

      {showNew && <NewBlockForm onClose={() => setShowNew(false)} selectedDate={selectedDate} />}

      {/* Timeline */}
      <div className="flex gap-0 overflow-hidden rounded-2xl border border-[#2a2a45] bg-[#0d0d1f]">
        {/* Hour labels */}
        <div className="w-16 shrink-0 border-r border-[#1e1e35]">
          {HOURS.map(h => (
            <div key={h} className="h-16 flex items-start pt-1 px-2">
              <span className="text-[10px] text-slate-600 font-mono">
                {h > 12 ? `${h - 12}pm` : h === 12 ? "12pm" : `${h}am`}
              </span>
            </div>
          ))}
        </div>

        {/* Blocks area */}
        <div className="flex-1 relative">
          {/* Hour grid lines */}
          {HOURS.map(h => (
            <div key={h} className="h-16 border-b border-[#1a1a2e]" />
          ))}

          {/* Now indicator */}
          {isToday && nowMin >= 360 && nowMin <= 1320 && (
            <div
              className="absolute left-0 right-0 flex items-center z-10"
              style={{ top: nowTop }}
            >
              <div className="w-2 h-2 rounded-full bg-rose-400 shrink-0 -ml-1" />
              <div className="flex-1 h-px bg-rose-400 opacity-70" />
            </div>
          )}

          {/* Blocks */}
          {blocks?.map(block => (
            <TimeSlotBlock key={block.id} block={block} />
          ))}

          {blocks?.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center text-slate-700">
                <Clock className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No blocks for this day</p>
                <p className="text-xs mt-1">Click "New Block" to add one</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-600 text-center">
        💡 Google Calendar sync coming soon — connect your account in settings
      </p>
    </div>
  );
}
