import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { newId, nowISO } from "../util";
import { requireAuth } from "../auth";
import { emitToUser } from "../ws";

// ===== Komunikator (Faza 3): kanały, DM, wiadomości, nieprzeczytane =====
export const chatRouter = Router();
chatRouter.use(requireAuth);

const createChannelSchema = z.object({
  name: z.string().min(1).max(120),
  topic: z.string().max(500).optional().default(""),
});
const dmSchema = z.object({ userId: z.string().min(1) });
const messageSchema = z.object({ body: z.string().trim().min(1).max(10000) });
const patchChannelSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  topic: z.string().max(500).optional(),
});

// ===== Pomocnicze =====
function isMember(channelId: string, userId: string): boolean {
  return !!db.prepare("SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ?").get(channelId, userId);
}

function channelExists(channelId: string): boolean {
  return !!db.prepare("SELECT id FROM channels WHERE id = ?").get(channelId);
}

function channelMembers(channelId: string) {
  const rows = db.prepare(
    `SELECT u.id, u.name, u.avatar_color FROM channel_members cm
     JOIN users u ON u.id = cm.user_id WHERE cm.channel_id = ? ORDER BY u.name`
  ).all(channelId) as any[];
  return rows.map((r) => ({ id: r.id, name: r.name, avatarColor: r.avatar_color }));
}

function lastMessageOf(channelId: string) {
  const row = db.prepare(
    `SELECT m.body, m.created_at, u.id AS author_id, u.name AS author_name
     FROM messages m JOIN users u ON u.id = m.user_id
     WHERE m.channel_id = ? ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1`
  ).get(channelId) as any;
  if (!row) return null;
  return { body: row.body, createdAt: row.created_at, author: { id: row.author_id, name: row.author_name } };
}

function unreadOf(channelId: string, userId: string): number {
  if (!isMember(channelId, userId)) return 0;
  const row = db.prepare(
    `SELECT COUNT(*) AS c FROM messages m
     WHERE m.channel_id = ? AND m.user_id != ?
       AND NOT EXISTS (SELECT 1 FROM message_reads mr WHERE mr.message_id = m.id AND mr.user_id = ?)`
  ).get(channelId, userId, userId) as { c: number };
  return row.c;
}

// Globalna liczba nieprzeczytanych (wszystkie kanały użytkownika)
function globalUnread(userId: string): number {
  const row = db.prepare(
    `SELECT COUNT(*) AS c FROM messages m
     JOIN channel_members cm ON cm.channel_id = m.channel_id AND cm.user_id = ?
     WHERE m.user_id != ?
       AND NOT EXISTS (SELECT 1 FROM message_reads mr WHERE mr.message_id = m.id AND mr.user_id = ?)`
  ).get(userId, userId, userId) as { c: number };
  return row.c;
}

function serializeChannel(c: any, meId: string) {
  const members = channelMembers(c.id);
  let name = c.name;
  let listMembers = members;
  if (c.kind === "dm") {
    const other = members.find((m) => m.id !== meId) ?? members[0] ?? null;
    name = other?.name ?? "Czat prywatny";
    listMembers = other ? [other] : members;
  }
  return {
    id: c.id,
    name,
    topic: c.topic ?? "",
    kind: c.kind,
    createdAt: c.created_at,
    lastMessage: lastMessageOf(c.id),
    unread: unreadOf(c.id, meId),
    members: listMembers,
  };
}

function serializeMessage(r: any) {
  return {
    id: r.id,
    channelId: r.channel_id,
    userId: r.user_id,
    body: r.body,
    createdAt: r.created_at,
    author: { id: r.user_id, name: r.author_name, avatarColor: r.author_avatar_color },
  };
}

function getMessageRow(id: string): any {
  return db.prepare(
    `SELECT m.*, u.name AS author_name, u.avatar_color AS author_avatar_color
     FROM messages m JOIN users u ON u.id = m.user_id WHERE m.id = ?`
  ).get(id);
}

