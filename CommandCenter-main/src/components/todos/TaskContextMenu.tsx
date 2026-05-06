import * as ContextMenu from "@radix-ui/react-context-menu";
import { Edit2, Trash2, Pin, PinOff, CalendarDays, Star, FolderOpen, Tags, Shapes } from "lucide-react";
import type { Task } from "@/types";

interface TaskContextMenuProps {
  children: React.ReactNode;
  task: Task;
  projects?: Array<{ id: string; title: string }>;
  categories?: Array<{ id: string; name: string }>;
  tags?: Array<{ id: string; name: string }>;
  isPinned?: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onPin?: () => void;
  onUnpin?: () => void;
  onSetDueDate?: (v?: string) => void;
  onSetImportance?: (v: number) => void;
  onSetDifficulty?: (v: number) => void;
  onSetProject?: (projectId?: string) => void;
  onSetCategory?: (categoryId?: string) => void;
  onToggleTag?: (tagId: string) => void;
}

export function TaskContextMenu({
  children,
  task,
  projects = [],
  categories = [],
  tags = [],
  isPinned = false,
  onEdit,
  onDelete,
  onPin,
  onUnpin,
  onSetDueDate,
  onSetImportance,
  onSetDifficulty,
  onSetProject,
  onSetCategory,
  onToggleTag,
}: TaskContextMenuProps) {
  const dueBase = new Date();
  const tomorrow = new Date(dueBase);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const nextWeek = new Date(dueBase);
  nextWeek.setDate(nextWeek.getDate() + 7);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

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

          <ContextMenu.Item className="task-ctx-item" onSelect={onEdit}>
            <Edit2 size={11} className="task-ctx-icon" />
            Edit Task
          </ContextMenu.Item>

          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className="task-ctx-item">
              <CalendarDays size={11} className="task-ctx-icon" />
              Change Date
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className="task-ctx-menu">
                <ContextMenu.Item className="task-ctx-item" onSelect={() => onSetDueDate?.(iso(new Date()))}>Today</ContextMenu.Item>
                <ContextMenu.Item className="task-ctx-item" onSelect={() => onSetDueDate?.(iso(tomorrow))}>Tomorrow</ContextMenu.Item>
                <ContextMenu.Item className="task-ctx-item" onSelect={() => onSetDueDate?.(iso(nextWeek))}>+7 Days</ContextMenu.Item>
                <ContextMenu.Item className="task-ctx-item" onSelect={() => onSetDueDate?.(undefined)}>No Due Date</ContextMenu.Item>
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className="task-ctx-item">
              <Star size={11} className="task-ctx-icon" />
              Importance
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className="task-ctx-menu">
                {[5, 4, 3, 2, 1].map(n => (
                  <ContextMenu.Item key={`imp-${n}`} className="task-ctx-item" onSelect={() => onSetImportance?.(n)}>
                    {"★".repeat(n)} ({n})
                  </ContextMenu.Item>
                ))}
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className="task-ctx-item">
              <Star size={11} className="task-ctx-icon" />
              Difficulty
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className="task-ctx-menu">
                {[5, 4, 3, 2, 1].map(n => (
                  <ContextMenu.Item key={`diff-${n}`} className="task-ctx-item" onSelect={() => onSetDifficulty?.(n)}>
                    {"★".repeat(n)} ({n})
                  </ContextMenu.Item>
                ))}
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className="task-ctx-item">
              <FolderOpen size={11} className="task-ctx-icon" />
              Project
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className="task-ctx-menu">
                <ContextMenu.Item className="task-ctx-item" onSelect={() => onSetProject?.(undefined)}>
                  No Project
                </ContextMenu.Item>
                {projects.map((p) => (
                  <ContextMenu.Item key={p.id} className="task-ctx-item" onSelect={() => onSetProject?.(p.id)}>
                    {p.title}
                  </ContextMenu.Item>
                ))}
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className="task-ctx-item">
              <Shapes size={11} className="task-ctx-icon" />
              Category
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className="task-ctx-menu">
                <ContextMenu.Item className="task-ctx-item" onSelect={() => onSetCategory?.(undefined)}>
                  No Category
                </ContextMenu.Item>
                {categories.map((c) => (
                  <ContextMenu.Item key={c.id} className="task-ctx-item" onSelect={() => onSetCategory?.(c.id)}>
                    {c.name}
                  </ContextMenu.Item>
                ))}
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className="task-ctx-item">
              <Tags size={11} className="task-ctx-icon" />
              Tags
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className="task-ctx-menu">
                {tags.map((t) => (
                  <ContextMenu.CheckboxItem
                    key={t.id}
                    className="task-ctx-item"
                    checked={(task.tag_ids ?? []).includes(t.id)}
                    onCheckedChange={() => onToggleTag?.(t.id)}
                  >
                    {t.name}
                  </ContextMenu.CheckboxItem>
                ))}
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

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
