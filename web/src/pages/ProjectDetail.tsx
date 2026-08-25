import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type User } from "../api";
import Kanban from "../components/Kanban";
import Toasts from "../components/Toasts";
import { TaskDetailModal, TaskFormModal } from "../components/TaskModal";
import { clampPosition, fmtDate, fmtMoney, monthKey, monthLabel, STATUS_LABEL, statusBadgeClass } from "../lib";
import { pushToast } from "../toast";
import type { AiProduct, Branch, BranchNode, ProjectDetail as ProjectDetailData, Task, TaskStatus } from "../types";

type Tab = "board" | "timeline" | "branches";

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectDetailData | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [tab, setTab] = useState<Tab>("board");
  const [branchFilter, setBranchFilter] = useState("");
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [formStatus, setFormStatus] = useState<TaskStatus>("todo");
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [branchModal, setBranchModal] = useState<{ mode: "create" } | { mode: "rename"; branch: Branch } | null>(null);
  const [timeline, setTimeline] = useState<Task[]>([]);

  const loadProject = useCallback(async () => {
    if (!id) return;
    try {
      const d = await api.get<ProjectDetailData>("/api/projects/" + id);
      setProject(d);
    } catch (e: any) {
      pushToast(false, e?.message || "Nie znaleziono projektu");
      navigate("/projekty");
    }
  }, [id, navigate]);

  const loadTasks = useCallback(async () => {
    if (!id) return;
    try {
      setTasks(await api.get<Task[]>("/api/projects/" + id + "/tasks"));
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się pobrać zadań");
    }
  }, [id]);

  const loadTimeline = useCallback(async () => {
    if (!id) return;
    try {
      setTimeline(await api.get<Task[]>("/api/projects/" + id + "/timeline"));
    } catch {
      /* ignoruj */
    }
  }, [id]);

  useEffect(() => {
    loadProject();
    loadTasks();
    api.get<User[]>("/api/users").then(setUsers).catch(() => {});
  }, [loadProject, loadTasks]);

  async function handleMove(taskId: string, status: TaskStatus, position: number) {
    setTasks((prev) => applyMove(prev, taskId, status, position));
    try {
      const res = await api.post<{ task: Task }>("/api/tasks/" + taskId + "/move", { status, position });
      setTasks((prev) => prev.map((t) => t.id === taskId ? res.task : t));
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się przesunąć zadania");
      loadTasks();
    }
  }

  async function handleProductDrop(product: AiProduct, status: TaskStatus) {
    if (!id) return;
    const description = [
      product.reason,
      product.price ? "Cena: " + fmtMoney(product.price) : "",
      product.supplier ? "Dostawca: " + product.supplier : "",
      product.url ? "Link: " + product.url : "",
    ].filter(Boolean).join("\n");
    try {
      const res = await api.post<{ task: Task }>("/api/projects/" + id + "/tasks", {
        title: "[AI] " + product.name,
        description,
        status,
        priority: "medium",
        aiSource: { type: "product", product },
      });
      pushToast(true, "Zadanie utworzone: „" + res.task.title + "”");
      loadTasks();
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się utworzyć zadania");
    }
  }

  async function deleteProject() {
    if (!project) return;
    if (!window.confirm("Usunąć projekt „" + project.name + "?\nWszystkie gałęzie, zadania, komentarze i historia zostaną usunięte.")) return;
    try {
      await api.del("/api/projects/" + project.id);
      pushToast(true, "Projekt usunięty");
      navigate("/projekty");
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się usunąć projektu");
    }
  }

  const filteredTasks = branchFilter ? tasks.filter((t) => t.branchId === branchFilter) : tasks;
  const branches = project?.branches ?? [];

  if (!project) {
    return <div className="page"><div className="empty"><div className="big">📂</div><p>Ładowanie…</p></div></div>;
  }

  const done = project.doneCount;
  const total = project.taskCount;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="page">
      <div className="page-head" style={{ marginBottom: 10 }}>
        <Link to="/projekty" className="back-link">← Projekty</Link>
        <span className="spacer" />
      </div>
      <div className="page-head" style={{ marginBottom: 12 }}>
        <div className="pd-emoji" style={{ background: project.color }}>{project.emoji}</div>
        <div>
          <h1>{project.name}</h1>
          {project.description && <div className="sub" style={{ marginTop: 2 }}>{project.description}</div>}
        </div>
        <span className="spacer" />
        <Link to={"/tabele?project=" + project.id} className="btn">📊 Tabele</Link>
        <Link to={"/dokumenty?project=" + project.id} className="btn">📄 Dokumenty</Link>
        <button className="btn danger small" onClick={deleteProject} title="Usuń projekt">🗑 Usuń</button>
      </div>
      <div className="pd-stats">
        <span className="badge blue">✅ {done}/{total} zrobione</span>
        <span className="badge">🌿 {project.branchCount} gałęzi</span>
        <span className="muted-text">{pct}% ukończenia</span>
        <div className="progress" style={{ flex: 1, minWidth: 140, marginTop: 0 }}><div style={{ width: pct + "%" }} /></div>
      </div>

      <div className="tabs">
        <button className={"tab" + (tab === "board" ? " active" : "")} onClick={() => setTab("board")}>🗂 Tablica</button>
        <button className={"tab" + (tab === "timeline" ? " active" : "")} onClick={() => { setTab("timeline"); loadTimeline(); }}>🗓 Oś czasu</button>
        <button className={"tab" + (tab === "branches" ? " active" : "")} onClick={() => setTab("branches")}>🌿 Gałęzie</button>
      </div>

      {tab === "board" && (
        <div>
          <div className="board-toolbar">
            <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap" }}>🌿 Gałąź:</span>
              <select className="input" style={{ width: 220 }} value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
                <option value="">Wszystkie gałęzie</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            <span className="spacer" />
            <button className="btn accent" onClick={() => { setFormStatus("todo"); setShowTaskForm(true); }}>＋ Zadanie</button>
          </div>
          <Kanban tasks={filteredTasks} onMove={handleMove} onOpenTask={setOpenTask}
            onAddTask={(s) => { setFormStatus(s); setShowTaskForm(true); }}
            projectId={project.id} onProductDrop={handleProductDrop} />
        </div>
      )}

      {tab === "timeline" && <TimelineTab tasks={timeline} />}

      {tab === "branches" && (
        <div>
          <div className="board-toolbar" style={{ marginBottom: 14 }}>
            <span className="muted-text" style={{ fontSize: 13 }}>Równoległe wersje pracy nad projektem (jak w git).</span>
            <span className="spacer" />
            <button className="btn accent" onClick={() => setBranchModal({ mode: "create" })}>＋ Gałąź</button>
          </div>
          {project.branchTree.length === 0 ? (
            <div className="panel"><div className="empty"><div className="big">🌱</div><p>Brak gałęzi — dodaj pierwszą.</p></div></div>
          ) : (
            <div className="branch-tree">
              {project.branchTree.map((b) => <BranchRow key={b.id} node={b} onRename={(br) => setBranchModal({ mode: "rename", branch: br })} onChanged={reloadAfterBranchChange} />)}
            </div>
          )}
        </div>
      )}

      {showTaskForm && id && (
        <TaskFormModal
          projectId={id} branches={branches} users={users} defaultStatus={formStatus}
          onClose={() => setShowTaskForm(false)}
          onSaved={(t) => { setShowTaskForm(false); loadTasks(); loadProject(); }}
        />
      )}

      {openTask && (
        <TaskDetailModal
          task={openTask} branches={branches} users={users}
          onClose={() => setOpenTask(null)}
          onUpdated={(t) => {
            setTasks((prev) => prev.map((x) => x.id === t.id ? t : x));
            setOpenTask(t);
          }}
          onDeleted={(t) => {
            setTasks((prev) => prev.filter((x) => x.id !== t.id));
            setOpenTask(null);
            loadProject();
          }}
        />
      )}

      {branchModal && (
        <BranchModal
          projectId={project.id} branches={branches}
          mode={branchModal.mode === "rename" ? branchModal.branch : undefined}
          onClose={() => setBranchModal(null)}
          onDone={() => { setBranchModal(null); reloadAfterBranchChange(); }}
        />
      )}
      <Toasts />
    </div>
  );

  async function reloadAfterBranchChange() {
    await loadProject();
    await loadTasks();
  }
}

