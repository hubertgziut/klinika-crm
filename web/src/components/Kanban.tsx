import { useRef, useState } from "react";
import { STATUSES } from "../lib";
import { AI_PRODUCT_MIME, type AiProduct, type Task, type TaskStatus } from "../types";
import TaskCard from "./TaskCard";

interface KanbanProps {
  tasks: Task[];
  onMove: (taskId: string, status: TaskStatus, position: number) => void;
  onOpenTask: (task: Task) => void;
  onAddTask?: (status: TaskStatus) => void;
  /** Szybkie dodawanie — wystarczy wpisać nazwę i wcisnąć Enter. */
  onQuickAdd?: (status: TaskStatus, title: string) => void;
  /** Projekt kontekstu — do tworzenia zadania z karty produktu AI (drop). */
  projectId?: string;
  /** Wywoływane, gdy upuszczono kartę produktu AI na kolumnę. */
  onProductDrop?: (product: AiProduct, status: TaskStatus) => void;
}

interface OverState {
  status: TaskStatus;
  index: number | null;
}

function hasProductData(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes(AI_PRODUCT_MIME);
}
function readProduct(e: React.DragEvent): AiProduct | null {
  try {
    return JSON.parse(e.dataTransfer.getData(AI_PRODUCT_MIME)) as AiProduct;
  } catch {
    return null;
  }
}

export default function Kanban({ tasks, onMove, onOpenTask, onAddTask, onQuickAdd, projectId, onProductDrop }: KanbanProps) {
  const [drag, setDrag] = useState<{ id: string } | null>(null);
  const [over, setOver] = useState<OverState | null>(null);
  const [extOver, setExtOver] = useState<TaskStatus | null>(null);
  const [quickStatus, setQuickStatus] = useState<TaskStatus | null>(null);
  const [quickTitle, setQuickTitle] = useState("");
  const suppressClick = useRef(false);
  const quickRef = useRef<HTMLInputElement | null>(null);

  function submitQuick(status: TaskStatus) {
    const title = quickTitle.trim();
    if (!title) { setQuickStatus(null); return; }
    setQuickTitle("");
    setQuickStatus(null);
    onQuickAdd?.(status, title);
  }
  function toggleQuick(status: TaskStatus) {
    if (quickStatus === status) { setQuickStatus(null); setQuickTitle(""); return; }
    setQuickStatus(status);
    setQuickTitle("");
    setTimeout(() => quickRef.current?.focus(), 0);
  }

  function tasksIn(status: TaskStatus): Task[] {
    return tasks.filter((t) => t.status === status).sort((a, b) => a.position - b.position);
  }

  function handleDragStart(e: React.DragEvent, task: Task) {
    suppressClick.current = true;
    setDrag({ id: task.id });
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", task.id);
  }

  function handleDragEnd() {
    setDrag(null);
    setOver(null);
    setExtOver(null);
    window.setTimeout(() => { suppressClick.current = false; }, 0);
  }

  function handleCardDragOver(e: React.DragEvent, status: TaskStatus, index: number) {
    if (hasProductData(e)) return; // karta produktu — obsłuży kolumna
    if (!drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const idx = e.clientY < rect.top + rect.height / 2 ? index : index + 1;
    setOver({ status, index: idx });
  }

  function handleDrop(e: React.DragEvent, status: TaskStatus, index: number | null) {
    if (hasProductData(e)) return; // produkt AI — obsłuży kolumna
    e.preventDefault();
    const id = drag?.id ?? e.dataTransfer.getData("text/plain");
    if (id) {
      const column = tasksIn(status);
      const target = over?.status === status && over.index !== null ? over.index : (index ?? column.length);
      onMove(id, status, target);
    }
    setDrag(null);
    setOver(null);
  }

  function handleColumnProductDrop(e: React.DragEvent, status: TaskStatus) {
    e.preventDefault();
    const product = readProduct(e);
    setExtOver(null);
    if (product && onProductDrop) onProductDrop(product, status);
  }

  return (
    <div className="kanban">
      {STATUSES.map((s) => {
        const column = tasksIn(s.value);
        const isOver = over?.status === s.value;
        const isExtOver = extOver === s.value;
        return (
          <div
            key={s.value}
            className={"kanban-col" + (isOver ? " over" : "") + (isExtOver ? " drop-active" : "")}
            onDragOver={(e) => {
              if (hasProductData(e)) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
                setExtOver(s.value);
                return;
              }
              if (!drag) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setOver({ status: s.value, index: null });
            }}
            onDragLeave={() => setExtOver((v) => (v === s.value ? null : v))}
            onDrop={(e) => {
              if (hasProductData(e)) {
                handleColumnProductDrop(e, s.value);
                return;
              }
              handleDrop(e, s.value, column.length);
            }}
          >
            <div className="col-head">
              <span>{s.emoji}</span>
              <span>{s.label}</span>
              <span className="cnt">{column.length}</span>
              {onQuickAdd && (
                <button
                  className="btn small ghost col-add"
                  title={"Dodaj zadanie — wpisz nazwę i Enter (" + s.label + ")"}
                  onClick={(e) => { e.stopPropagation(); toggleQuick(s.value); }}
                >{quickStatus === s.value ? "✕" : "＋"}</button>
              )}
            </div>
            {quickStatus === s.value && (
              <div className="quick-add">
                <input
                  ref={quickRef}
                  className="input"
                  value={quickTitle}
                  placeholder="Nazwa zadania…"
                  onChange={(e) => setQuickTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); submitQuick(s.value); }
                    if (e.key === "Escape") { setQuickStatus(null); setQuickTitle(""); }
                  }}
                  onBlur={() => { if (quickTitle.trim()) submitQuick(s.value); else { setQuickStatus(null); setQuickTitle(""); } }}
                />
              </div>
            )}
            {column.map((task, i) => (
              <div
                key={task.id}
                draggable
                onDragStart={(e) => handleDragStart(e, task)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleCardDragOver(e, s.value, i)}
                onDrop={(e) => handleDrop(e, s.value, i)}
                className={drag?.id === task.id ? "k-card-wrap dragging" : "k-card-wrap"}
              >
                <TaskCard task={task} onClick={(t) => { if (!suppressClick.current) onOpenTask(t); }} />
              </div>
            ))}
            {column.length === 0 && (
              <div
                className="kanban-empty"
                onDragOver={(e) => {
                  if (hasProductData(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setExtOver(s.value); return; }
                  if (drag) { e.preventDefault(); setOver({ status: s.value, index: 0 }); }
                }}
                onDrop={(e) => {
                  if (hasProductData(e)) { handleColumnProductDrop(e, s.value); return; }
                  handleDrop(e, s.value, 0);
                }}
              >
                Upuść tutaj
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
