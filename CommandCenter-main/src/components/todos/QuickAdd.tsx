import { useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tasksApi, tagsApi } from "@/lib/api";
import { TaskModal } from "./TaskModal";
import { parseTask, type NLPResult } from "@/lib/nlp";
import { todayStr } from "@/lib/utils";
import type { TaskStatus } from "@/types";
import toast from "react-hot-toast";
import { CalendarClock, ChevronRight } from "lucide-react";

interface Props {
  projectId?: string;
  parentId?: string;
  defaultStatus?: TaskStatus;
  placeholder?: string;
}

function buildDueFromNlp(p: NLPResult): string | undefined {
  if (p.dueDate && p.dueTime) return `${p.dueDate}T${p.dueTime}:00`;
  if (p.dueDate) return `${p.dueDate}T00:00:00`;
  if (p.dueTime) return `${todayStr()}T${p.dueTime}:00`;
  return undefined;
}

function statusForDueIso(dueIso: string | undefined): TaskStatus {
  if (!dueIso) return "upcoming";
  const day = dueIso.split("T")[0];
  return day === todayStr() ? "today" : "upcoming";
}

export function QuickAdd({
  projectId,
  parentId,
  defaultStatus = "upcoming",
  placeholder,
}: Props) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [duePickerOpen, setDuePickerOpen] = useState(false);
  const [pickerDate, setPickerDate] = useState(todayStr);
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const parsed = parseTask(value);
  const hasNlpSchedule = !!(parsed.dueDate || parsed.dueTime);
  const showPreview = focused && value.trim().length > 0 && hasNlpSchedule;

  const inv = () => {
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["projects"] });
  };

  const createMut = useMutation({
    mutationFn: (dueOverride?: string) => {
      const title = value.trim();
      if (!title) throw new Error("Title required");
      const p = parseTask(title);
      const cleanTitle = p.cleanTitle || title;
      const due_date = dueOverride ?? buildDueFromNlp(p);
      if (!due_date) throw new Error("Due date required");

      const status = statusForDueIso(due_date);

      return tasksApi.create({
        title: cleanTitle,
        status,
        priority: "medium",
        importance: 3,
        difficulty: 3,
        due_date,
        time_estimate_minutes: p.estimateMinutes ?? undefined,
        project_id: projectId,
        parent_id: parentId,
        tag_ids: [],
        show_in_daily: true,
      });
    },
    onSuccess: (task) => {
      inv();
      const p = parseTask(value);
      const label = p.humanLabel ? ` · ${p.humanLabel}` : "";
      toast.success(`"${task.title}" added${label}`);
      setValue("");
      setDuePickerOpen(false);
      inputRef.current?.focus();
    },
    onError: (e: any) =>
      toast.error(`Failed: ${e?.response?.data?.detail ?? e?.message ?? "unknown"}`),
  });

  const tryFastCreate = () => {
    const raw = value.trim();
    if (!raw) return;
    const p = parseTask(raw);
    if (buildDueFromNlp(p)) {
      createMut.mutate(undefined);
      return;
    }
    setPickerDate(todayStr());
    setDuePickerOpen(true);
  };

  const confirmPickerDate = () => {
    const day = pickerDate || todayStr();
    createMut.mutate(`${day}T00:00:00`);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        setModalOpen(true);
      } else if (value.trim()) {
        tryFastCreate();
      }
    }
    if (e.key === "Escape") {
      if (duePickerOpen) setDuePickerOpen(false);
      setValue("");
      inputRef.current?.blur();
    }
  };

  const openModal = (e: React.MouseEvent) => {
    e.stopPropagation();
    setModalOpen(true);
  };

  const { data: allTags = [] } = useQuery({
    queryKey: ["tags"],
    queryFn: tagsApi.list,
    staleTime: 60_000,
  });

  const activeToken = value.match(/(?:^|\s)([#@!])([^\s]*)$/);
  const activePrefix = activeToken?.[1] ?? null;
  const activeQuery = activeToken?.[2] ?? "";
  const suggestions =
    activePrefix === "#"
      ? (allTags as any[])
          .filter((t: any) => t.name.toLowerCase().includes(activeQuery.toLowerCase()))
          .slice(0, 6)
          .map((t: any) => ({ label: `#${t.name}`, value: `#${t.name}` }))
      : activePrefix === "!"
      ? [5, 4, 3, 2, 1]
          .filter((n) => String(n).startsWith(activeQuery))
          .map((n) => ({ label: `!${n} importance`, value: `!${n}` }))
      : activePrefix === "@"
      ? [
          { label: "@easy difficulty", value: "@easy" },
          { label: "@medium difficulty", value: "@medium" },
          { label: "@hard difficulty", value: "@hard" },
          { label: "@veryhard difficulty", value: "@veryhard" },
        ].filter((o) => o.value.includes(activeQuery.toLowerCase()))
      : [];

  const applySuggestion = (tokenValue: string) => {
    setValue((prev) => prev.replace(/(?:^|\s)([#@!])([^\s]*)$/, (m) => {
      const lead = m.startsWith(" ") ? " " : "";
      return `${lead}${tokenValue} `;
    }));
    inputRef.current?.focus();
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
          ENTER to save · picks due date if none in text · SHIFT+ENTER full form · ESC clear
        </div>
      )}

      {focused && activePrefix && suggestions.length > 0 && (
        <div
          style={{
            marginTop: 4,
            border: "1px solid rgba(232,168,32,0.22)",
            background: "#1e3629",
            borderRadius: 3,
            overflow: "hidden",
          }}
        >
          {suggestions.map((s) => (
            <button
              key={s.label}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                applySuggestion(s.value);
              }}
              style={{
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: "none",
                color: "rgba(245,240,224,0.75)",
                padding: "6px 10px",
                fontSize: 11,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                cursor: "pointer",
                fontFamily: "'Oswald', Arial, sans-serif",
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {duePickerOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.75)",
            zIndex: 1200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setDuePickerOpen(false);
          }}
        >
          <div
            style={{
              width: 400,
              maxWidth: "100%",
              background: "#1e3629",
              border: "1px solid rgba(232,168,32,0.45)",
              borderRadius: 6,
              padding: "20px 22px",
              boxShadow: "0 24px 64px rgba(0,0,0,0.55)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 10, letterSpacing: "0.2em", color: "#e8a820", fontFamily: "'Oswald',Arial,sans-serif", marginBottom: 8 }}>
              DUE DATE
            </div>
            <p style={{ fontSize: 13, color: "rgba(245,240,224,0.75)", marginBottom: 14, lineHeight: 1.45 }}>
              No day or time was detected in your text. Pick a due date for this task.
            </p>
            <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(245,240,224,0.5)", marginBottom: 6, letterSpacing: "0.08em" }}>DATE</div>
            <input
              type="date"
              value={pickerDate}
              onChange={(e) => setPickerDate(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (!createMut.isPending) confirmPickerDate();
                }
              }}
              autoFocus
              style={{
                width: "100%",
                padding: "10px 12px",
                marginBottom: 16,
                background: "rgba(0,0,0,0.35)",
                color: "#f5f0e0",
                border: "1px solid rgba(245,240,224,0.2)",
                borderRadius: 4,
                fontSize: 14,
                fontFamily: "'Oswald', Arial, sans-serif",
              }}
            />
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={() => setDuePickerOpen(false)}
                style={{
                  flex: 1,
                  padding: "10px",
                  background: "transparent",
                  border: "1px solid rgba(245,240,224,0.2)",
                  color: "rgba(245,240,224,0.55)",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontFamily: "'Oswald', Arial, sans-serif",
                  fontSize: 11,
                  letterSpacing: "0.12em",
                }}
              >
                CANCEL
              </button>
              <button
                type="button"
                disabled={createMut.isPending}
                onClick={confirmPickerDate}
                style={{
                  flex: 1,
                  padding: "10px",
                  background: "rgba(232,168,32,0.18)",
                  border: "1px solid rgba(232,168,32,0.5)",
                  color: "#e8a820",
                  borderRadius: 4,
                  cursor: createMut.isPending ? "wait" : "pointer",
                  fontFamily: "'Oswald', Arial, sans-serif",
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: "0.12em",
                }}
              >
                ADD TASK
              </button>
            </div>
          </div>
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
