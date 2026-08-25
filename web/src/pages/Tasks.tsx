import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type User } from "../api";
import Kanban from "../components/Kanban";
import Toasts from "../components/Toasts";
import { TaskDetailModal, TaskFormModal } from "../components/TaskModal";
import { clampPosition, fmtMoney } from "../lib";
import { pushToast } from "../toast";
import type { AiProduct, Branch, Project, Task, TaskStatus } from "../types";

export default function Tasks() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [branchesByProject, setBranchesByProject] = useState<Record<string, Branch[]>>({});
  const [projectFilter, setProjectFilter] = useState("");
  const [personFilter, setPersonFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [openTask, setOpenTask] = useState<Task | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const projs = await api.get<Project[]>("/api/projects");
      setProjects(projs);
      const lists = await Promise.all(projs.map((p) => api.get<Task[]>("/api/projects/" + p.id + "/tasks")));
      setTasks(lists.flat());
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się pobrać zadań");
    }
  }, []);

  const loadBranches = useCallback(async (projectId: string) => {
    try {
      const d = await api.get<{ branches: Branch[] }>("/api/projects/" + projectId + "/branches");
      setBranchesByProject((prev) => ({ ...prev, [projectId]: d.branches }));
    } catch {
      /* ignoruj */
    }
  }, []);

  useEffect(() => {
    loadAll();
    api.get<User[]>("/api/users").then(setUsers).catch(() => {});
  }, [loadAll]);

  // załaduj gałęzie pierwszego projektu (do formularza)
  const formProjectId = useMemo(() => {
    const base = projectFilter && projects.some((p) => p.id === projectFilter) ? projectFilter : projects[0]?.id ?? "";
    return base;
  }, [projectFilter, projects]);

  useEffect(() => {
    if (formProjectId && !branchesByProject[formProjectId]) loadBranches(formProjectId);
  }, [formProjectId, branchesByProject, loadBranches]);

  const filtered = useMemo(() => tasks.filter((t) => {
    if (projectFilter && t.projectId !== projectFilter) return false;
    if (personFilter && t.assigneeId !== personFilter) return false;
    return true;
  }), [tasks, projectFilter, personFilter]);

  async function handleMove(taskId: string, status: TaskStatus, position: number) {
    setTasks((prev) => applyMoveGlobal(prev, taskId, status, position));
    try {
      const res = await api.post<{ task: Task }>("/api/tasks/" + taskId + "/move", { status, position });
      setTasks((prev) => prev.map((t) => t.id === taskId ? res.task : t));
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się przesunąć zadania");
      loadAll();
    }
  }

  const projectName = (pid: string) => projects.find((p) => p.id === pid)?.name ?? "?";

  async function handleProductDrop(product: AiProduct, status: TaskStatus) {
    const pid = projectFilter || projects[0]?.id;
    if (!pid) {
      pushToast(false, "Najpierw wybierz projekt (filtr), aby utworzyć zadanie");
      return;
    }
    const description = [
      product.reason,
      product.price ? "Cena: " + fmtMoney(product.price) : "",
      product.supplier ? "Dostawca: " + product.supplier : "",
      product.url ? "Link: " + product.url : "",
    ].filter(Boolean).join("\n");
    try {
      const res = await api.post<{ task: Task }>("/api/projects/" + pid + "/tasks", {
        title: "[AI] " + product.name,
        description,
        status,
        priority: "medium",
        aiSource: { type: "product", product },
      });
      pushToast(true, "Zadanie utworzone: „" + res.task.title + "”");
      loadAll();
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się utworzyć zadania");
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Zadania</h1>
        <span className="sub">Tablica kanban całego zespołu</span>
        <span className="spacer" />
        <button className="btn accent" onClick={() => setShowForm(true)}>＋ Nowe zadanie</button>
      </div>

      <div className="board-toolbar" style={{ marginBottom: 14 }}>
        <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap" }}>📁 Projekt:</span>
          <select className="input" style={{ width: 240 }} value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
            <option value="">Wszystkie projekty</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>)}
          </select>
        </label>
        <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap" }}>👤 Osoba:</span>
          <select className="input" style={{ width: 220 }} value={personFilter} onChange={(e) => setPersonFilter(e.target.value)}>
            <option value="">Wszyscy</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <span className="spacer" />
        <span className="badge blue">{filtered.length} zadań</span>
      </div>

      {projects.length === 0 ? (
        <div className="panel">
          <div className="empty">
            <div className="big">📭</div>
            <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 15 }}>Brak projektów</div>
            <p style={{ marginTop: 6 }}>Najpierw utwórz projekt, aby móc dodawać zadania.</p>
          </div>
        </div>
      ) : (
        <Kanban tasks={filtered} onMove={handleMove} onOpenTask={setOpenTask}
          onAddTask={() => setShowForm(true)}
          projectId={formProjectId || undefined} onProductDrop={handleProductDrop} />
      )}

      {showForm && (
        <TaskFormModal
          projects={projects}
          projectId={formProjectId}
          branches={branchesByProject[formProjectId] ?? []}
          users={users}
          onProjectChange={(pid) => loadBranches(pid)}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); loadAll(); }}
        />
      )}

      {openTask && (
        <TaskDetailModal
          task={openTask}
          branches={branchesByProject[openTask.projectId] ?? []}
          users={users}
          onClose={() => setOpenTask(null)}
          onUpdated={(t) => {
            setTasks((prev) => prev.map((x) => x.id === t.id ? t : x));
            setOpenTask(t);
          }}
          onDeleted={(t) => {
            setTasks((prev) => prev.filter((x) => x.id !== t.id));
            setOpenTask(null);
          }}
        />
      )}
      <Toasts />
    </div>
  );
}

function applyMoveGlobal(tasks: Task[], taskId: string, status: TaskStatus, position: number): Task[] {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return tasks;
  const moved: Task = { ...task, status, position };
  const rest = tasks.filter((t) => t.id !== taskId);
  const others = rest.filter((t) => t.status !== status);
  const same = rest.filter((t) => t.status === status).sort((a, b) => a.position - b.position);
  const idx = clampPosition(position, same.length);
  same.splice(idx, 0, moved);
  same.forEach((t, i) => { t.position = i; });
  return [...others, ...same];
}