// ===== 1) Lista kanałów: wszystkie publiczne + DM użytkownika (z flagą isMember) =====
chatRouter.get("/", (req, res) => {
  const me = req.user!.id;
  const rows = db.prepare(
    `SELECT c.* FROM channels c
     WHERE c.kind = 'channel'
        OR (c.kind = 'dm' AND EXISTS (
            SELECT 1 FROM channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = ?))`
  ).all(me) as any[];
  const channels = rows.map((c) => ({ ...serializeChannel(c, me), isMember: isMember(c.id, me) }));
  channels.sort((a, b) => {
    const ta = a.lastMessage?.createdAt ?? a.createdAt;
    const tb = b.lastMessage?.createdAt ?? b.createdAt;
    return tb.localeCompare(ta);
  });
  res.json(channels);
});

// ===== 1a) Dołączenie do kanału (członek dodaje sam siebie) =====
chatRouter.post("/:id/join", (req, res) => {
  const channelId = req.params.id;
  if (!channelExists(channelId)) { res.status(404).json({ error: "Nie znaleziono kanału" }); return; }
  const ch = db.prepare("SELECT * FROM channels WHERE id = ?").get(channelId) as any;
  if (ch.kind === "dm") { res.status(400).json({ error: "Do czatu prywatnego nie można dołączyć — utwórz nowy czat" }); return; }
  if (!isMember(channelId, req.user!.id)) {
    db.prepare("INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES (?,?,?)")
      .run(channelId, req.user!.id, nowISO());
  }
  const row = db.prepare("SELECT * FROM channels WHERE id = ?").get(channelId) as any;
  res.status(200).json({ channel: { ...serializeChannel(row, req.user!.id), isMember: true } });
});

// ===== 2) Utworzenie kanału (twórca jako członek) =====
chatRouter.post("/", (req, res) => {
  const parsed = createChannelSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Podaj nazwę kanału" }); return; }
  const id = newId();
  const t = nowISO();
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO channels (id, name, topic, kind, created_by, created_at) VALUES (?,?,?,?,?,?)")
      .run(id, parsed.data.name.trim(), parsed.data.topic, "channel", req.user!.id, t);
    db.prepare("INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES (?,?,?)")
      .run(id, req.user!.id, t);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  const row = db.prepare("SELECT * FROM channels WHERE id = ?").get(id) as any;
  res.status(201).json({ channel: serializeChannel(row, req.user!.id) });
});

// ===== 3) DM: znajdź istniejący lub utwórz (dwóch członków) =====
chatRouter.post("/dm", (req, res) => {
  const parsed = dmSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Podaj użytkownika" }); return; }
  const me = req.user!.id;
  const otherId = parsed.data.userId;
  if (otherId === me) { res.status(400).json({ error: "Nie można utworzyć czatu z samym sobą" }); return; }
  const other = db.prepare("SELECT id FROM users WHERE id = ? AND active = 1").get(otherId);
  if (!other) { res.status(404).json({ error: "Nie znaleziono użytkownika" }); return; }

  // istniejący DM z dokładnie tymi dwoma członkami
  const candidates = db.prepare(
    `SELECT c.id FROM channels c
     JOIN channel_members cm ON cm.channel_id = c.id AND c.kind = 'dm'
     WHERE cm.user_id IN (?, ?)
     GROUP BY c.id HAVING COUNT(*) = 2`
  ).all(me, otherId) as { id: string }[];
  const want = [me, otherId].sort().join("|");
  let id = candidates.find((r) => channelMembers(r.id).map((m) => m.id).sort().join("|") === want)?.id ?? null;

  if (!id) {
    id = newId();
    const t = nowISO();
    db.exec("BEGIN");
    try {
      db.prepare("INSERT INTO channels (id, name, topic, kind, created_by, created_at) VALUES (?,?,?,?,?,?)")
        .run(id, "dm", "", "dm", me, t);
      db.prepare("INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES (?,?,?)").run(id, me, t);
      db.prepare("INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES (?,?,?)").run(id, otherId, t);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  const row = db.prepare("SELECT * FROM channels WHERE id = ?").get(id) as any;
  res.status(201).json({ channel: serializeChannel(row, me) });
});

// ===== 4) Wiadomości kanału (starsze niż before, limit) z autorem + channelId =====
chatRouter.get("/:id/messages", (req, res) => {
  const channelId = req.params.id;
  if (!channelExists(channelId)) { res.status(404).json({ error: "Nie znaleziono kanału" }); return; }
  if (!isMember(channelId, req.user!.id)) { res.status(403).json({ error: "Nie jesteś członkiem kanału" }); return; }
  const before = typeof req.query.before === "string" && req.query.before ? req.query.before : nowISO();
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "30"), 10) || 30, 1), 100);
  const rows = db.prepare(
    `SELECT m.*, u.name AS author_name, u.avatar_color AS author_avatar_color
     FROM messages m JOIN users u ON u.id = m.user_id
     WHERE m.channel_id = ? AND m.created_at < ?
     ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?`
  ).all(channelId, before, limit) as any[];
  res.json(rows.reverse().map(serializeMessage));
});

