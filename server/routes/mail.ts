import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { newId, nowISO } from "../util";
import { requireAuth } from "../auth";
import { imapConfigured, syncInbox } from "../mailbox";
import { enqueueEmail, sendEmailNow } from "../mailer";

// ===== V2.2 — Poczta: lista, szczegóły, wysyłka (SMTP), zadania z maila =====
export const mailRouter = Router();
mailRouter.use(requireAuth);

function serialize(r: any) {
  return {
    id: r.id, messageId: r.message_id, folder: r.folder,
    fromName: r.from_name, fromEmail: r.from_email, toText: r.to_text,
    subject: r.subject, bodyText: r.body_text, bodyHtml: r.body_html,
    mailDate: r.mail_date, seen: !!r.seen, syncedAt: r.synced_at,
  };
}

mailRouter.get("/", (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const per = 30;
  const rows = db.prepare(
    "SELECT * FROM emails WHERE folder = 'INBOX' ORDER BY mail_date DESC LIMIT ? OFFSET ?"
  ).all(per, (page - 1) * per) as any[];
  res.json({ items: rows.map(serialize), page, configured: imapConfigured() });
});

mailRouter.get("/unread", (_req, res) => {
  const row = db.prepare("SELECT COUNT(*) AS c FROM emails WHERE seen = 0").get() as { c: number };
  res.json({ unread: row.c });
});

mailRouter.post("/sync", async (_req, res) => {
  if (!imapConfigured()) { res.status(400).json({ error: "IMAP nie jest skonfigurowane (Ustawienia → Poczta)" }); return; }
  try {
    const n = await syncInbox();
    res.json({ ok: true, synced: n });
  } catch (e: any) {
    res.status(502).json({ error: "Błąd synchronizacji: " + (e?.message || "") });
  }
});

mailRouter.get("/:id", (req, res) => {
  const r = db.prepare("SELECT * FROM emails WHERE id = ?").get(req.params.id) as any;
  if (!r) { res.status(404).json({ error: "Nie znaleziono wiadomości" }); return; }
  res.json(serialize(r));
});

mailRouter.post("/:id/seen", (req, res) => {
  const r = db.prepare("SELECT id FROM emails WHERE id = ?").get(req.params.id) as any;
  if (!r) { res.status(404).json({ error: "Nie znaleziono wiadomości" }); return; }
  const seen = req.body?.seen === false ? 0 : 1;
  db.prepare("UPDATE emails SET seen = ? WHERE id = ?").run(seen, r.id);
  res.json({ ok: true, seen: !!seen });
});

const sendSchema = z.object({ to: z.string().min(1).max(500), subject: z.string().min(1).max(300), body: z.string().max(100000).default("") });

mailRouter.post("/send", async (req, res) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Podaj adres i temat" }); return; }
  const { to, subject, body } = parsed.data;
  const html = "<p>" + String(body).replace(/\n/g, "<br/>").replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</p>";
  const ok = await sendEmailNow(to, subject, html, body);
  if (!ok) {
    enqueueEmail(to, subject, html, body);
    res.json({ ok: true, queued: true, message: "Wysłano do kolejki (SMTP nieskonfigurowane? Sprawdź Ustawienia)" });
    return;
  }
  res.json({ ok: true, queued: false });
});

mailRouter.post("/:id/task", (req, res) => {
  const r = db.prepare("SELECT * FROM emails WHERE id = ?").get(req.params.id) as any;
  if (!r) { res.status(404).json({ error: "Nie znaleziono wiadomości" }); return; }
  const project = db.prepare("SELECT id, name FROM projects ORDER BY created_at LIMIT 1").get() as any;
  const taskId = newId();
  const t = nowISO();
  if (project) {
    db.prepare(
      "INSERT INTO tasks (id, project_id, title, description, status, priority, created_by, position, ai_source, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
    ).run(taskId, project.id, "[Poczta] " + (r.subject || "(bez tematu)"),
      "Od: " + (r.fromName || r.fromEmail || "") + "\nData: " + (r.mail_date || "") + "\n\n" + (r.body_text || "").slice(0, 4000),
      "todo", "medium", req.user!.id, 0, JSON.stringify({ type: "mail", mailId: r.id }), t, t);
    res.json({ ok: true, taskId, projectName: project.name });
  } else {
    res.status(400).json({ error: "Utwórz najpierw projekt, aby przypisać zadanie" });
  }
});
