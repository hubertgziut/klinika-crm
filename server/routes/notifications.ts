import { Router } from "express";
import { db } from "../db";
import { nowISO } from "../util";
import { requireAuth } from "../auth";

// ===== Faza 5 — Powiadomienia w aplikacji (wykorzystywane też w Fazie 7) =====
export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get("/", (req, res) => {
  const rows = db.prepare(
    "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100"
  ).all(req.user!.id) as any[];
  const unreadRow = db.prepare(
    "SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL"
  ).get(req.user!.id) as { c: number };
  res.json({
    items: rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      body: r.body ?? "",
      link: r.link ?? "",
      readAt: r.read_at ?? null,
      createdAt: r.created_at,
    })),
    unread: unreadRow.c,
  });
});

notificationsRouter.post("/read", (req, res) => {
  const id = (req.body as any)?.id;
  if (typeof id === "string") {
    db.prepare("UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?").run(nowISO(), id, req.user!.id);
  }
  res.json({ ok: true });
});

notificationsRouter.post("/read-all", (req, res) => {
  db.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL").run(nowISO(), req.user!.id);
  res.json({ ok: true });
});
