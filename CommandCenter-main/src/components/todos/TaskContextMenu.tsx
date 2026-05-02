import * as ContextMenu from "@radix-ui/react-context-menu";
import { Edit2, CheckCircle, Play, Square, Trash2, Pin, PinOff } from "lucide-react";
import type { Task } from "@/types";

interface TaskContextMenuProps {
  children: React.ReactNode;
  task: Task;
  isTimerRunning: boolean;
  isPinned?: boolean;
  onEdit: () => void;
  onComplete: () => void;
  onToggleTimer: () => void;
  onDelete: () => void;
  onPin?: () => void;
  onUnpin?: () => void;
}

export function TaskContextMenu({
  children,
  task,
  isTimerRunning,
  isPinned = false,
  onEdit,
  onComplete,
  onToggleTimer,
  onDelete,
  onPin,
  onUnpin,
}: TaskContextMenuProps) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className="task-ctx-menu"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <ContextMenu.Label className="task-ctx-label">
            {task.title}
          </ContextMenu.Label>
          <ContextMenu.Separator className="task-ctx-sep" />

          {/* Edit */}
          <ContextMenu.Item className="task-ctx-item" onSelect={onEdit}>
            <Edit2 size={11} className="task-ctx-icon" />
            Edit Task
          </ContextMenu.Item>

          {/* Complete */}
          {task.status !== "done" && (
            <ContextMenu.Item className="task-ctx-item" onSelect={onComplete}>
              <CheckCircle size={11} className="task-ctx-icon task-ctx-icon--gold" />
              Mark Complete
            </ContextMenu.Item>
          )}

          {/* Timer */}
          {task.status !== "done" && (
            <ContextMenu.Item className="task-ctx-item" onSelect={onToggleTimer}>
              {isTimerRunning ? (
                <Square size={11} className="task-ctx-icon task-ctx-icon--red" />
              ) : (
                <Play size={11} className="task-ctx-icon task-ctx-icon--gold" />
              )}
              {isTimerRunning ? "Stop Timer" : "Start Timer"}
            </ContextMenu.Item>
          )}

          {/* Pin / Unpin — only for active tasks */}
          {task.status !== "done" && (
            <>
              <ContextMenu.Separator className="task-ctx-sep" />
              {isPinned ? (
                <ContextMenu.Item className="task-ctx-item" onSelect={onUnpin}>
                  <PinOff size={11} className="task-ctx-icon" />
                  Unpin from Top
                </ContextMenu.Item>
              ) : (
                <ContextMenu.Item className="task-ctx-item" onSelect={onPin}>
                  <Pin size={11} className="task-ctx-icon task-ctx-icon--gold" />
                  Pin to Top
                </ContextMenu.Item>
              )}
            </>
          )}

          <ContextMenu.Separator className="task-ctx-sep" />

          {/* Delete */}
          <ContextMenu.Item className="task-ctx-item task-ctx-item--danger" onSelect={onDelete}>
            <Trash2 size={11} className="task-ctx-icon" />
            Delete Task
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
