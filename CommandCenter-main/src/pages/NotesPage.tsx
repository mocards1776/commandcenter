import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { notesApi } from "@/lib/api";
import { Plus, Pin, Loader2, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Note } from "@/types";
import toast from "react-hot-toast";

function NoteEntry({ note, onDelete }: { note: Note; onDelete: () => void }) {
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

  const formatDate = (date: string) => {
    const d = new Date(date);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
           " at " + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="notebook-entry">
      <div className="notebook-margin" />

      <div className="notebook-content">
        <div className="entry-header">
          <div className="entry-meta">
            <span className="entry-date">{formatDate(note.updated_at)}</span>
          </div>
          <div className="entry-actions">
            <button
              onClick={() => pinMutation.mutate()}
              className={cn("icon-btn", note.is_pinned && "is-pinned")}
              title={note.is_pinned ? "Unpin" : "Pin"}
            >
              <Pin className="w-4 h-4" />
            </button>
            <button
              onClick={onDelete}
              className="icon-btn delete-btn"
              title="Delete"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {note.title && (
          <h2 className="entry-headline">{note.title}</h2>
        )}

        {editing ? (
          <div className="edit-form">
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              rows={8}
              autoFocus
              className="edit-textarea"
            />
            <div className="edit-buttons">
              <button
                onClick={() => updateMutation.mutate()}
                className="btn-save"
              >
                Save
              </button>
              <button
                onClick={() => { setEditing(false); setContent(note.content); }}
                className="btn-cancel"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p
            onClick={() => setEditing(true)}
            className="entry-text"
          >
            {note.content || "(empty)"}
          </p>
        )}
      </div>
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
    <div className="new-note-form">
      <div className="form-header">
        <h3>New Note</h3>
        <button onClick={onClose} className="close-btn">
          <X className="w-4 h-4" />
        </button>
      </div>
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Title (optional)"
        className="form-input"
      />
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder="Note content…"
        rows={6}
        autoFocus
        className="form-textarea"
      />
      <button
        onClick={() => content.trim() && createMutation.mutate()}
        disabled={!content.trim() || createMutation.isPending}
        className="btn-submit"
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
  const headerDateTime = new Date().toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

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
    <div className="notes-page notes-page--notebook">
      <div className="notes-frame">
        <aside className="notes-rail" aria-hidden="true">
          <div className="rail-dot" />
          <div className="rail-pill">
            <span>↑</span>
          </div>
          <div className="rail-pill rail-pill--active">
            <span>→</span>
          </div>
          <div className="rail-pill">
            <span>↓</span>
          </div>
          <div className="rail-spacer" />
          <div className="rail-dot rail-dot--bottom" />
        </aside>

        <div className="notes-paper">
          <div className="notes-paper-head">
            <span className="paper-brand">Notes Hub</span>
            <span className="paper-menu">{headerDateTime}</span>
          </div>

          <div className="notes-header">
            <button
              onClick={() => setShowNew(!showNew)}
              className="btn-new-note"
            >
              <Plus className="w-4 h-4" /> New Note
            </button>
          </div>

          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search notes…"
            className="search-input"
          />

          {showNew && <NewNoteForm onClose={() => setShowNew(false)} />}

          <div className="notes-container">
            {isLoading ? (
              <div className="loading">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : (
              <>
                {pinned.length > 0 && (
                  <div className="notes-section">
                    <h2 className="section-label">📌 Pinned</h2>
                    <div className="notes-list">
                      {pinned.map(n => (
                        <NoteEntry
                          key={n.id}
                          note={n}
                          onDelete={() => deleteMutation.mutate(n.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {unpinned.length > 0 && (
                  <div className="notes-section">
                    {pinned.length > 0 && <h2 className="section-label">📝 All Notes</h2>}
                    <div className="notes-list">
                      {unpinned.map(n => (
                        <NoteEntry
                          key={n.id}
                          note={n}
                          onDelete={() => deleteMutation.mutate(n.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {filtered?.length === 0 && (
                  <div className="empty-state">
                    <p>{search ? "No notes match your search." : "No notes yet. Create one above!"}</p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
