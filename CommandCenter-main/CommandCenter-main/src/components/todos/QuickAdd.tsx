import { useState } from "react";
import { TaskModal } from "./TaskModal";
import type { TaskStatus } from "@/types";
interface Props { projectId?:string; parentId?:string; defaultStatus?:TaskStatus; placeholder?:string; }
export function QuickAdd({ projectId, parentId, defaultStatus="today", placeholder }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="add-row" onClick={() => setOpen(true)}>
        <span style={{color:"rgba(255,255,255,0.3)",fontSize:16}}>+</span>
        {placeholder ?? "Post a new order…"}
      </div>
      <TaskModal open={open} onClose={()=>setOpen(false)} projectId={projectId} parentId={parentId} defaultStatus={defaultStatus}/>
    </>
  );
}
