import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { newId, nowISO, safeParse } from "../util";
import { requireAuth } from "../auth";
import { notifyComment, notifyTaskAssigned } from "../mailer";

// Router montowany na /api/projects → obsługuje /api/projects/:id/tasks i /api/projects/:id/timeline
export const projectTasksRouter = Router();
projectTasksRouter.use(requireAuth);

// Router montowany na /api/tasks → obsługuje /api/tasks/:id, /move, /comments
export const tasksRouter = Router();
tasksRouter.use(requireAuth);

const TASK_STATUSES = ["todo", "in_progress", "review", "done"] as const;
const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;

const taskStatusSchema = z.enum(TASK_STATUSES);
const taskPrioritySchema = z.enum(TASK_PRIORITIES);

// Pola przyjmowane jako snake_case (zgodnie ze specyfikacją) i camelCase (konwencja API)
const createTaskSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(20000).optional(),
  branch_id: z.string().nullable().optional(),
  branchId: z.string().nullable().optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  assignee_id: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  position: z.number().int().min(0).optional(),
  // Źródło AI (skąd zadanie powstało, np. karta produktu z asystenta)
  aiSource: z.unknown().optional(),
});
const patchTaskSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(20000).nullable().optional(),
  branch_id: z.string().nullable().optional(),
  branchId: z.string().nullable().optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  assignee_id: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
});
const moveSchema = z.object({
  status: taskStatusSchema,
  position: z.number().int().min(0),
});
const commentSchema = z.object({ body: z.string().min(1).max(5000) });

const TASK_SELECT = `
  SELECT t.*,
    a.name AS assignee_name, a.email AS assignee_email, a.avatar_color AS assignee_avatar_color,
    c.name AS creator_name, c.avatar_color AS creator_avatar_color
  FROM tasks t
  LEFT JOIN users a ON a.id = t.assignee_id
  LEFT JOIN users c ON c.id = t.created_by`;

function serializeTask(r: any) {
  return {
    id: r.id,
    projectId: r.project_id,
    branchId: r.branch_id ?? null,
    title: r.title,
    description: r.description ?? "",
    status: r.status,
    priority: r.priority,
    assigneeId: r.assignee_id ?? null,
    createdBy: r.created_by,
    startDate: r.start_date ?? null,
    dueDate: r.due_date ?? null,
    position: r.position ?? 0,
    aiSource: safeParse(r.ai_source, null),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    assignee: r.assignee_id ? {
      id: r.assignee_id,
      name: r.assignee_name,
      email: r.assignee_email,
      avatarColor: r.assignee_avatar_color,
    } : null,
    creator: { id: r.created_by, name: r.creator_name, avatarColor: r.creator_avatar_color },
  };
}

function getTaskRaw(id: string): any {
  return db.prepare(TASK_SELECT + " WHERE t.id = ?").get(id) as any;
}

function projectExists(id: string): boolean {
  return !!db.prepare("SELECT id FROM projects WHERE id = ?").get(id);
}
function userExists(id: string): boolean {
  return !!db.prepare("SELECT id FROM users WHERE id = ?").get(id);
}
function branchInProject(branchId: string, projectId: string): boolean {
  return !!db.prepare("SELECT id FROM branches WHERE id = ? AND project_id = ?").get(branchId, projectId);
}
function getUserRow(id: string): any {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as any;
}
function projectName(id: string): string {
  return (db.prepare("SELECT name FROM projects WHERE id = ?").get(id) as any)?.name ?? "Projekt";
}
function validDate(s: string | null | undefined): boolean {
  if (s === null || s === undefined) return true;
  return !Number.isNaN(Date.parse(s));
}

function logActivity(taskId: string, userId: string, action: string, meta?: unknown) {
  db.prepare(
    "INSERT INTO task_activity (id, task_id, user_id, action, meta, created_at) VALUES (?,?,?,?,?,?)"
  ).run(newId(), taskId, userId, action, meta !== undefined ? JSON.stringify(meta) : null, nowISO());
}

