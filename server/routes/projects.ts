import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { newId, nowISO } from "../util";
import { requireAuth } from "../auth";

// ===== Projekty =====
export const projectsRouter = Router();
projectsRouter.use(requireAuth);

// ===== Gałęzie (PATCH/DELETE /api/branches/:id) =====
export const branchesRouter = Router();
branchesRouter.use(requireAuth);

const PROJECT_COLUMNS = ["name", "description", "emoji", "color", "status"] as const;

const projectCreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional().default(""),
  emoji: z.string().min(1).max(8).optional().default("📁"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default("#ff6b5e"),
});
const projectPatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  emoji: z.string().min(1).max(8).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  status: z.enum(["active", "archived", "done"]).optional(),
});

const PROJECT_SELECT = `
  SELECT p.*,
    (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
    (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS done_count,
    (SELECT COUNT(*) FROM branches b WHERE b.project_id = p.id) AS branch_count
  FROM projects p`;

function serializeProject(r: any) {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? "",
    emoji: r.emoji,
    color: r.color,
    status: r.status,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    taskCount: r.task_count ?? 0,
    doneCount: r.done_count ?? 0,
    branchCount: r.branch_count ?? 0,
  };
}

// ---- Lista projektów z licznikami ----
projectsRouter.get("/", (_req, res) => {
  const rows = db.prepare(PROJECT_SELECT + " ORDER BY p.created_at DESC").all() as any[];
  res.json(rows.map(serializeProject));
});

// ---- Utworzenie projektu ----
projectsRouter.post("/", (req, res) => {
  const parsed = projectCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Nieprawidłowe dane projektu", details: parsed.error.flatten() });
    return;
  }
  const { name, description, emoji, color } = parsed.data;
  const id = newId();
  const t = nowISO();
  db.prepare(
    "INSERT INTO projects (id, name, description, emoji, color, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)"
  ).run(id, name, description, emoji, color, "active", req.user!.id, t, t);
  const row = db.prepare(PROJECT_SELECT + " WHERE p.id = ?").get(id) as any;
  res.status(201).json({ project: serializeProject(row) });
});

// ---- Szczegóły projektu + gałęzie (drzewo) + liczniki ----
projectsRouter.get("/:id", (req, res) => {
  const row = db.prepare(PROJECT_SELECT + " WHERE p.id = ?").get(req.params.id) as any;
  if (!row) { res.status(404).json({ error: "Nie znaleziono projektu" }); return; }
  const branches = listBranches(req.params.id);
  res.json({ project: serializeProject(row), branches, branchTree: buildTree(branches) });
});

// ---- Edycja projektu ----
projectsRouter.patch("/:id", (req, res) => {
  const row = db.prepare("SELECT id FROM projects WHERE id = ?").get(req.params.id) as any;
  if (!row) { res.status(404).json({ error: "Nie znaleziono projektu" }); return; }
  const parsed = projectPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Nieprawidłowe dane projektu", details: parsed.error.flatten() });
    return;
  }
  const sets: string[] = [];
  const params: any[] = [];
  for (const col of PROJECT_COLUMNS) {
    if (parsed.data[col] !== undefined) {
      sets.push(col + " = ?");
      params.push(parsed.data[col]);
    }
  }
  if (sets.length === 0) { res.json({ project: serializeProject(db.prepare(PROJECT_SELECT + " WHERE p.id = ?").get(req.params.id) as any) }); return; }
  sets.push("updated_at = ?");
  params.push(nowISO(), req.params.id);
  db.prepare(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  const updated = db.prepare(PROJECT_SELECT + " WHERE p.id = ?").get(req.params.id) as any;
  res.json({ project: serializeProject(updated) });
});

