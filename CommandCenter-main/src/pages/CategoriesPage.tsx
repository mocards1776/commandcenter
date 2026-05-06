import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { categoriesApi } from "@/lib/api";
import type { Category } from "@/types";
import { Loader2, Plus, Trash2 } from "lucide-react";
import toast from "react-hot-toast";

const SWATCHES = ["#e8a820","#d94040","#4a8a5a","#4a7fa8","#9b59b6","#e67e22","#1abc9c","#e91e63","#607d8b","#f5f0e0"];

export function CategoriesPage() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [color, setColor] = useState(SWATCHES[0]);
  const [icon, setIcon] = useState("");

  const { data: categories = [], isLoading } = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: categoriesApi.list,
  });

  const createMut = useMutation({
    mutationFn: () => categoriesApi.create({ name: name.trim(), color, icon: icon.trim() || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      setName("");
      setIcon("");
      toast.success("Category added");
    },
    onError: () => toast.error("Failed to add category"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => categoriesApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Category removed");
    },
    onError: () => toast.error("Failed to delete category"),
  });

  return (
    <div>
      <div className="top-bar">
        <div className="top-title">Categories</div>
      </div>
      <div className="stripe" />

      <div style={{ padding: 16 }}>
        <div style={{ background: "#1e3629", border: "1px solid rgba(232,168,32,0.25)", padding: 12, marginBottom: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 100px auto", gap: 8 }}>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Category name" style={{ padding: "8px 10px", fontSize: 12 }} />
            <input value={icon} onChange={e => setIcon(e.target.value)} placeholder="Icon (optional)" style={{ padding: "8px 10px", fontSize: 12 }} />
            <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
              {SWATCHES.slice(0, 6).map(c => (
                <button key={c} onClick={() => setColor(c)} style={{ width: 16, height: 16, borderRadius: "50%", border: color === c ? "2px solid #fff" : "2px solid transparent", background: c, cursor: "pointer" }} />
              ))}
            </div>
            <button disabled={!name.trim() || createMut.isPending} onClick={() => createMut.mutate()} style={{ background: "#e8a820", border: "none", padding: "8px 10px", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              {createMut.isPending ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Plus size={14} />}
              Add
            </button>
          </div>
        </div>

        {isLoading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
            <Loader2 size={24} style={{ color: "#e8a820", animation: "spin 1s linear infinite" }} />
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {categories.map((c) => (
              <div key={c.id} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "center", gap: 8, background: "#1e3629", border: "1px solid rgba(255,255,255,0.08)", padding: "8px 10px" }}>
                <div style={{ width: 12, height: 12, borderRadius: "50%", background: c.color }} />
                <div style={{ fontFamily: "'Oswald',Arial,sans-serif", letterSpacing: "0.08em", textTransform: "uppercase", fontSize: 12 }}>
                  {c.icon ? `${c.icon} ` : ""}{c.name}
                </div>
                <button onClick={() => deleteMut.mutate(c.id)} style={{ background: "none", border: "none", color: "rgba(217,64,64,0.75)", cursor: "pointer" }}>
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
