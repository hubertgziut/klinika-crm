import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { newId, nowISO } from "../util";
import { requireAuth } from "../auth";
import { emitToUser } from "../ws";

// ===== V2.1 — Kalendarz: wydarzenia (dyżury, spotkania, wizyty, zadania, zamówienia) =====
export const calendarRouter = Router();
calendarRouter.use(requireAuth);

const EVENT_TYPES = ["dyzur", "spotkanie", "wizyta", "zadanie", "zamowienie", "inne"];
const NOTIFY_MINUTES = [5, 15, 30, 60, 1440];

const eventSchema = z.object({
  title: z.string().min(1).max(200),
  type: z.enum(EVENT_TYPES as [string, ...string[]]).default("inne"),
  startAt: z.string().min(1),
  endAt: z.string().min(1).optional(),
  allDay: z.boolean().optional().default(false),
  location: z.string().max(300).optional().default(""),
  notes: z.string().max(5000).optional().default(""),
  projectId: z.string().max(80).optional().nullable().default(null),
  participantIds: z.array(z.string()).optional().default([]),
  notifyMinutes: z.number().int().min(5).max(1440).optional().default(15),
});

const TYPE_COLOR: Record<string, string> = {
  dyzur: "#0ea5e9", spotkanie: "#8b5cf6", wizyta: "#10b981",
  zadanie: "#f59e0b", zamowienie: "#ff6b5e", inne: "#94a3b8",
};
const TYPE_LABEL: Record<string, string> = {
  dyzur: "Dyżur", spotkanie: "Spotkanie", wizyta: "Wizyta",
  zadanie: "Zadanie", zamowienie: "Zamówienie", inne: "Inne",
};

function serializeEvent(r: any, meId: string) {
  const participants = db.prepare(
    `SELECT cp.event_id, cp.notify_minutes, cp.reminded_at, u.id AS user_id, u.name, u.avatar_color
     FROM calendar_participants cp JOIN users u ON u.id = cp.user_id WHERE cp.event_id = ?`
  ).all(r.id) as any[];
  return {
    id: r.id,
    title: r.title,
    type: r.type,
    typeLabel: TYPE_LABEL[r.type] || r.type,
    color: TYPE_COLOR[r.type] || "#94a3b8",
    startAt: r.start_at,
    endAt: r.end_at,
    allDay: !!r.all_day,
    location: r.location ?? "",
    notes: r.notes ?? "",
    projectId: r.project_id,
    projectName: r.project_name ?? null,
    createdBy: r.created_by,
    isParticipant: participants.some((p) => p.user_id === meId),
    participants: participants.map((p) => ({ id: p.user_id, name: p.name, avatarColor: p.avatar_color, notifyMinutes: p.notify_minutes, remindedAt: p.reminded_at })),
    createdAt: r.created_at,
  };
}

function eventRow(id: string): any {
  return db.prepare(
    `SELECT e.*, p.name AS project_name FROM calendar_events e
     LEFT JOIN projects p ON p.id = e.project_id WHERE e.id = ?`
  ).get(id);
}

calendarRouter.get("/", (req, res) => {
  const from = String(req.query.from || "").slice(0, 40);
  const to = String(req.query.to || "").slice(0, 40);
  let sql = `SELECT e.*, p.name AS project_name FROM calendar_events e
             LEFT JOIN projects p ON p.id = e.project_id WHERE 1=1`;
  const params: string[] = [];
  if (from) { sql += " AND e.start_at >= ?"; params.push(from); }
  if (to) { sql += " AND e.start_at <= ?"; params.push(to); }
  sql += " ORDER BY e.start_at ASC";
  const rows = db.prepare(sql).all(...params) as any[];
  res.json(rows.map((r) => serializeEvent(r, req.user!.id)));
});

/** Nadchodzące wydarzenia (od teraz, do 14 dni) — do powiadomień i listy. */
calendarRouter.get("/upcoming", (req, res) => {
  const now = nowISO();
  const end = new Date(Date.now() + 14 * 86400e3).toISOString();
  const rows = db.prepare(
    `SELECT e.*, p.name AS project_name FROM calendar_events e
     LEFT JOIN projects p ON p.id = e.project_id
     WHERE e.start_at >= ? AND e.start_at <= ?
     ORDER BY e.start_at ASC`
  ).all(now, end) as any[];
  res.json(rows.map((r) => serializeEvent(r, req.user!.id)));
});

calendarRouter.get("/:id", (req, res) => {
  const r = eventRow(req.params.id);
  if (!r) { res.status(404).json({ error: "Nie znaleziono wydarzenia" }); return; }
  res.json(serializeEvent(r, req.user!.id));
});