function applyMove(tasks: Task[], taskId: string, status: TaskStatus, position: number): Task[] {
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

// ===== Oś czasu =====
function TimelineTab({ tasks }: { tasks: Task[] }) {
  const dated = tasks.filter((t) => t.startDate || t.dueDate);
  if (dated.length === 0) {
    return (
      <div className="panel">
        <div className="empty">
          <div className="big">🗓️</div>
          <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 15 }}>Brak zadań z datami</div>
          <p style={{ marginTop: 6 }}>Dodaj daty rozpoczęcia lub terminy do zadań, aby zobaczyć oś czasu.</p>
        </div>
      </div>
    );
  }
  const times = dated.flatMap((t) => [t.startDate, t.dueDate].filter(Boolean) as string[])
    .map((d) => new Date(d + "T00:00:00").getTime());
  const min = Math.min(...times);
  const max = Math.max(...times);
  const span = Math.max(1, max - min);

  const groups = new Map<string, Task[]>();
  for (const t of dated) {
    const key = monthKey(t.startDate ?? t.dueDate!);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }

  return (
    <div className="panel">
      <div className="timeline-head">
        <span className="muted-text" style={{ fontSize: 12.5 }}>Zakres: {fmtDate(new Date(min).toISOString())} – {fmtDate(new Date(max).toISOString())}</span>
      </div>
      {[...groups.entries()].map(([key, items]) => (
        <div key={key} className="tl-group">
          <div className="tl-group-title">📅 {capitalize(monthLabel(key))}</div>
          {items.map((t) => {
            const start = t.startDate ? new Date(t.startDate + "T00:00:00").getTime() : (t.dueDate ? new Date(t.dueDate + "T00:00:00").getTime() : min);
            const end = t.dueDate ? new Date(t.dueDate + "T00:00:00").getTime() : (t.startDate ? new Date(t.startDate + "T00:00:00").getTime() : max);
            const left = ((start - min) / span) * 100;
            const width = Math.max(2, ((end - start) / span) * 100);
            return (
              <div key={t.id} className="tl-row">
                <div className="tl-dates">
                  {t.startDate && <span>{fmtDate(t.startDate)}</span>}
                  {t.startDate && t.dueDate && <span style={{ color: "var(--muted)" }}> → </span>}
                  {t.dueDate && <b>{fmtDate(t.dueDate)}</b>}
                </div>
                <div className="tl-track" title={t.title}>
                  <div className="tl-bar" style={{ left: left + "%", width: width + "%" }} />
                </div>
                <div className="tl-status">
                  <span className={statusBadgeClass(t.status)}>{STATUS_LABEL[t.status]}</span>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ===== Gałęzie =====
function BranchRow({ node, onRename, onChanged }: { node: BranchNode; onRename: (b: Branch) => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!window.confirm("Usunąć gałąź „" + node.name + "?\nGałęzie podrzędne zostaną usunięte, a zadania pozostaną (bez gałęzi).")) return;
    setBusy(true);
    try {
      await api.del("/api/branches/" + node.id);
      pushToast(true, "Gałąź usunięta");
      onChanged();
    } catch (e: any) {
      pushToast(false, e?.message || "Błąd");
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="branch-row">
        <span style={{ fontSize: 15 }}>🌿</span>
        <span style={{ fontWeight: 700 }}>{node.name}</span>
        <span className="badge">{node.taskCount} zadań</span>
        <span className="spacer" />
        <button className="btn small" onClick={() => onRename(node)} title="Zmień nazwę" aria-label="Zmień nazwę">✏️</button>
        <button className="btn small danger" onClick={remove} disabled={busy} title="Usuń gałąź" aria-label="Usuń gałąź">🗑</button>
      </div>
      {node.children.length > 0 && (
        <div className="branch-children">
          {node.children.map((c) => <BranchRow key={c.id} node={c} onRename={onRename} onChanged={onChanged} />)}
        </div>
      )}
    </div>
  );
}

function BranchModal({ projectId, branches, mode, onClose, onDone }: {
  projectId: string;
  branches: Branch[];
  mode?: Branch; // tryb edycji
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(mode?.name ?? "");
  const [parentId, setParentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    setErr("");
    if (!name.trim()) { setErr("Podaj nazwę gałęzi"); return; }
    setBusy(true);
    try {
      if (mode) {
        await api.patch("/api/branches/" + mode.id, { name: name.trim() });
        pushToast(true, "Nazwa zmieniona");
      } else {
        await api.post("/api/projects/" + projectId + "/branches", { name: name.trim(), parentId: parentId || null });
        pushToast(true, "Gałąź utworzona");
      }
      onDone();
    } catch (e: any) {
      setErr(e?.message || "Nie udało się zapisać");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h2>{mode ? "✏️ Zmień nazwę gałęzi" : "＋ Nowa gałąź"}</h2>
        <div style={{ display: "grid", gap: 12 }}>
          <label className="field">
            Nazwa
            <input className="input" value={name} autoFocus maxLength={120} placeholder="np. Wariant budżetowy"
              onChange={(e) => setName(e.target.value)} />
          </label>
          {!mode && (
            <label className="field">
              Gałąź nadrzędna
              <select className="input" value={parentId} onChange={(e) => setParentId(e.target.value)}>
                <option value="">— główna (bez nadrzędnej) —</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
          )}
        </div>
        {err && <div className="login-error" style={{ marginTop: 12 }}>⚠️ {err}</div>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>Anuluj</button>
          <button className="btn accent" disabled={busy} onClick={submit}>
            {busy ? "Zapisywanie…" : mode ? "Zapisz" : "Utwórz gałąź"}
          </button>
        </div>
      </div>
    </div>
  );
}
