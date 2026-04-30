import { useState, useRef, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { tasksApi } from "@/lib/api";
import { TaskModal } from "./TaskModal";
import { parseTask } from "@/lib/nlp";
import type { TaskStatus } from "@/types";
import toast from "react-hot-toast";
import { CalendarClock, ChevronRight } from "lucide-react";

interface Props {
  projectId?: string;
  parentId?: string;
  defaultStatus?: TaskStatus;
  placeholder?: string;
}

export function QuickAdd({
  projectId,
  parentId,
  defaultStatus = "today",
  placeholder,
}: Props) {
  const [value, setValue]     = useState("");
  const [focused, setFocused] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const parsed = parseTask(value);
  const hasDate = !!(parsed.dueDate || parsed.dueTime);
  const showPreview = focused && value.trim().length > 0 && hasDate;

  const inv = () => {
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["projects"] });
  };

  const createMut = useMutation({
    mutationFn: () => {
      const title = parsed.cleanTitle || value.trim();
      if (!title) throw new Error("Title required");

      // Build due_date ISO string
      let due_date: string | undefined;
      if (parsed.dueDate && parsed.dueTime) {
        due_date = `${parsed.dueDate}T${parsed.dueTime}:00`;
      } else if (parsed.dueDate) {
        due_date = parsed.dueDate;
      }

      return tasksApi.create({
        title,
        status: defaultStatus,
        priority: "medium",
        importance: 3,
        difficulty: 3,
        due_date,
        time_estimate_minutes: parsed.estimateMinutes ?? undefined,
        project_id: projectId,
        parent_id: parentId,
        tag_ids: [],
        show_in_daily: true,
      });
    },
    onSuccess: (task) => {
      inv();
      const label = parsed.humanLabel ? ` · ${parsed.humanLabel}` : "";
      toast.success(`"${task.title}" added${label}`);
      setValue("");
      inputRef.current?.focus();
    },
    onError: (e: any) =>
      toast.error(`Failed: ${e?.response?.data?.detail ?? e?.message ?? "unknown"}`),
  });

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        // Shift+Enter → open full modal pre-filled
        setModalOpen(true);
      } else if (value.trim()) {
        // Enter → fast-create
        createMut.mutate();
      }
    }
    if (e.key === "Escape") {
      setValue("");
      inputRef.current?.blur();
    }
  };

  const openModal = (e: React.MouseEvent) => {
    e.stopPropagation();
    setModalOpen(true);
  };

  return (
    <>
      <div
        className="add-row"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          cursor: "text",
          position: "relative",
          border: focused
            ? "1px solid rgba(232,168,32,0.35)"
            : "1px solid transparent",
          transition: "border-color 0.15s",
        }}
        onClick={() => inputRef.current?.focus()}
      >
        <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 16, flexShrink: 0 }}>+</span>

        <input
          ref={inputRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? "Post a new order…  (Shift+Enter for full form)"}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "#f5f0e0",
            fontSize: 13,
            fontFamily: "'Oswald', Arial, sans-serif",
            letterSpacing: "0.04em",
            caretColor: "#e8a820",
          }}
        />

        {/* Parsed date preview chip */}
        {showPreview && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "3px 8px",
              background: "rgba(232,168,32,0.12)",
              border: "1px solid rgba(232,168,32,0.3)",
              borderRadius: 3,
              flexShrink: 0,
              animation: "fadein 0.15s ease",
            }}
          >
            <CalendarClock size={11} color="#e8a820" />
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.08em",
                color: "#e8a820",
                fontFamily: "'Oswald', Arial, sans-serif",
                whiteSpace: "nowrap",
              }}
            >
              {parsed.humanLabel}
            </span>
          </div>
        )}

        {/* Open full modal button — shows when focused and has text */}
        {focused && value.trim() && (
          <button
            onMouseDown={openModal}
            title="Open full form (Shift+Enter)"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "rgba(232,168,32,0.4)",
              display: "flex",
              alignItems: "center",
              flexShrink: 0,
              padding: "2px 4px",
              borderRadius: 3,
              transition: "color 0.12s",
            }}
            onMouseEnter={e => (e.currentTarget.style.color = "#e8a820")}
            onMouseLeave={e => (e.currentTarget.style.color = "rgba(232,168,32,0.4)")}
          >
            <ChevronRight size={14} />
          </button>
        )}
      </div>

      {/* Hint row when focused */}
      {focused && value.trim() && (
        <div
          style={{
            padding: "3px 12px 4px",
            fontSize: 9,
            letterSpacing: "0.1em",
            color: "rgba(245,240,224,0.22)",
            fontFamily: "'Oswald', Arial, sans-serif",
          }}
        >
          ENTER to save fast · SHIFT+ENTER for full form · ESC to clear
        </div>
      )}

      <TaskModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        projectId={projectId}
        parentId={parentId}
        defaultStatus={defaultStatus}
        initialTitle={parsed.cleanTitle || value.trim()}
        initialDueDate={parsed.dueDate ?? undefined}
        initialDueTime={parsed.dueTime ?? undefined}
      />
    </>
  );
}