// ===== 5) Wysłanie wiadomości + socket chat:message do wszystkich członków =====
chatRouter.post("/:id/messages", (req, res) => {
  const channelId = req.params.id;
  if (!channelExists(channelId)) { res.status(404).json({ error: "Nie znaleziono kanału" }); return; }
  if (!isMember(channelId, req.user!.id)) { res.status(403).json({ error: "Nie jesteś członkiem kanału" }); return; }
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Wiadomość nie może być pusta" }); return; }
  const id = newId();
  const t = nowISO();
  db.prepare("INSERT INTO messages (id, channel_id, user_id, body, created_at) VALUES (?,?,?,?,?)")
    .run(id, channelId, req.user!.id, parsed.data.body, t);
  // nadawca od razu ma przeczytaną
  db.prepare("INSERT OR IGNORE INTO message_reads (message_id, user_id, read_at) VALUES (?,?,?)")
    .run(id, req.user!.id, t);
  const message = serializeMessage(getMessageRow(id));
  for (const m of channelMembers(channelId)) {
    emitToUser(m.id, "chat:message", { message, channelId });
  }
  res.status(201).json({ message });
});

// ===== 6) Oznacz jako przeczytane (cały kanał) → globalny unread =====
chatRouter.post("/:id/read", (req, res) => {
  const channelId = req.params.id;
  if (!channelExists(channelId)) { res.status(404).json({ error: "Nie znaleziono kanału" }); return; }
  if (!isMember(channelId, req.user!.id)) { res.status(403).json({ error: "Nie jesteś członkiem kanału" }); return; }
  const me = req.user!.id;
  const t = nowISO();
  db.prepare(
    `INSERT OR IGNORE INTO message_reads (message_id, user_id, read_at)
     SELECT id, ?, ? FROM messages WHERE channel_id = ? AND user_id != ?`
  ).run(me, t, channelId, me);
  res.json({ unread: globalUnread(me) });
});

// ===== 7) Członkowie kanału =====
chatRouter.get("/:id/members", (req, res) => {
  const channelId = req.params.id;
  if (!channelExists(channelId)) { res.status(404).json({ error: "Nie znaleziono kanału" }); return; }
  if (!isMember(channelId, req.user!.id)) { res.status(403).json({ error: "Nie jesteś członkiem kanału" }); return; }
  res.json(channelMembers(channelId));
});

// ===== 8) Zmiana nazwy/tematu (tylko członkowie, nie dla DM) =====
chatRouter.patch("/:id", (req, res) => {
  const channelId = req.params.id;
  if (!channelExists(channelId)) { res.status(404).json({ error: "Nie znaleziono kanału" }); return; }
  if (!isMember(channelId, req.user!.id)) { res.status(403).json({ error: "Nie jesteś członkiem kanału" }); return; }
  const ch = db.prepare("SELECT * FROM channels WHERE id = ?").get(channelId) as any;
  if (ch.kind === "dm") { res.status(400).json({ error: "Czatu prywatnego nie można edytować" }); return; }
  const parsed = patchChannelSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Nieprawidłowe dane kanału" }); return; }
  const sets: string[] = [];
  const params: any[] = [];
  if (parsed.data.name !== undefined) { sets.push("name = ?"); params.push(parsed.data.name.trim()); }
  if (parsed.data.topic !== undefined) { sets.push("topic = ?"); params.push(parsed.data.topic); }
  if (sets.length > 0) {
    params.push(channelId);
    db.prepare(`UPDATE channels SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  }
  const updated = db.prepare("SELECT * FROM channels WHERE id = ?").get(channelId) as any;
  res.json({ channel: serializeChannel(updated, req.user!.id) });
});
