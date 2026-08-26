import { useEffect, useState } from "react";
import { api } from "../api";
import { fmtDate, PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL, priorityBadgeClass, statusBadgeClass } from "../lib";
import { pushToast } from "../toast";
import type { Branch, Project, Task, TaskActivity, TaskComment, TaskPriority, TaskStatus } from "../types";
import type { User } from "../api";
import Avatar from "./Avatar";

export interface TaskFormState {
  projectId: string;
  title: string;
  description: string;
  branchId: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string;
  startDate: string;
  dueDate: string;
}

export function emptyForm(projectId: string, status: TaskStatus = "todo"): TaskFormState {
  return {
    projectId, title: "", description: "", branchId: "",
    status, priority: "medium", assigneeId: "", startDate: "", dueDate: "",
  };
}

// ===== Wspólne pola formularza =====
function TaskFields({
  form, set, branches, users, projects, fixedProject, onProjectChange,
}: {
  form: TaskFormState;
  set: (patch: Partial<TaskFormState>) => void;
  branches: Branch[];
  users: User[];
  projects?: Project[];
  fixedProject?: boolean;
  onProjectChange?: (projectId: string) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {projects && !fixedProject && (
        <label className="field">
          Projekt
          <select className="input" value={form.projectId}
            onChange={(e) => { set({ projectId: e.target.value, branchId: "" }); onProjectChange?.(e.target.value); }}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        Tytuł
        <input className="input" value={form.title} maxLength={300} autoFocus
          onChange={(e) => set({ title: e.target.value })} placeholder="np. Zamówić pralkę przemysłową" />
      </label>
      <label className="field">
        Opis
        <textarea className="input" rows={3} value={form.description}
          onChange={(e) => set({ description: e.target.value })} placeholder="Szczegóły zadania (opcjonalnie)" />
      </label>
      <div className="row">
        <label className="field">
          Gałąź
          <select className="input" value={form.branchId} onChange={(e) => set({ branchId: e.target.value })}>
            <option value="">— bez gałęzi —</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label className="field">
          Priorytet
          <select className="input" value={form.priority} onChange={(e) => set({ priority: e.target.value as TaskPriority })}>
            {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.emoji} {p.label}</option>)}
          </select>
        </label>
      </div>
      <div className="row">
        <label className="field">
          Status
          <select className="input" value={form.status} onChange={(e) => set({ status: e.target.value as TaskStatus })}>
            {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.emoji} {s.label}</option>)}
          </select>
        </label>
        <label className="field">
          Przypisany
          <select className="input" value={form.assigneeId} onChange={(e) => set({ assigneeId: e.target.value })}>
            <option value="">— nikt —</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
      </div>
      <div className="row">
        <label className="field">
          Data rozpoczęcia
          <input className="input" type="date" value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} />
        </label>
        <label className="field">
          Termin (due)
          <input className="input" type="date" value={form.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
        </label>
      </div>
    </div>
  );
}

