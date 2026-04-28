import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { notesApi } from "@/lib/api";
import { StickyNote, Plus, Pin, Loader2, Trash2, X } from "lucide-react";
import { cn, relativeDate } from "@/lib/utils";
import type { Note } from "@/types";
import toast from "react-hot-toast";

function NoteCard({ note, onDelete }: { note: Note; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(note.content);
  const qc = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: () => notesApi.update(note.id, { content }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["notes"] }); setEditing(false); },
  });

  const pinMutation = useMutation({
    mutationFn: () => notesApi.update(note.id, { is_pinned: !note.is_pinned }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notes"] }),
  });

  const source = note.task_id ? "task" : note.project_id ? "project" : note.habit_id ? "habit" : "standalone";

  return (
    <div className={cn(
      "rounded-2xl border p-4 transition-all group",
      note.is_pinned
        ? "border-amber-500/30 bg-amber-500/5"
        : "border-[#2a2a45] bg-[#12121f] hover:border-[#3d3d6b]"
    )}>
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div>
          {note.title && <h3 className="text-sm font-bold text-white mb-0.5">{note.title}</h3>}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-600">{relativeDate(note.updated_at)}</span>
            {source !== "standalone" && (
              <span className="text-xs text-indigo-500 font-medium">from {source}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => pinMutation.mutate()} className="p-1.5 hover:bg-[#2a2a45] rounded-lg text-slate-500 hover:text-amber-400 transition-colors">
            <Pin className={cn("w-3.5 h-3.5", note.is_pinned && "fill-current text-amber-400")} />
          </button>
          <button onClick={onDelete} className="p-1.5 hover:bg-[#2a2a45] rounded-lg text-slate-500 hover:text-rose-400 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      {editing ? (
        <div className="space-y-2">
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            rows={4}
            autoFocus
            className="w-full bg-[#0d0d1f] border border-indigo-500/30 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none resize-none"
          />
          <div className="flex gap-2">
            <button onClick={() => updateMutation.mutate()} className="px-3 py-1 rounded-lg bg-indigo-500 text-white text-xs font-semibold hover:bg-indigo-600">Save</button>
            <button onClick={() => { setEditing(false); setContent(note.content); }} className="px-3 py-1 rounded-lg border border-[#2a2a45] text-slate-400 text-xs hover:text-white">Cancel</button>
          </div>
        </div>
      ) : (
        <p
          onClick={() => setEditing(true)}
          className="text-sm text-slate-300 whitespace-pre-wrap cursor-pointer hover:text-white transition-colors leading-relaxed"
        >
          {note.content}
        </p>
      )}
    </div>
  );
}

function NewNoteForm({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const qc = useQueryClient();

  const createMutation = useMutation({
    mutationFn: () => notesApi.create({ title: title || undefined, content, tag_ids: [], is_pinned: false }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notes"] });
      toast.success("Note saved!");
      onClose();
    },
  });

  return (
    <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-yellow-300">New Note</h3>
        <button onClick={onClose}><X className="w-4 h-4 text-slate-500" /></button>
      </div>
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Title (optional)"
        className="w-full bg-[#0d0d1f] border border-[#2a2a45] rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none focus:border-yellow-500/40"
      />
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder="Note content…"
        rows={4}
        autoFocus
        className="w-full bg-[#0d0d1f] border border-[#2a2a45] rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none resize-none focus:border-yellow-500/40"
      />
      <button
        onClick={() => content.trim() && createMutation.mutate()}
        disabled={!content.trim() || createMutation.isPending}
        className="w-full py-2 rounded-xl bg-yellow-500 text-black font-semibold text-sm hover:bg-yellow-400 disabled:opacity-50 transition-colors"
      >
        Save Note
      </button>
    </div>
  );
}

export function NotesPage() {
  const [showNew, setShowNew] = useState(false);
  const [search, setSearch] = useState("");
  const qc = useQueryClient();

  const { data: notes, isLoading } = useQuery({
    queryKey: ["notes", search],
    queryFn: () => notesApi.list(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => notesApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notes"] }),
  });

  const filtered = notes?.filter(n =>
    !search || n.content.toLowerCase().includes(search.toLowerCase()) || n.title?.toLowerCase().includes(search.toLowerCase())
  );

  const pinned = filtered?.filter(n => n.is_pinned) ?? [];
  const unpinned = filtered?.filter(n => !n.is_pinned) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black text-white flex items-center gap-2">
          <StickyNote className="w-6 h-6 text-yellow-400" />
          Notes Hub
        </h1>
        <button
          onClick={() => setShowNew(!showNew)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-yellow-500/20 border border-yellow-500/30 text-yellow-300 hover:bg-yellow-500/30 text-sm font-medium transition-all"
        >
          <Plus className="w-4 h-4" /> New Note
        </button>
      </div>

      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search notes…"
        className="w-full bg-[#12121f] border border-[#2a2a45] rounded-xl px-4 py-2 text-sm text-slate-300 placeholder:text-slate-600 outline-none focus:border-yellow-500/30"
      />

      {showNew && <NewNoteForm onClose={() => setShowNew(false)} />}

      {isLoading
        ? <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-yellow-400" /></div>
        : (
          <div className="space-y-5">
            {pinned.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Pin className="w-3 h-3" /> Pinned
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {pinned.map(n => <NoteCard key={n.id} note={n} onDelete={() => deleteMutation.mutate(n.id)} />)}
                </div>
              </div>
            )}
            {unpinned.length > 0 && (
              <div>
                {pinned.length > 0 && <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">All Notes</h2>}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {unpinned.map(n => <NoteCard key={n.id} note={n} onDelete={() => deleteMutation.mutate(n.id)} />)}
                </div>
              </div>
            )}
            {filtered?.length === 0 && (
              <div className="text-center py-12 text-slate-600">
                <StickyNote className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p>{search ? "No notes match your search." : "No notes yet. Create one above!"}</p>
              </div>
            )}
          </div>
        )}
    </div>
  );
}