// ---- Usunięcie projektu (kaskada na gałęzie i zadania) ----
projectsRouter.delete("/:id", (req, res) => {
  const row = db.prepare("SELECT id FROM projects WHERE id = ?").get(req.params.id) as any;
  if (!row) { res.status(404).json({ error: "Nie znaleziono projektu" }); return; }
  db.prepare("DELETE FROM projects WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ---- Gałęzie projektu (lista + drzewo) ----
projectsRouter.get("/:id/branches", (req, res) => {
  const row = db.prepare("SELECT id FROM projects WHERE id = ?").get(req.params.id) as any;
  if (!row) { res.status(404).json({ error: "Nie znaleziono projektu" }); return; }
  const branches = listBranches(req.params.id);
  res.json({ branches, branchTree: buildTree(branches) });
});

const branchCreateSchema = z.object({
  name: z.string().min(1).max(120),
  parent_id: z.string().optional(),
  parentId: z.string().optional(),
});

// ---- Utworzenie gałęzi ----
projectsRouter.post("/:id/branches", (req, res) => {
  const row = db.prepare("SELECT id FROM projects WHERE id = ?").get(req.params.id) as any;
  if (!row) { res.status(404).json({ error: "Nie znaleziono projektu" }); return; }
  const parsed = branchCreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Podaj nazwę gałęzi" }); return; }
  const parentId = parsed.data.parent_id ?? parsed.data.parentId;
  if (parentId) {
    const parent = db.prepare("SELECT id FROM branches WHERE id = ? AND project_id = ?").get(parentId, req.params.id);
    if (!parent) { res.status(400).json({ error: "Gałąź nadrzędna nie należy do tego projektu" }); return; }
  }
  const id = newId();
  db.prepare(
    "INSERT INTO branches (id, project_id, parent_id, name, created_by, created_at) VALUES (?,?,?,?,?,?)"
  ).run(id, req.params.id, parentId ?? null, parsed.data.name, req.user!.id, nowISO());
  const created = db.prepare("SELECT * FROM branches WHERE id = ?").get(id) as any;
  res.status(201).json({ branch: serializeBranch(created) });
});

// ---- Zmiana nazwy gałęzi ----
const branchPatchSchema = z.object({ name: z.string().min(1).max(120) });
branchesRouter.patch("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM branches WHERE id = ?").get(req.params.id) as any;
  if (!row) { res.status(404).json({ error: "Nie znaleziono gałęzi" }); return; }
  const parsed = branchPatchSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Podaj nazwę gałęzi" }); return; }
  db.prepare("UPDATE branches SET name = ? WHERE id = ?").run(parsed.data.name, req.params.id);
  const updated = db.prepare("SELECT * FROM branches WHERE id = ?").get(req.params.id) as any;
  res.json({ branch: serializeBranch(updated) });
});

// ---- Usunięcie gałęzi (dzieci kaskadowo; zadania gałęzi zostają bez gałęzi) ----
branchesRouter.delete("/:id", (req, res) => {
  const row = db.prepare("SELECT id FROM branches WHERE id = ?").get(req.params.id) as any;
  if (!row) { res.status(404).json({ error: "Nie znaleziono gałęzi" }); return; }
  db.prepare("DELETE FROM branches WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ===== Pomocnicze =====
function listBranches(projectId: string) {
  const rows = db.prepare(
    `SELECT b.*,
        (SELECT COUNT(*) FROM tasks t WHERE t.branch_id = b.id) AS task_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.branch_id = b.id AND t.status = 'done') AS done_count
     FROM branches b WHERE b.project_id = ? ORDER BY b.created_at ASC`
  ).all(projectId) as any[];
  return rows.map(serializeBranch);
}

function serializeBranch(r: any) {
  return {
    id: r.id,
    projectId: r.project_id,
    parentId: r.parent_id ?? null,
    name: r.name,
    createdBy: r.created_by,
    createdAt: r.created_at,
    taskCount: r.task_count ?? 0,
    doneCount: r.done_count ?? 0,
  };
}

interface BranchNode {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  createdBy: string;
  createdAt: string;
  taskCount: number;
  doneCount: number;
  children: BranchNode[];
}

function buildTree(branches: ReturnType<typeof serializeBranch>[]): BranchNode[] {
  const map = new Map<string, BranchNode>();
  for (const b of branches) map.set(b.id, { ...b, children: [] });
  const roots: BranchNode[] = [];
  for (const b of branches) {
    const node = map.get(b.id)!;
    if (b.parentId && map.has(b.parentId)) map.get(b.parentId)!.children.push(node);
    else roots.push(node);
  }
  return roots;
}