// ===== Lista zadań projektu (filtry: status, branch_id, assignee_id) =====
projectTasksRouter.get("/:id/tasks", (req, res) => {
  const projectId = req.params.id;
  if (!projectExists(projectId)) { res.status(404).json({ error: "Nie znaleziono projektu" }); return; }
  const { status, branch_id, branchId, assignee_id, assigneeId } = req.query as Record<string, string | undefined>;
  const where: string[] = ["t.project_id = ?"];
  const params: any[] = [projectId];
  if (status !== undefined) {
    const p = taskStatusSchema.safeParse(status);
    if (!p.success) { res.status(400).json({ error: "Nieprawidłowy status" }); return; }
    where.push("t.status = ?"); params.push(p.data);
  }
  const b = branch_id ?? branchId;
  if (b !== undefined) {
    if (!branchInProject(b, projectId)) { res.status(400).json({ error: "Gałąź nie należy do projektu" }); return; }
    where.push("t.branch_id = ?"); params.push(b);
  }
  const a = assignee_id ?? assigneeId;
  if (a !== undefined) {
    if (a && !userExists(a)) { res.status(400).json({ error: "Nie znaleziono użytkownika" }); return; }
    where.push("t.assignee_id = ?"); params.push(a || null);
  }
  const rows = db.prepare(
    TASK_SELECT + " WHERE " + where.join(" AND ") +
    " ORDER BY CASE t.status WHEN 'todo' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'review' THEN 2 WHEN 'done' THEN 3 END, t.position ASC, t.created_at ASC"
  ).all(...params) as any[];
  res.json(rows.map(serializeTask));
});

