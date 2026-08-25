import Avatar from "./Avatar";
import { fmtDateShort, isOverdue, PRIORITY_LABEL, priorityBadgeClass } from "../lib";
import type { Task } from "../types";

export default function TaskCard({ task, onClick }: { task: Task; onClick: (t: Task) => void }) {
  const overdue = isOverdue(task.dueDate, task.status);
  return (
    <div className="k-card" onClick={() => onClick(task)}>
      <div className="k-title">{task.title}</div>
      <div className="k-tags">
        <span className={priorityBadgeClass(task.priority)}>{PRIORITY_LABEL[task.priority]}</span>
      </div>
      <div className="k-foot">
        <span className={"k-due" + (overdue ? " overdue" : "")}>
          {task.dueDate ? "⏰ " + fmtDateShort(task.dueDate) : ""}
        </span>
        {task.assignee
          ? <Avatar name={task.assignee.name} color={task.assignee.avatarColor} size={22} />
          : <span className="k-due" title="Bez przypisania">·</span>}
      </div>
    </div>
  );
}
