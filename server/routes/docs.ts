import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { db, DATA_DIR } from "../db";
import { newId, nowISO } from "../util";
import { requireAuth } from "../auth";

// ===== Dokumenty (Faza 4): WYSIWYG + załączniki (uploads) =====
export const docsRouter = Router();
docsRouter.use(requireAuth);

export const uploadsRouter = Router();
uploadsRouter.use(requireAuth);

const docCreateSchema = z.object({
  title: z.string().min(1).max(300),
  project_id: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  content: z.string().max(1_000_000).optional().default(""),
});
const docPatchSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  content: z.string().max(1_000_000).optional(),
});

const ALLOWED_EXT = new Set(["pdf", "jpg", "jpeg", "png", "gif", "webp", "docx", "xlsx", "csv", "txt", "md"]);
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).slice(1).toLowerCase();
    cb(null, randomBytes(12).toString("hex") + (ext ? "." + ext : ""));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).slice(1).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      cb(new Error("Niedozwolony typ pliku (dozwolone: pdf, obrazy, docx, xlsx, csv, txt, md)"));
      return;
    }
    cb(null, true);
  },
});

// Wrapper zamieniający błędy multer (rozmiar, filtr) na czytelną odpowiedź 400
function uploadSingle(field: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    upload.single(field)(req, res, (err: unknown) => {
      if (err) {
        res.status(400).json({ error: (err as Error).message || "Błąd przesyłania pliku" });
        return;
      }
      next();
    });
  };
}

// Multer dekoduje oryginalną nazwę jako latin1 — przywróć polskie znaki
function fixOriginalName(name: string): string {
  try {
    const fixed = Buffer.from(name, "latin1").toString("utf8");
    return fixed.includes("\uFFFD") ? name : fixed;
  } catch {
    return name;
  }
}

const DOC_SELECT = `
  SELECT d.*, u.name AS updated_by_name, p.name AS project_name
  FROM documents d
  LEFT JOIN users u ON u.id = d.updated_by
  LEFT JOIN projects p ON p.id = d.project_id`;

function serializeDoc(r: any) {
  return {
    id: r.id,
    projectId: r.project_id ?? null,
    projectName: r.project_name ?? null,
    title: r.title,
    content: r.content ?? "",
    createdBy: r.created_by,
    updatedBy: r.updated_by ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    updatedByName: r.updated_by_name ?? null,
  };
}

function serializeUpload(r: any) {
  return {
    id: r.id,
    filename: r.filename,
    storedName: r.stored_name,
    mime: r.mime,
    size: r.size,
    createdAt: r.created_at,
  };
}

function docExists(id: string): boolean {
  return !!db.prepare("SELECT id FROM documents WHERE id = ?").get(id);
}

function uploadsOf(docId: string) {
  const rows = db.prepare(
    "SELECT * FROM uploads WHERE document_id = ? ORDER BY created_at DESC"
  ).all(docId) as any[];
  return rows.map(serializeUpload);
}

// ===== 1) Lista dokumentów (opcjonalny filtr projektu) =====
docsRouter.get("/", (req, res) => {
  const projectId = (req.query.project_id ?? req.query.projectId) as string | undefined;
  let rows: any[];
  if (projectId) {
    rows = db.prepare(DOC_SELECT + " WHERE d.project_id = ? ORDER BY d.updated_at DESC").all(projectId) as any[];
  } else {
    rows = db.prepare(DOC_SELECT + " ORDER BY d.updated_at DESC").all() as any[];
  }
  res.json(rows.map(serializeDoc));
});

// ===== 2) Utworzenie dokumentu =====
docsRouter.post("/", (req, res) => {
  const parsed = docCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Podaj tytuł dokumentu", details: parsed.error.flatten() });
    return;
  }
  const projectId = parsed.data.project_id ?? parsed.data.projectId ?? null;
  if (projectId && !db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId)) {
    res.status(404).json({ error: "Nie znaleziono projektu" });
    return;
  }
  const id = newId();
  const t = nowISO();
  db.prepare(
    "INSERT INTO documents (id, project_id, title, content, created_by, updated_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)"
  ).run(id, projectId, parsed.data.title.trim(), parsed.data.content, req.user!.id, req.user!.id, t, t);
  const row = db.prepare(DOC_SELECT + " WHERE d.id = ?").get(id) as any;
  res.status(201).json({ document: serializeDoc(row) });
});

