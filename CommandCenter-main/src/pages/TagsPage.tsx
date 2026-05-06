import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { tagsApi } from "@/lib/api";
import { Loader2, Plus, Trash2 } from "lucide-react";
import type { Tag } from "@/types";
import toast from "react-hot-toast";

export function TagsPage() {
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#e8a820");

  const { data: tags = [], isLoading } = useQuery<Tag[]>({
    queryKey: ["tags"],
    queryFn: tagsApi.list,
  });

  const createMut = useMutation({
    mutationFn: () => tagsApi.create({ name: newName.trim(), color: newColor }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tags"] });
      setNewName("");
      toast.success("Tag added");
    },
    onError: () => toast.error("Failed to add tag"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => tagsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tags"] });
      toast.success("Tag removed");
    },
    onError: () => toast.error("Failed to remove tag"),
  });

  return (
    <div>
      <div className="top-bar">
        <div className="top-title">Tags</div>
      </div>
      <div className="stripe" />

      <div style={{ padding: 16 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="New tag name"
            style={{ flex: 1, padding: "8px 10px", fontSize: 13 }}
          />
          <input
            type="color"
            value={newColor}
            onChange={e => setNewColor(e.target.value)}
            style={{ width: 38, height: 34, padding: 0, border: "none", background: "transparent" }}
          />
          <button
            onClick={() => newName.trim() && createMut.mutate()}
            style={{ background: "#e8a820", border: "none", padding: "0 12px", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
          >
            <Plus size={14} /> Add
          </button>
        </div>

        {isLoading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
            <Loader2 size={22} style={{ color: "#e8a820", animation: "spin 1s linear infinite" }} />
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {tags.map(t => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#1e3629", border: "1px solid rgba(255,255,255,0.09)" }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: t.color, flexShrink: 0 }} />
                <span style={{ flex: 1, fontFamily: "'Oswald',Arial,sans-serif", fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "#f5f0e0" }}>{t.name}</span>
                <button
                  onClick={() => {
                    if (window.confirm(`Delete tag "${t.name}"?`)) deleteMut.mutate(t.id);
                  }}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(217,64,64,0.65)" }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

