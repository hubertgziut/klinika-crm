import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { newId, nowISO, safeParse } from "../util";
import { requireAuth } from "../auth";

// ===== Tabele (Faza 4): arkusze z wierszami, kolumnami i komórkami =====
export const tablesRouter = Router();
tablesRouter.use(requireAuth);

const COLUMN_TYPES = ["text", "number", "date"] as const;
type ColumnType = (typeof COLUMN_TYPES)[number];

interface ColumnDef {
  key: string;
  label: string;
  type: ColumnType;
}

const tableCreateSchema = z.object({
  name: z.string().min(1).max(120),
  project_id: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
});
const columnItemSchema = z.object({
  key: z.string().min(1).max(80).optional(),
  label: z.string().min(1).max(80),
  type: z.enum(COLUMN_TYPES),
});
const tablePatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  columns: z.array(columnItemSchema).max(50).optional(),
});
const rowCreateSchema = z.object({
  cells: z.record(z.string(), z.string()).optional(),
});
const rowPatchSchema = z.object({
  cells: z.record(z.string(), z.string()).optional(),
  position: z.number().int().min(0).optional(),
});
const addColumnSchema = z.object({
  label: z.string().min(1).max(80),
  type: z.enum(COLUMN_TYPES).optional().default("text"),
});

// ===== Pomocnicze =====
function getTableRaw(id: string): any {
  return db.prepare("SELECT * FROM tables WHERE id = ?").get(id) as any;
}

function getColumns(t: any): ColumnDef[] {
  return safeParse<ColumnDef[]>(t.columns_json, []);
}

