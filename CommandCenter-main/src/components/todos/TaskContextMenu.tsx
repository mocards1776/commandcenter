import * as ContextMenu from "@radix-ui/react-context-menu";
import { Edit2, CheckCircle, Play, Square, Trash2 } from "lucide-react";
import type { Task } from "@/types";

interface TaskContextMenuProps {
  children: React.ReactNode;
  task: Task;
  isTimerRunning: boolean;
  onEdit: () => void;
  onComplete: () => void;
  onToggleTimer: () => void;
  onDelete: () => void;
}

export function TaskContextMenu({
  children,
  task,
  isTimerRunning,
  onEdit,
  onComplete,
  onToggleTimer,
  onDelete,
}: TaskContextMenuProps) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenu.Content
          className="task-ctx-menu"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {/* Task name label */}
          <ContextMenu.Label className="task-ctx-label">
            {task.title}
          </ContextMenu.Label>

          <ContextMenu.Separator className="task-ctx-sep" />

          {/* Edit */}
          <ContextMenu.Item
            className="task-ctx-item"
            onSelect={onEdit}
          >
            <Edit2 size={11} className="task-ctx-icon" />
            Edit Task
          </ContextMenu.Item>

          {/* Complete — hidden if already done */}
          {task.status !== "done" && (
            <ContextMenu.Item
              className="task-ctx-item"
              onSelect={onComplete}
            >
              <CheckCircle size={11} className="task-ctx-icon task-ctx-icon--gold" />
              Mark Complete
            </ContextMenu.Item>
          )}

          {/* Timer — hidden if already done */}
          {task.status !== "done" && (
            <ContextMenu.Item
              className="task-ctx-item"
              onSelect={onToggleTimer}
            >
              {isTimerRunning ? (
                <Square size={11} className="task-ctx-icon task-ctx-icon--red" />
              ) : (
                <Play size={11} className="task-ctx-icon task-ctx-icon--gold" />
              )}
              {isTimerRunning ? "Stop Timer" : "Start Timer"}
            </ContextMenu.Item>
          )}

          <ContextMenu.Separator className="task-ctx-sep" />

          {/* Delete */}
          <ContextMenu.Item
            className="task-ctx-item task-ctx-item--danger"
            onSelect={onDelete}
          >
            <Trash2 size={11} className="task-ctx-icon" />
            Delete Task
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