// ===== Utworzenie zadania =====
projectTasksRouter.post("/:id/tasks", (req, res) => {
  const projectId = req.params.id;
  if (!projectExists(projectId)) { res.status(404).json({ error: "Nie znaleziono projektu" }); return; }
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Nieprawidłowe dane zadania", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const branchId = d.branch_id ?? d.branchId ?? null;
  const assigneeId = d.assignee_id ?? d.assigneeId ?? null;
  const startDate = d.start_date ?? d.startDate ?? null;
  const dueDate = d.due_date ?? d.dueDate ?? null;
  if (branchId && !branchInProject(branchId, projectId)) {
    res.status(400).json({ error: "Gałąź nie należy do projektu" }); return;
  }
  if (assigneeId && !userExists(assigneeId)) {
    res.status(400).json({ error: "Nie znaleziono użytkownika" }); return;
  }
  if (!validDate(startDate) || !validDate(dueDate)) {
    res.status(400).json({ error: "Nieprawidłowa data" }); return;
  }
  const status = d.status ?? "todo";
  const priority = d.priority ?? "medium";
  const id = newId();
  db.exec("BEGIN");
  try {
    let position = d.position;
    if (position === undefined) {
      const max = db.prepare(
        "SELECT COALESCE(MAX(position), -1) AS m FROM tasks WHERE project_id = ? AND status = ?"
      ).get(projectId, status) as { m: number };
      position = max.m + 1;
    } else {
      db.prepare("UPDATE tasks SET position = position + 1 WHERE project_id = ? AND status = ? AND position >= ?")
        .run(projectId, status, position);
    }
    const t = nowISO();
    const aiSource = d.aiSource !== undefined ? JSON.stringify(d.aiSource) : null;
    db.prepare(
      `INSERT INTO tasks (id, project_id, branch_id, title, description, status, priority, assignee_id,
         created_by, start_date, due_date, position, ai_source, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(id, projectId, branchId, d.title, d.description ?? "", status, priority, assigneeId,
      req.user!.id, startDate, dueDate, position, aiSource, t, t);
    logActivity(id, req.user!.id, "created", {
      title: d.title, status, priority, assigneeId, branchId,
    });
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  // E-mail: powiadom nowego wykonawcę (jeśli nie jest autorem zmiany)
  if (assigneeId && assigneeId !== req.user!.id) {
    const assignee = getUserRow(assigneeId);
    if (assignee) notifyTaskAssigned(assignee, getTaskRaw(id), projectName(projectId));
  }
  res.status(201).json({ task: serializeTask(getTaskRaw(id)) });
});

// ===== Szczegóły zadania + komentarze + aktywność =====
tasksRouter.get("/:id", (req, res) => {
  const row = getTaskRaw(req.params.id);
  if (!row) { res.status(404).json({ error: "Nie znaleziono zadania" }); return; }
  const comments = db.prepare(
    `SELECT tc.*, u.name AS author_name, u.avatar_color AS author_avatar_color
     FROM task_comments tc JOIN users u ON u.id = tc.user_id
     WHERE tc.task_id = ? ORDER BY tc.created_at ASC`
  ).all(req.params.id) as any[];
  const activity = db.prepare(
    `SELECT ta.*, u.name AS user_name, u.avatar_color AS user_avatar_color
     FROM task_activity ta JOIN users u ON u.id = ta.user_id
     WHERE ta.task_id = ? ORDER BY ta.created_at DESC`
  ).all(req.params.id) as any[];
  res.json({
    task: serializeTask(row),
    comments: comments.map(serializeComment),
    activity: activity.map(serializeActivity),
  });
});

// ===== Edycja zadania (loguje activity: moved / assigned) =====
tasksRouter.patch("/:id", (req, res) => {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id) as any;
  if (!task) { res.status(404).json({ error: "Nie znaleziono zadania" }); return; }
  const parsed = patchTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Nieprawidłowe dane zadania", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const branchId = d.branch_id !== undefined ? d.branch_id : d.branchId;
  const assigneeId = d.assignee_id !== undefined ? d.assignee_id : d.assigneeId;
  const startDate = d.start_date !== undefined ? d.start_date : d.startDate;
  const dueDate = d.due_date !== undefined ? d.due_date : d.dueDate;

  if (branchId !== undefined && branchId !== null && !branchInProject(branchId, task.project_id)) {
    res.status(400).json({ error: "Gałąź nie należy do projektu" }); return;
  }
  if (assigneeId !== undefined && assigneeId !== null && !userExists(assigneeId)) {
    res.status(400).json({ error: "Nie znaleziono użytkownika" }); return;
  }
  if (!validDate(startDate) || !validDate(dueDate)) {
    res.status(400).json({ error: "Nieprawidłowa data" }); return;
  }

  let assignedTo: string | null = null;
  db.exec("BEGIN");
  try {
    const sets: string[] = [];
    const params: any[] = [];
    const map: [string, unknown][] = [
      ["title", d.title],
      ["description", d.description !== undefined ? d.description : undefined],
      ["priority", d.priority],
      ["branch_id", branchId],
      ["assignee_id", assigneeId],
      ["start_date", startDate],
      ["due_date", dueDate],
    ];
    for (const [col, v] of map) {
      if (v !== undefined) { sets.push(col + " = ?"); params.push(v); }
    }
    // zmiana statusu → przesunięcie na koniec kolumny docelowej + activity "moved"
    if (d.status !== undefined && d.status !== task.status) {
      const max = db.prepare(
        "SELECT COALESCE(MAX(position), -1) AS m FROM tasks WHERE project_id = ? AND status = ?"
      ).get(task.project_id, d.status) as { m: number };
      sets.push("status = ?"); params.push(d.status);
      sets.push("position = ?"); params.push(max.m + 1);
      logActivity(task.id, req.user!.id, "moved", { from: task.status, to: d.status });
    }
    // zmiana przypisania → activity "assigned"
    if (assigneeId !== undefined && assigneeId !== task.assignee_id) {
      const oldAssignee = task.assignee_id ?? null;
      const newAssignee = assigneeId ?? null;
      const nameOf = (id: string | null) =>
        id === null ? null : (db.prepare("SELECT name FROM users WHERE id = ?").get(id) as any)?.name ?? null;
      logActivity(task.id, req.user!.id, "assigned", {
        from: oldAssignee, to: newAssignee, fromName: nameOf(oldAssignee), toName: nameOf(newAssignee),
      });
      assignedTo = newAssignee;
    }
    if (sets.length > 0) {
      sets.push("updated_at = ?");
      params.push(nowISO(), task.id);
      db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...params);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  // E-mail: nowy wykonawca (jeśli nie jest autorem zmiany)
  if (assignedTo && assignedTo !== req.user!.id) {
    const assignee = getUserRow(assignedTo);
    if (assignee) notifyTaskAssigned(assignee, getTaskRaw(task.id), projectName(task.project_id));
  }
  res.json({ task: serializeTask(getTaskRaw(task.id)) });
});

// ===== Usunięcie zadania (kaskada: komentarze i aktywność) =====
tasksRouter.delete("/:id", (req, res) => {
  const task = db.prepare("SELECT id FROM tasks WHERE id = ?").get(req.params.id) as any;
  if (!task) { res.status(404).json({ error: "Nie znaleziono zadania" }); return; }
  db.prepare("DELETE FROM tasks WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ===== Przesunięcie w kanban (status + pozycja, activity "moved") =====
tasksRouter.post("/:id/move", (req, res) => {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id) as any;
  if (!task) { res.status(404).json({ error: "Nie znaleziono zadania" }); return; }
  const parsed = moveSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Nieprawidłowe dane przesunięcia" }); return; }
  const { status, position } = parsed.data;
  db.exec("BEGIN");
  try {
    const index = reorderInColumn(task.project_id, status, task.id, position);
    db.prepare("UPDATE tasks SET status = ?, position = ?, updated_at = ? WHERE id = ?")
      .run(status, index, nowISO(), task.id);
    if (status !== task.status) {
      // wyrównaj pozycje w kolumnie źródłowej
      const src = db.prepare(
        "SELECT id, position FROM tasks WHERE project_id = ? AND status = ? ORDER BY position ASC, created_at ASC"
      ).all(task.project_id, task.status) as { id: string; position: number }[];
      src.forEach((r, i) => {
        if (r.position !== i) db.prepare("UPDATE tasks SET position = ? WHERE id = ?").run(i, r.id);
      });
      logActivity(task.id, req.user!.id, "moved", { from: task.status, to: status, position: index });
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  res.json({ ok: true, task: serializeTask(getTaskRaw(task.id)) });
});

// ===== Komentarze zadania =====
tasksRouter.get("/:id/comments", (req, res) => {
  const task = db.prepare("SELECT id FROM tasks WHERE id = ?").get(req.params.id) as any;
  if (!task) { res.status(404).json({ error: "Nie znaleziono zadania" }); return; }
  const rows = db.prepare(
    `SELECT tc.*, u.name AS author_name, u.avatar_color AS author_avatar_color
     FROM task_comments tc JOIN users u ON u.id = tc.user_id
     WHERE tc.task_id = ? ORDER BY tc.created_at ASC`
  ).all(req.params.id) as any[];
  res.json(rows.map(serializeComment));
});

tasksRouter.post("/:id/comments", (req, res) => {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id) as any;
  if (!task) { res.status(404).json({ error: "Nie znaleziono zadania" }); return; }
  const parsed = commentSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Komentarz nie może być pusty" }); return; }
  const id = newId();
  db.prepare("INSERT INTO task_comments (id, task_id, user_id, body, created_at) VALUES (?,?,?,?,?)")
    .run(id, req.params.id, req.user!.id, parsed.data.body, nowISO());
  const created = db.prepare(
    `SELECT tc.*, u.name AS author_name, u.avatar_color AS author_avatar_color
     FROM task_comments tc JOIN users u ON u.id = tc.user_id WHERE tc.id = ?`
  ).get(id) as any;
  // E-mail: wykonawca i twórca zadania (pomijając autora komentarza)
  const recipients = new Set<string>();
  if (task.assignee_id) recipients.add(task.assignee_id);
  if (task.created_by) recipients.add(task.created_by);
  recipients.delete(req.user!.id);
  for (const uid of recipients) {
    const u = getUserRow(uid);
    if (u) notifyComment(u, task, req.user!.name, parsed.data.body);
  }
  res.status(201).json({ comment: serializeComment(created) });
});

// ===== Oś czasu projektu (zadania z datami, posortowane) =====
projectTasksRouter.get("/:id/timeline", (req, res) => {
  const projectId = req.params.id;
  if (!projectExists(projectId)) { res.status(404).json({ error: "Nie znaleziono projektu" }); return; }
  const rows = db.prepare(
    TASK_SELECT + " WHERE t.project_id = ? AND (t.start_date IS NOT NULL OR t.due_date IS NOT NULL)" +
    " ORDER BY COALESCE(t.start_date, t.due_date) ASC, t.position ASC"
  ).all(projectId) as any[];
  res.json(rows.map(serializeTask));
});

// ===== Pomocnicze =====
function serializeComment(r: any) {
  return {
    id: r.id,
    taskId: r.task_id,
    body: r.body,
    createdAt: r.created_at,
    author: { id: r.user_id, name: r.author_name, avatarColor: r.author_avatar_color },
  };
}

function serializeActivity(r: any) {
  return {
    id: r.id,
    taskId: r.task_id,
    action: r.action,
    meta: safeParse(r.meta, null),
    createdAt: r.created_at,
    user: { id: r.user_id, name: r.user_name, avatarColor: r.user_avatar_color },
  };
}

// Wstawia zadanie w kolumnie (status) na pozycji position (0..n) i wyrównuje pozycje pozostałych.
function reorderInColumn(projectId: string, status: string, taskId: string, position: number): number {
  const rows = db.prepare(
    "SELECT id, position FROM tasks WHERE project_id = ? AND status = ? ORDER BY position ASC, created_at ASC"
  ).all(projectId, status) as { id: string; position: number }[];
  const list = rows.filter((r) => r.id !== taskId);
  const index = Math.max(0, Math.min(Math.floor(position), list.length));
  list.splice(index, 0, { id: taskId, position: 0 });
  list.forEach((r, i) => {
    if (r.position !== i) db.prepare("UPDATE tasks SET position = ? WHERE id = ?").run(i, r.id);
  });
  return index;
}