// ===== 3) Szczegóły dokumentu + załączniki =====
docsRouter.get("/:id", (req, res) => {
  const row = db.prepare(DOC_SELECT + " WHERE d.id = ?").get(req.params.id) as any;
  if (!row) { res.status(404).json({ error: "Nie znaleziono dokumentu" }); return; }
  res.json({ document: serializeDoc(row), uploads: uploadsOf(req.params.id) });
});

// ===== 4) Edycja tytułu / treści (updated_by = bieżący użytkownik) =====
docsRouter.patch("/:id", (req, res) => {
  const row = db.prepare("SELECT id FROM documents WHERE id = ?").get(req.params.id) as any;
  if (!row) { res.status(404).json({ error: "Nie znaleziono dokumentu" }); return; }
  const parsed = docPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Nieprawidłowe dane dokumentu", details: parsed.error.flatten() });
    return;
  }
  const sets: string[] = [];
  const params: any[] = [];
  if (parsed.data.title !== undefined) { sets.push("title = ?"); params.push(parsed.data.title.trim()); }
  if (parsed.data.content !== undefined) { sets.push("content = ?"); params.push(parsed.data.content); }
  if (sets.length > 0) {
    sets.push("updated_by = ?");
    params.push(req.user!.id);
    sets.push("updated_at = ?");
    params.push(nowISO(), req.params.id);
    db.prepare("UPDATE documents SET " + sets.join(", ") + " WHERE id = ?").run(...params);
  }
  const updated = db.prepare(DOC_SELECT + " WHERE d.id = ?").get(req.params.id) as any;
  res.json({ document: serializeDoc(updated) });
});

// ===== 5) Usunięcie dokumentu (kaskada na uploads) =====
docsRouter.delete("/:id", (req, res) => {
  const row = db.prepare("SELECT id FROM documents WHERE id = ?").get(req.params.id) as any;
  if (!row) { res.status(404).json({ error: "Nie znaleziono dokumentu" }); return; }
  // usuń fizyczne pliki załączników przed kaskadą rekordów
  const ups = db.prepare("SELECT stored_name FROM uploads WHERE document_id = ?").all(req.params.id) as any[];
  for (const u of ups) {
    fs.unlink(path.join(UPLOADS_DIR, u.stored_name), () => {});
  }
  db.prepare("DELETE FROM documents WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ===== 6) Upload załącznika (multipart, limit 20 MB) =====
docsRouter.post("/:id/upload", uploadSingle("file"), (req, res) => {
  if (!docExists(req.params.id)) { res.status(404).json({ error: "Nie znaleziono dokumentu" }); return; }
  const file = req.file as Express.Multer.File | undefined;
  if (!file) { res.status(400).json({ error: "Brak pliku" }); return; }
  const id = newId();
  const filename = fixOriginalName(file.originalname);
  db.prepare(
    "INSERT INTO uploads (id, user_id, document_id, filename, stored_name, mime, size, created_at) VALUES (?,?,?,?,?,?,?,?)"
  ).run(id, req.user!.id, req.params.id, filename, file.filename, file.mimetype || "application/octet-stream", file.size, nowISO());
  const row = db.prepare("SELECT * FROM uploads WHERE id = ?").get(id) as any;
  res.status(201).json({ upload: serializeUpload(row) });
});

// ===== 7) Usunięcie załącznika (rekord + plik) =====
uploadsRouter.delete("/:id", (req, res) => {
  const up = db.prepare("SELECT * FROM uploads WHERE id = ?").get(req.params.id) as any;
  if (!up) { res.status(404).json({ error: "Nie znaleziono pliku" }); return; }
  db.prepare("DELETE FROM uploads WHERE id = ?").run(up.id);
  fs.unlink(path.join(UPLOADS_DIR, up.stored_name), () => {});
  res.json({ ok: true });
});