calendarRouter.post("/", (req, res) => {
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Nieprawidłowe dane wydarzenia", details: parsed.error.flatten() }); return; }
  const d = parsed.data;
  const id = newId();
  const t = nowISO();
  const endAt = d.endAt && d.endAt > d.startAt ? d.endAt : d.startAt;
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO calendar_events (id, title, type, start_at, end_at, all_day, location, notes, project_id, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(id, d.title.trim(), d.type, d.startAt, endAt, d.allDay ? 1 : 0, d.location, d.notes, d.projectId, req.user!.id, t, t);
    const who = d.participantIds.length ? [...new Set([...d.participantIds, req.user!.id])] : [req.user!.id];
    for (const uid of who) {
      db.prepare("INSERT OR IGNORE INTO calendar_participants (event_id, user_id, notify_minutes) VALUES (?,?,?)")
        .run(id, uid, d.notifyMinutes);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  const r = eventRow(id);
  res.status(201).json({ event: serializeEvent(r, req.user!.id) });
});

calendarRouter.patch("/:id", (req, res) => {
  const r = eventRow(req.params.id);
  if (!r) { res.status(404).json({ error: "Nie znaleziono wydarzenia" }); return; }
  const parsed = eventSchema.partial().safeParse(req.body || {});
  if (!parsed.success) { res.status(400).json({ error: "Nieprawidłowe dane" }); return; }
  const d = parsed.data as any;
  const sets: string[] = [];
  const params: any[] = [];
  const map: Record<string, any> = {
    title: "title", type: "type", startAt: "start_at", endAt: "end_at",
    allDay: "all_day", location: "location", notes: "notes", projectId: "project_id",
  };
  for (const [k, col] of Object.entries(map)) {
    if (d[k] !== undefined) { sets.push(col + " = ?"); params.push(d[k] === null ? null : (typeof d[k] === "boolean" ? (d[k] ? 1 : 0) : d[k])); }
  }
  if (sets.length) {
    params.push(nowISO(), r.id);
    db.prepare("UPDATE calendar_events SET " + sets.join(", ") + ", updated_at = ? WHERE id = ?").run(...params);
  }
  if (Array.isArray(d.participantIds)) {
    db.prepare("DELETE FROM calendar_participants WHERE event_id = ?").run(r.id);
    const who = [...new Set([...d.participantIds, req.user!.id])];
    for (const uid of who) {
      db.prepare("INSERT OR IGNORE INTO calendar_participants (event_id, user_id, notify_minutes) VALUES (?,?,?)")
        .run(r.id, uid, d.notifyMinutes ?? 15);
    }
  }
  res.json({ event: serializeEvent(eventRow(r.id), req.user!.id) });
});

calendarRouter.delete("/:id", (req, res) => {
  const r = eventRow(req.params.id);
  if (!r) { res.status(404).json({ error: "Nie znaleziono wydarzenia" }); return; }
  db.prepare("DELETE FROM calendar_events WHERE id = ?").run(r.id);
  res.json({ ok: true });
});

// ===== Worker przypomnień: wydarzenia zaczynające się za notify_minutes → powiadomienie in-app + e-mail =====
export function startCalendarWorker(intervalMs = 60_000) {
  setInterval(() => {
    try { checkReminders(); } catch (e: any) { console.error("[kalendarz] worker:", e.message); }
  }, intervalMs);
  console.log("[kalendarz] worker przypomnień uruchomiony");
}

function checkReminders() {
  const now = Date.now();
  const rows = db.prepare(
    `SELECT cp.event_id, cp.user_id, cp.notify_minutes, cp.reminded_at, e.title, e.start_at
     FROM calendar_participants cp JOIN calendar_events e ON e.id = cp.event_id
     WHERE cp.reminded_at IS NULL`
  ).all() as any[];
  for (const r of rows) {
    const minutes = Number(r.notify_minutes) || 15;
    const start = new Date(r.start_at).getTime();
    const diffMin = (start - now) / 60_000;
    if (diffMin <= minutes && diffMin >= 0) {
      const title = "📅 " + r.title + " za " + Math.max(0, Math.round(diffMin)) + " min";
      db.prepare(
        `INSERT INTO notifications (id, user_id, type, title, body, link, created_at)
         VALUES (?,?,?,?,?,?,?)`
      ).run(newId(), r.user_id, "calendar", title, "Wydarzenie zaczyna się o " + new Date(r.start_at).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" }), "/kalendarz", nowISO());
      db.prepare("UPDATE calendar_participants SET reminded_at = ? WHERE event_id = ? AND user_id = ?").run(nowISO(), r.event_id, r.user_id);
      emitToUser(r.user_id, "notif:new", { title });
      try {
        const user = db.prepare("SELECT email, email_notifications FROM users WHERE id = ?").get(r.user_id) as any;
        if (user?.email_notifications) {
          const { enqueueEmail } = require("./mailer");
          enqueueEmail(user.email, "📅 Przypomnienie: " + r.title,
            "<p>Twoje wydarzenie <b>" + r.title + "</b> zaczyna się za " + Math.max(0, Math.round(diffMin)) + " min (o " +
            new Date(r.start_at).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" }) + ").</p><p>Zajrzyj do kalendarza w Klinika CRM.</p>");
        }
      } catch { /* brak SMTP — tylko powiadomienie w aplikacji */ }
    }
  }
}