// ===== Modal: nowe / edycja zadania =====
export function TaskFormModal({
  projects, projectId, branches, users, defaultStatus, task, fixedProject, onProjectChange,
  onClose, onSaved,
}: {
  projects?: Project[];
  projectId: string;
  branches: Branch[];
  users: User[];
  defaultStatus?: TaskStatus;
  task?: Task | null;
  fixedProject?: boolean;
  onProjectChange?: (projectId: string) => void;
  onClose: () => void;
  onSaved: (task: Task) => void;
}) {
  const [form, setForm] = useState<TaskFormState>(() => task ? {
    projectId, title: task.title, description: task.description, branchId: task.branchId ?? "",
    status: task.status, priority: task.priority, assigneeId: task.assigneeId ?? "",
    startDate: task.startDate ?? "", dueDate: task.dueDate ?? "",
  } : emptyForm(projectId || (projects && projects.length ? projects[0].id : ""), defaultStatus));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function set(patch: Partial<TaskFormState>) { setForm((f) => ({ ...f, ...patch })); }

  async function submit() {
    setErr("");
    if (!form.title.trim()) { setErr("Podaj tytuł zadania"); return; }
    if (!form.projectId) { setErr("Wybierz projekt"); return; }
    setBusy(true);
    try {
      const body = {
        title: form.title.trim(),
        description: form.description,
        branchId: form.branchId || null,
        status: form.status,
        priority: form.priority,
        assigneeId: form.assigneeId || null,
        startDate: form.startDate || null,
        dueDate: form.dueDate || null,
      };
      if (task) {
        const res = await api.patch<{ task: Task }>("/api/tasks/" + task.id, body);
        onSaved(res.task);
        pushToast(true, "Zadanie zaktualizowane");
      } else {
        const res = await api.post<{ task: Task }>("/api/projects/" + form.projectId + "/tasks", body);
        onSaved(res.task);
        pushToast(true, "Zadanie utworzone");
      }
    } catch (e: any) {
      setErr(e?.message || "Nie udało się zapisać zadania");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h2>{task ? "✏️ Edytuj zadanie" : "＋ Nowe zadanie"}</h2>
        <TaskFields
          form={form} set={set} branches={branches} users={users}
          projects={projects} fixedProject={fixedProject} onProjectChange={onProjectChange}
        />
        {err && <div className="login-error" style={{ marginTop: 12 }}>⚠️ {err}</div>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>Anuluj</button>
          <button className="btn accent" disabled={busy} onClick={submit}>
            {busy ? "Zapisywanie…" : task ? "Zapisz zmiany" : "Utwórz zadanie"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== Modal: szczegóły zadania (opis, edycja, komentarze, aktywność) =====
export function TaskDetailModal({
  task, branches, users, onClose, onUpdated, onDeleted,
}: {
  task: Task;
  branches: Branch[];
  users: User[];
  onClose: () => void;
  onUpdated: (task: Task) => void;
  onDeleted: (task: Task) => void;
}) {
  const [detail, setDetail] = useState<{ task: Task; comments: TaskComment[]; activity: TaskActivity[] } | null>(null);
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editForm, setEditForm] = useState<TaskFormState | null>(null);

  useEffect(() => {
    api.get<{ task: Task; comments: TaskComment[]; activity: TaskActivity[] }>("/api/tasks/" + task.id)
      .then(setDetail)
      .catch((e) => pushToast(false, e?.message || "Nie udało się pobrać zadania"));
  }, [task.id]);

  useEffect(() => {
    if (editing && detail) {
      const t = detail.task;
      setEditForm({
        projectId: t.projectId, title: t.title, description: t.description, branchId: t.branchId ?? "",
        status: t.status, priority: t.priority, assigneeId: t.assigneeId ?? "",
        startDate: t.startDate ?? "", dueDate: t.dueDate ?? "",
      });
    }
  }, [editing, detail]);

  if (!detail) {
    return (
      <div className="modal-backdrop">
        <div className="modal"><h2>Ładowanie…</h2></div>
      </div>
    );
  }

  const t = detail.task;
  const branch = branches.find((b) => b.id === t.branchId);

  async function addComment() {
    const body = comment.trim();
    if (!body) return;
    setBusy(true);
    try {
      const res = await api.post<{ comment: TaskComment }>("/api/tasks/" + t.id + "/comments", { body });
      setDetail((d) => d ? { ...d, comments: [...d.comments, res.comment] } : d);
      setComment("");
      pushToast(true, "Komentarz dodany");
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się dodać komentarza");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (!editForm) return;
    if (!editForm.title.trim()) { pushToast(false, "Podaj tytuł zadania"); return; }
    setBusy(true);
    try {
      const body = {
        title: editForm.title.trim(), description: editForm.description,
        branchId: editForm.branchId || null, status: editForm.status, priority: editForm.priority,
        assigneeId: editForm.assigneeId || null, startDate: editForm.startDate || null, dueDate: editForm.dueDate || null,
      };
      const res = await api.patch<{ task: Task }>("/api/tasks/" + t.id, body);
      setDetail((d) => d ? { ...d, task: res.task } : d);
      setEditing(false);
      onUpdated(res.task);
      pushToast(true, "Zadanie zaktualizowane");
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się zapisać");
    } finally {
      setBusy(false);
    }
  }

  async function removeTask() {
    if (!window.confirm("Usunąć zadanie „" + t.title + "?\nKomentarze i historia zostaną usunięte.")) return;
    setDeleting(true);
    try {
      await api.del("/api/tasks/" + t.id);
      onDeleted(t);
      pushToast(true, "Zadanie usunięte");
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się usunąć zadania");
      setDeleting(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal wide">
        <div className="td-head">
          <div className="td-title">
            <span className={statusBadgeClass(t.status)}>{STATUS_LABEL[t.status]}</span>
            <h2>{t.title}</h2>
          </div>
          <button className="btn small ghost" onClick={onClose}>✕</button>
        </div>

        {editing && editForm ? (
          <>
            <TaskFields form={editForm} set={(p) => setEditForm((f) => f ? { ...f, ...p } : f)} branches={branches} users={users} />
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setEditing(false)}>Anuluj</button>
              <button className="btn accent" disabled={busy} onClick={saveEdit}>{busy ? "Zapisywanie…" : "Zapisz zmiany"}</button>
            </div>
          </>
        ) : (
          <>
            <div className="td-meta">
              {branch && <span className="badge blue">🌿 {branch.name}</span>}
              <span className={priorityBadgeClass(t.priority)}>{PRIORITY_LABEL[t.priority]}</span>
              {t.assignee && (
                <span className="td-person"><Avatar name={t.assignee.name} color={t.assignee.avatarColor} size={20} /> {t.assignee.name}</span>
              )}
              {!t.assignee && <span className="muted-text">Bez przypisania</span>}
              <span className="muted-text">🗓 start: {fmtDate(t.startDate)} · termin: {fmtDate(t.dueDate)}</span>
            </div>
            <div className="td-desc">
              <div className="td-section-title">Opis</div>
              {t.description ? <p style={{ whiteSpace: "pre-wrap" }}>{t.description}</p> : <p className="muted-text">Brak opisu.</p>}
            </div>
            <div className="modal-actions" style={{ marginTop: 8 }}>
              <button className="btn small" onClick={() => setEditing(true)}>✏️ Edytuj</button>
            </div>

            <div className="td-comments">
              <div className="td-section-title">💬 Komentarze ({detail.comments.length})</div>
              {detail.comments.length === 0 && <p className="muted-text" style={{ fontSize: 12.5 }}>Brak komentarzy.</p>}
              {detail.comments.map((c) => (
                <div key={c.id} className="comment-item">
                  <Avatar name={c.author.name} color={c.author.avatarColor} size={26} />
                  <div style={{ flex: 1 }}>
                    <div className="c-meta"><b>{c.author.name}</b> · {fmtDate(c.createdAt)}</div>
                    <div className="c-body">{c.body}</div>
                  </div>
                </div>
              ))}
              <div className="comment-add">
                <input className="input" value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addComment(); }}
                  placeholder="Dodaj komentarz…" />
                <button className="btn accent small" disabled={busy || !comment.trim()} onClick={addComment}>Wyślij</button>
              </div>
            </div>

            <div className="td-activity">
              <div className="td-section-title">🕘 Aktywność ({detail.activity.length})</div>
              {detail.activity.map((a) => (
                <div key={a.id} className="activity-item">
                  <Avatar name={a.user.name} color={a.user.avatarColor} size={22} />
                  <div style={{ flex: 1 }}>
                    <b>{a.user.name}</b> {activityLabel(a)}
                  </div>
                  <span className="a-time">{fmtDate(a.createdAt)}</span>
                </div>
              ))}
            </div>

            <div className="modal-actions" style={{ justifyContent: "space-between" }}>
              <button className="btn danger small" disabled={deleting} onClick={removeTask}>
                {deleting ? "Usuwanie…" : "🗑 Usuń zadanie"}
              </button>
              <button className="btn ghost" onClick={onClose}>Zamknij</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function activityLabel(a: TaskActivity): string {
  switch (a.action) {
    case "created":
      return "utworzył/a zadanie";
    case "moved": {
      const from = a.meta?.from as string | undefined;
      const to = a.meta?.to as string | undefined;
      const fromL = from ? (STATUS_LABEL[from as TaskStatus] ?? from) : "?";
      const toL = to ? (STATUS_LABEL[to as TaskStatus] ?? to) : "?";
      return "przeniósł/a: " + fromL + " → " + toL;
    }
    case "assigned": {
      const toName = a.meta?.toName as string | null | undefined;
      return toName ? "przypisał/a do " + toName : "usunął/a przypisanie";
    }
    default:
      return a.action;
  }
}
