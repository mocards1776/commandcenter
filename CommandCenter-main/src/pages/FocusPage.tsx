import { Focus, Play, Maximize2 } from "lucide-react";
import { useFocusStore } from "@/store";
import { useActiveTimer } from "@/hooks/useTimer";
import { useQuery } from "@tanstack/react-query";
import { tasksApi } from "@/lib/api";
import { useTimerStore } from "@/store";
import { cn, focusScoreColor } from "@/lib/utils";
import type { Task } from "@/types";

function FocusTaskRow({ task, onStart }: { task: Task; onStart: () => void }) {
  return (
    <button
      onClick={onStart}
      className="w-full text-left rounded-xl border border-[#2a2a45] bg-[#12121f] hover:border-violet-500/40 hover:bg-violet-500/5 p-4 transition-all group"
    >
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-white group-hover:text-violet-200 transition-colors">{task.title}</h3>
          <div className="flex gap-3 mt-1 text-xs text-slate-500">
            <span className={cn("font-bold", focusScoreColor(task.focus_score))}>FS:{task.focus_score}</span>
            <span>{task.priority}</span>
            {task.time_estimate_minutes && <span>~{task.time_estimate_minutes}m</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Play className="w-4 h-4 text-violet-400 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
    </button>
  );
}

export function FocusPage() {
  const { setFocus } = useFocusStore();
  const { start, isRunning } = useActiveTimer();
  const { setActiveTimer } = useTimerStore();

  const { data: tasks } = useQuery({
    queryKey: ["tasks", "focus"],
    queryFn: () => tasksApi.list({ status: "today" }),
  });

  // Sort by focus score descending
  const sorted = [...(tasks ?? [])].sort((a, b) => b.focus_score - a.focus_score);

  const handleStartFocus = (task: Task) => {
    setActiveTimer(null, task);
    start({ task_id: task.id });
    setFocus(true);
  };

  return (
    <div className="space-y-6 max-w-xl mx-auto">
      <div className="text-center">
        <div className="w-16 h-16 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mx-auto mb-4">
          <Focus className="w-8 h-8 text-violet-400" />
        </div>
        <h1 className="text-2xl font-black text-white">Focus Mode</h1>
        <p className="text-slate-500 mt-1 text-sm">Pick a task and enter distraction-free mode</p>
      </div>

      {isRunning && (
        <button
          onClick={() => setFocus(true)}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-violet-500/20 border border-violet-500/40 text-violet-300 hover:bg-violet-500/30 font-bold text-lg transition-all"
        >
          <Maximize2 className="w-5 h-5" />
          Back to Focus Session
        </button>
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider">
          Today's tasks — sorted by Focus Score
        </h2>
        {sorted.length === 0 ? (
          <div className="text-center py-10 text-slate-600">
            <p>No tasks for today. Add some in the Daily Todos!</p>
          </div>
        ) : (
          sorted.map(task => (
            <FocusTaskRow
              key={task.id}
              task={task}
              onStart={() => handleStartFocus(task)}
            />
          ))
        )}
      </div>
    </div>
  );
}
