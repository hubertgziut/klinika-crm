import type { TaskPriority, TaskStatus } from "./types";

export const STATUSES: { value: TaskStatus; label: string; emoji: string }[] = [
  { value: "todo", label: "Do zrobienia", emoji: "📋" },
  { value: "in_progress", label: "W trakcie", emoji: "🔄" },
  { value: "review", label: "Do weryfikacji", emoji: "🔍" },
  { value: "done", label: "Zrobione", emoji: "✅" },
];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "Do zrobienia",
  in_progress: "W trakcie",
  review: "Do weryfikacji",
  done: "Zrobione",
};

export const PRIORITIES: { value: TaskPriority; label: string; emoji: string }[] = [
  { value: "low", label: "Niski", emoji: "🟢" },
  { value: "medium", label: "Średni", emoji: "🟡" },
  { value: "high", label: "Wysoki", emoji: "🟠" },
  { value: "urgent", label: "Pilny", emoji: "🔴" },
];

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "Niski",
  medium: "Średni",
  high: "Wysoki",
  urgent: "Pilny",
};

export const PROJECT_EMOJIS = ["📁", "🩺", "🛒", "📦", "💡", "🚀", "📅", "💰", "🧪"];
export const PROJECT_COLORS = ["#ff6b5e", "#ffb03a", "#10b981", "#0ea5e9", "#6366f1", "#ec4899", "#14b8a6", "#8b5cf6", "#f59e0b"];

export function priorityBadgeClass(p: TaskPriority): string {
  if (p === "urgent") return "badge red";
  if (p === "high") return "badge warn";
  if (p === "low") return "badge green";
  return "badge blue";
}

export function statusBadgeClass(s: TaskStatus): string {
  if (s === "done") return "badge green";
  if (s === "in_progress") return "badge blue";
  if (s === "review") return "badge purple";
  return "badge";
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  if (Number.isNaN(d.getTime())) return iso;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86400e3);
  if (diff === 0) return "dziś";
  if (diff === 1) return "jutro";
  if (diff === -1) return "wczoraj";
  return d.toLocaleDateString("pl-PL", { day: "numeric", month: "short" });
}

export function isOverdue(dueDate: string | null, status: TaskStatus): boolean {
  if (!dueDate || status === "done") return false;
  const d = new Date(dueDate.length === 10 ? dueDate + "T00:00:00" : dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d.getTime() < today.getTime();
}

export function monthKey(dateStr: string): string {
  const d = new Date(dateStr.length === 10 ? dateStr + "T00:00:00" : dateStr);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("pl-PL", { month: "long", year: "numeric" });
}

export function clampPosition(pos: number, len: number): number {
  return Math.max(0, Math.min(Math.floor(pos), len));
}

export function fmtMoney(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "0,00\u00A0zł";
  return new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + "\u00A0zł";
}

