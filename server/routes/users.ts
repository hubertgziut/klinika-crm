import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { randomBytes } from "node:crypto";
import { hashPassword, newId, nowISO } from "../util";
import { requireAuth, requireRole } from "../auth";
import { notifyWelcome } from "../mailer";

export const usersRouter = Router();
usersRouter.use(requireAuth);

function serialize(r: any) {
  return {
    id: r.id, email: r.email, name: r.name, role: r.role,
    avatarColor: r.avatar_color, active: !!r.active, createdAt: r.created_at,
  };
}

usersRouter.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM users ORDER BY name").all() as any[];
  res.json(rows.map(serialize));
});

const createSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(80),
  role: z.enum(["admin", "manager", "member"]).default("member"),
  password: z.string().min(6).optional(),
});

usersRouter.post("/", requireRole("admin"), (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Nieprawidłowe dane", details: parsed.error.flatten() }); return; }
  const { email, name, role, password } = parsed.data;
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase());
  if (existing) { res.status(409).json({ error: "Konto z tym e-mailem już istnieje" }); return; }
  const pass = password || randomPassword();
  const id = newId();
  db.prepare(
    "INSERT INTO users (id, email, password_hash, name, role, avatar_color, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)"
  ).run(id, email.toLowerCase(), hashPassword(pass), name, role, randomColor(), nowISO(), nowISO());
  // Nowy członek automatycznie dołącza do kanału „ogólny”
  const general = db.prepare("SELECT id FROM channels WHERE name = 'ogólny' AND kind = 'channel'").get() as { id: string } | undefined;
  if (general) {
    db.prepare("INSERT OR IGNORE INTO channel_members (channel_id, user_id, joined_at) VALUES (?,?,?)")
      .run(general.id, id, nowISO());
  }
  const created = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as any;
  // E-mail: powitanie z hasłem tymczasowym (tylko gdy serwer wygenerował hasło)
  if (!password) notifyWelcome(created, pass);
  res.status(201).json({
    user: serialize(created),
    ...(password ? {} : { tempPassword: pass }),
  });
});

usersRouter.patch("/:id", requireRole("admin"), (req, res) => {
  const body = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id) as any;
  if (!user) { res.status(404).json({ error: "Nie znaleziono" }); return; }
  const name = typeof body.name === "string" && body.name ? body.name : user.name;
  const role = ["admin", "manager", "member"].includes(body.role) ? body.role : user.role;
  const active = typeof body.active === "boolean" ? (body.active ? 1 : 0) : user.active;
  if (body.active === false && user.id === req.user!.id) {
    res.status(400).json({ error: "Nie możesz dezaktywować własnego konta" });
    return;
  }
  if (user.role === "admin" && body.active === false) {
    const admins = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1").get() as { c: number };
    if (admins.c <= 1) { res.status(400).json({ error: "Nie można dezaktywować ostatniego administratora" }); return; }
  }
  db.prepare("UPDATE users SET name=?, role=?, active=?, updated_at=? WHERE id=?").run(name, role, active, nowISO(), user.id);
  res.json({ ok: true });
});

usersRouter.delete("/:id", requireRole("admin"), (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id) as any;
  if (!user) { res.status(404).json({ error: "Nie znaleziono" }); return; }
  if (user.id === req.user!.id) { res.status(400).json({ error: "Nie możesz usunąć własnego konta" }); return; }
  if (user.role === "admin") {
    const admins = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1").get() as { c: number };
    if (admins.c <= 1) { res.status(400).json({ error: "Nie można usunąć ostatniego administratora" }); return; }
  }
  db.prepare("UPDATE users SET active = 0 WHERE id = ?").run(user.id);
  res.json({ ok: true });
});

usersRouter.post("/:id/reset-password", requireRole("admin"), (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id) as any;
  if (!user) { res.status(404).json({ error: "Nie znaleziono" }); return; }
  const pass = randomPassword();
  db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(hashPassword(pass), nowISO(), user.id);
  res.json({ ok: true, tempPassword: pass });
});

function randomPassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#";
  const bytes = randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i++) out += chars[bytes[i] % chars.length];
  return out;
}
const COLORS = ["#ff6b5e", "#f59e0b", "#10b981", "#0ea5e9", "#6366f1", "#ec4899", "#14b8a6", "#8b5cf6"];
function randomColor(): string {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}