function nextColumnKey(cols: ColumnDef[]): string {
  let max = 0;
  for (const c of cols) {
    const m = /^col_(\d+)$/.exec(c.key);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return "col_" + (max + 1);
}

function touchTable(tableId: string) {
  db.prepare("UPDATE tables SET updated_at = ? WHERE id = ?").run(nowISO(), tableId);
}

function projectExists(id: string): boolean {
  return !!db.prepare("SELECT id FROM projects WHERE id = ?").get(id);
}

function tableExists(id: string): boolean {
  return !!db.prepare("SELECT id FROM tables WHERE id = ?").get(id);
}

function rowOf(tableId: string, rowId: string): any {
  return db.prepare("SELECT * FROM table_rows WHERE id = ? AND table_id = ?").get(rowId, tableId) as any;
}

function cellsOfRow(rowId: string): Record<string, string> {
  const rows = db.prepare("SELECT column_id, value FROM table_cells WHERE row_id = ?").all(rowId) as any[];
  const cells: Record<string, string> = {};
  for (const c of rows) cells[c.column_id] = c.value ?? "";
  return cells;
}

function rowView(r: any) {
  return { id: r.id, position: r.position ?? 0, cells: cellsOfRow(r.id) };
}

function fullView(t: any) {
  const cols = getColumns(t);
  const rowRows = db.prepare(
    "SELECT * FROM table_rows WHERE table_id = ? ORDER BY position ASC, created_at ASC"
  ).all(t.id) as any[];
  return {
    id: t.id,
    name: t.name,
    projectId: t.project_id ?? null,
    columns: cols,
    rows: rowRows.map(rowView),
  };
}

// Upsert komórek (tylko dla kolumn istniejących w tabeli)
function setCells(table: any, rowId: string, cells: Record<string, string>) {
  const valid = new Set(getColumns(table).map((c) => c.key));
  for (const [key, value] of Object.entries(cells)) {
    if (!valid.has(key)) continue;
    db.prepare(
      "INSERT INTO table_cells (row_id, column_id, value, updated_at) VALUES (?,?,?,?) " +
      "ON CONFLICT(row_id, column_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    ).run(rowId, key, value, nowISO());
  }
}

// Puste komórki nowej kolumny dla istniejących wierszy
function addEmptyCells(tableId: string, columnKey: string) {
  db.prepare(
    "INSERT OR IGNORE INTO table_cells (row_id, column_id, value, updated_at) " +
    "SELECT r.id, ?, NULL, ? FROM table_rows r WHERE r.table_id = ?"
  ).run(columnKey, nowISO(), tableId);
}

// Zastosowanie nowej listy kolumn: dodawanie / usuwanie / zmiana etykiety i typu
function applyColumns(tableId: string, current: ColumnDef[], incoming: { key?: string; label: string; type: ColumnType }[]): ColumnDef[] {
  const byKey = new Map(current.map((c) => [c.key, c]));
  const usedKeys = new Set(current.map((c) => c.key));
  const result: ColumnDef[] = [];
  for (const item of incoming) {
    if (item.key && byKey.has(item.key)) {
      result.push({ key: item.key, label: item.label, type: item.type });
    } else {
      // nowa kolumna — nadaj klucz i utwórz puste komórki
      const key = item.key && !usedKeys.has(item.key) ? item.key : nextColumnKey([...current, ...result]);
      usedKeys.add(key);
      result.push({ key, label: item.label, type: item.type });
      addEmptyCells(tableId, key);
    }
  }
  // usunięte kolumny — usuń ich komórki (tylko dla wierszy tej tabeli)
  const keep = new Set(result.map((c) => c.key));
  for (const c of current) {
    if (!keep.has(c.key)) {
      db.prepare(
        "DELETE FROM table_cells WHERE column_id = ? AND row_id IN (SELECT id FROM table_rows WHERE table_id = ?)"
      ).run(c.key, tableId);
    }
  }
  return result;
}

// Przesunięcie wiersza na pozycję (0..n) i wyrównanie pozostałych
function reorderRows(tableId: string, rowId: string, position: number) {
  const rows = db.prepare(
    "SELECT id, position FROM table_rows WHERE table_id = ? ORDER BY position ASC, created_at ASC"
  ).all(tableId) as { id: string; position: number }[];
  const current = new Map(rows.map((r) => [r.id, r.position]));
  const list = rows.filter((r) => r.id !== rowId).map((r) => r.id);
  const index = Math.max(0, Math.min(Math.floor(position), list.length));
  list.splice(index, 0, rowId);
  list.forEach((id, i) => {
    if (current.get(id) !== i) db.prepare("UPDATE table_rows SET position = ? WHERE id = ?").run(i, id);
  });
}

function serializeSummary(r: any) {
  return {
    id: r.id,
    name: r.name,
    projectId: r.project_id ?? null,
    rowCount: r.row_count ?? 0,
    colCount: getColumns(r).length,
    updatedAt: r.updated_at,
  };
}

// ===== 1) Lista tabel (opcjonalny filtr projektu) =====
tablesRouter.get("/", (req, res) => {
  const projectId = (req.query.project_id ?? req.query.projectId) as string | undefined;
  let rows: any[];
  if (projectId) {
    rows = db.prepare(
      "SELECT t.*, (SELECT COUNT(*) FROM table_rows r WHERE r.table_id = t.id) AS row_count " +
      "FROM tables t WHERE t.project_id = ? ORDER BY t.updated_at DESC"
    ).all(projectId) as any[];
  } else {
    rows = db.prepare(
      "SELECT t.*, (SELECT COUNT(*) FROM table_rows r WHERE r.table_id = t.id) AS row_count " +
      "FROM tables t ORDER BY t.updated_at DESC"
    ).all() as any[];
  }
  res.json(rows.map(serializeSummary));
});

// ===== 2) Utworzenie tabeli (domyślna kolumna A) =====
tablesRouter.post("/", (req, res) => {
  const parsed = tableCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Podaj nazwę tabeli", details: parsed.error.flatten() });
    return;
  }
  const projectId = parsed.data.project_id ?? parsed.data.projectId ?? null;
  if (projectId && !projectExists(projectId)) {
    res.status(404).json({ error: "Nie znaleziono projektu" });
    return;
  }
  const id = newId();
  const t = nowISO();
  const columns: ColumnDef[] = [{ key: "col_1", label: "A", type: "text" }];
  db.prepare(
    "INSERT INTO tables (id, project_id, name, columns_json, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?)"
  ).run(id, projectId, parsed.data.name.trim(), JSON.stringify(columns), req.user!.id, t, t);
  res.status(201).json({ table: fullView(getTableRaw(id)) });
});

// ===== 3) Pełny widok tabeli (kolumny + wiersze + komórki) =====
tablesRouter.get("/:id", (req, res) => {
  const t = getTableRaw(req.params.id);
  if (!t) { res.status(404).json({ error: "Nie znaleziono tabeli" }); return; }
  res.json({ table: fullView(t) });
});

// ===== 4) Edycja nazwy i/lub kolumn =====
tablesRouter.patch("/:id", (req, res) => {
  const t = getTableRaw(req.params.id);
  if (!t) { res.status(404).json({ error: "Nie znaleziono tabeli" }); return; }
  const parsed = tablePatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Nieprawidłowe dane tabeli", details: parsed.error.flatten() });
    return;
  }
  db.exec("BEGIN");
  try {
    let columns = getColumns(t);
    if (parsed.data.columns) {
      columns = applyColumns(t.id, columns, parsed.data.columns);
    }
    const sets: string[] = [];
    const params: any[] = [];
    if (parsed.data.name !== undefined) { sets.push("name = ?"); params.push(parsed.data.name.trim()); }
    sets.push("columns_json = ?");
    params.push(JSON.stringify(columns));
    sets.push("updated_at = ?");
    params.push(nowISO(), t.id);
    db.prepare("UPDATE tables SET " + sets.join(", ") + " WHERE id = ?").run(...params);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  res.json({ table: fullView(getTableRaw(t.id)) });
});

// ===== 5) Usunięcie tabeli (kaskada na wiersze i komórki) =====
tablesRouter.delete("/:id", (req, res) => {
  const t = getTableRaw(req.params.id);
  if (!t) { res.status(404).json({ error: "Nie znaleziono tabeli" }); return; }
  db.prepare("DELETE FROM tables WHERE id = ?").run(t.id);
  res.json({ ok: true });
});

// ===== 6) Dodanie kolumny =====
tablesRouter.post("/:id/columns", (req, res) => {
  const t = getTableRaw(req.params.id);
  if (!t) { res.status(404).json({ error: "Nie znaleziono tabeli" }); return; }
  const parsed = addColumnSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Podaj etykietę kolumny" }); return; }
  const cols = getColumns(t);
  const key = nextColumnKey(cols);
  cols.push({ key, label: parsed.data.label, type: parsed.data.type });
  db.exec("BEGIN");
  try {
    addEmptyCells(t.id, key);
    db.prepare("UPDATE tables SET columns_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(cols), nowISO(), t.id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  res.status(201).json({ table: fullView(getTableRaw(t.id)) });
});

// ===== 7) Dodanie wiersza (position = max + 1) =====
tablesRouter.post("/:id/rows", (req, res) => {
  if (!tableExists(req.params.id)) { res.status(404).json({ error: "Nie znaleziono tabeli" }); return; }
  const parsed = rowCreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Nieprawidłowe dane wiersza" }); return; }
  const max = db.prepare(
    "SELECT COALESCE(MAX(position), -1) AS m FROM table_rows WHERE table_id = ?"
  ).get(req.params.id) as { m: number };
  const id = newId();
  db.prepare("INSERT INTO table_rows (id, table_id, position, created_by, created_at) VALUES (?,?,?,?,?)")
    .run(id, req.params.id, max.m + 1, req.user!.id, nowISO());
  const t = getTableRaw(req.params.id);
  if (parsed.data.cells) setCells(t, id, parsed.data.cells);
  touchTable(req.params.id);
  res.status(201).json({ row: rowView(db.prepare("SELECT * FROM table_rows WHERE id = ?").get(id) as any) });
});

// ===== 8) Edycja komórek wiersza / przesunięcie =====
tablesRouter.patch("/:id/rows/:rid", (req, res) => {
  const t = getTableRaw(req.params.id);
  if (!t) { res.status(404).json({ error: "Nie znaleziono tabeli" }); return; }
  const row = rowOf(req.params.id, req.params.rid);
  if (!row) { res.status(404).json({ error: "Nie znaleziono wiersza" }); return; }
  const parsed = rowPatchSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Nieprawidłowe dane wiersza" }); return; }
  db.exec("BEGIN");
  try {
    if (parsed.data.cells) setCells(t, row.id, parsed.data.cells);
    if (parsed.data.position !== undefined) reorderRows(t.id, row.id, parsed.data.position);
    touchTable(t.id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  res.json({ row: rowView(db.prepare("SELECT * FROM table_rows WHERE id = ?").get(row.id) as any) });
});

// ===== 9) Usunięcie wiersza =====
tablesRouter.delete("/:id/rows/:rid", (req, res) => {
  const t = getTableRaw(req.params.id);
  if (!t) { res.status(404).json({ error: "Nie znaleziono tabeli" }); return; }
  const row = rowOf(req.params.id, req.params.rid);
  if (!row) { res.status(404).json({ error: "Nie znaleziono wiersza" }); return; }
  db.prepare("DELETE FROM table_rows WHERE id = ?").run(row.id);
  touchTable(t.id);
  res.json({ ok: true });
});
