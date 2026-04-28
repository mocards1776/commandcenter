import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { braindumpApi } from "@/lib/api";
import { Brain, Sparkles, Loader2, ChevronDown, ChevronRight, CheckSquare, FolderKanban } from "lucide-react";
import { cn, relativeDate } from "@/lib/utils";
import type { BraindumpEntry } from "@/types";
import toast from "react-hot-toast";

function BraindumpResult({ entry }: { entry: BraindumpEntry }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const processMutation = useMutation({
    mutationFn: () => braindumpApi.process(entry.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["braindump"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Tasks extracted! ✓", { duration: 4000 });
    },
    onError: () => toast.error("AI failed — check XAI_API_KEY"),
  });

  return (
    <div className={cn(
      "rounded-2xl border p-4 transition-all",
      entry.processed ? "border-emerald-500/20 bg-emerald-500/5" : "border-[#2a2a45] bg-[#12121f]"
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {entry.processed
              ? <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">Processed</span>
              : <span className="text-xs font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">Pending</span>}
            <span className="text-xs text-slate-600">{relativeDate(entry.created_at)}</span>
          </div>
          <p className="text-sm text-slate-300 line-clamp-2">{entry.raw_text}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          {!entry.processed && (
            <button onClick={() => processMutation.mutate()} disabled={processMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-fuchsia-500/20 border border-fuchsia-500/30 text-fuchsia-300 hover:bg-fuchsia-500/30 text-xs font-semibold transition-all disabled:opacity-50">
              {processMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              {processMutation.isPending ? "Processing…" : "Process"}
            </button>
          )}
          <button onClick={() => setOpen(!open)} className="p-1.5 text-slate-500 hover:text-slate-300">
            {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-3 pt-3 border-t border-[#2a2a45]">
          <p className="text-sm text-slate-400 whitespace-pre-wrap leading-relaxed">{entry.raw_text}</p>
        </div>
      )}
      {entry.processed && entry.ai_result && (
        <div className="mt-3 pt-3 border-t border-emerald-500/10 space-y-1">
          {entry.ai_result.summary && <p className="text-xs text-emerald-300 italic">"{entry.ai_result.summary}"</p>}
          <div className="flex gap-3 text-xs">
            {entry.created_project_ids.length > 0 && (
              <span className="flex items-center gap-1 text-violet-400">
                <FolderKanban className="w-3 h-3" /> {entry.created_project_ids.length} project(s)
              </span>
            )}
            {entry.created_task_ids.length > 0 && (
              <span className="flex items-center gap-1 text-sky-400">
                <CheckSquare className="w-3 h-3" /> {entry.created_task_ids.length} task(s)
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function BraindumpPage() {
  const [text, setText] = useState("");
  const qc = useQueryClient();

  const { data: entries, isLoading } = useQuery({ queryKey: ["braindump"], queryFn: braindumpApi.list });

  const createMutation = useMutation({
    mutationFn: () => braindumpApi.create(text.trim()),
    onSuccess: (entry) => {
      qc.invalidateQueries({ queryKey: ["braindump"] });
      setText("");
      toast.success("Dumped! Extracting tasks with AI…");
      braindumpApi.process(entry.id).then(() => {
        qc.invalidateQueries({ queryKey: ["braindump"] });
        qc.invalidateQueries({ queryKey: ["tasks"] });
        qc.invalidateQueries({ queryKey: ["projects"] });
        toast.success("Tasks extracted! Check your inbox ✓", { duration: 5000 });
      }).catch(() => toast.error("AI processing failed — check XAI_API_KEY"));
    },
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-black text-white flex items-center gap-2">
          <Brain className="w-6 h-6 text-fuchsia-400" /> AI Braindump
        </h1>
        <p className="text-sm text-slate-500 mt-1">Dump everything rattling in your head. Grok AI structures it into tasks and projects.</p>
      </div>
      <div className="rounded-2xl border border-fuchsia-500/20 bg-[#12121f] p-4 space-y-3">
        <div className="flex items-center gap-2 text-fuchsia-300">
          <Brain className="w-4 h-4" />
          <span className="text-sm font-semibold">What's on your mind?</span>
        </div>
        <textarea value={text} onChange={e => setText(e.target.value)}
          placeholder={"Just type freely — ramble, brainstorm, vent.\n\n\"I need to finish the website, call dentist, research ETFs, fix the auth bug before Friday, and plan the team offsite…\"\n\nGrok will turn this into structured tasks automatically."}
          rows={8}
          className="w-full bg-[#0a0a14] border border-[#2a2a45] rounded-xl px-4 py-3 text-sm text-slate-200 placeholder:text-slate-700 outline-none focus:border-fuchsia-500/40 resize-none leading-relaxed" />
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-600">{text.length} chars</span>
          <button onClick={() => text.trim() && createMutation.mutate()} disabled={!text.trim() || createMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-fuchsia-500/20 border border-fuchsia-500/30 text-fuchsia-300 hover:bg-fuchsia-500/30 font-semibold text-sm transition-all disabled:opacity-40">
            {createMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</> : <><Sparkles className="w-4 h-4" /> Dump + Extract</>}
          </button>
        </div>
      </div>
      <div>
        <h2 className="text-base font-bold text-white mb-3">History</h2>
        {isLoading ? <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-fuchsia-400" /></div> : (
          <div className="space-y-3">
            {entries?.map(e => <BraindumpResult key={e.id} entry={e} />)}
            {entries?.length === 0 && (
              <div className="text-center py-10 text-slate-600">
                <Brain className="w-10 h-10 mx-auto mb-2 opacity-20" />
                <p className="text-sm">No braindumps yet. Type something above!</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
