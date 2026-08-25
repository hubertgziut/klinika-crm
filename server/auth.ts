import type { NextFunction, Request, Response } from "express";
import { db } from "./db";
import { newId, nowISO, sha256 } from "./util";

export const SESSION_COOKIE = "kc_sid";
const SESSION_DAYS = 30;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "manager" | "member";
  avatarColor: string;
}

export function createSession(userId: string): { token: string; expiresAt: string } {
  const token = newId() + newId();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400e3).toISOString();
  db.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at) VALUES (?,?,?,?,?,?)"
  ).run(newId(), userId, sha256(token), nowISO(), expiresAt, nowISO());
  return { token, expiresAt };
}

export function destroySession(token: string) {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

export function getUserBySessionToken(token: string | undefined): SessionUser | null {
  if (!token) return null;
  const row = db.prepare(
    `SELECT s.token_hash AS th, u.id, u.email, u.name, u.role, u.avatar_color, u.active, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`
  ).get(sha256(token)) as any;
  if (!row || !row.active || row.expires_at < nowISO()) {
    if (row && !row.active) destroySession(token);
    return null;
  }
  return { id: row.id, email: row.email, name: row.name, role: row.role, avatarColor: row.avatar_color };
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
  const user = getUserBySessionToken(token);
  if (!user) {
    res.status(401).json({ error: "Nie zalogowano" });
    return;
  }
  req.user = user;
  req.token = token;
  next();
}

export function requireRole(...roles: SessionUser["role"][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) { res.status(401).json({ error: "Nie zalogowano" }); return; }
    if (!roles.includes(req.user.role)) { res.status(403).json({ error: "Brak uprawnień" }); return; }
    next();
  };
}

// Rate limiting logowania (w pamięci — wystarczające dla LAN)
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
export function isLoginAllowed(key: string): boolean {
  const now = Date.now();
  const e = loginAttempts.get(key);
  if (!e || e.resetAt < now) {
    loginAttempts.set(key, { count: 1, resetAt: now + 15 * 60e3 });
    return true;
  }
  if (e.count >= 10) return false;
  e.count += 1;
  return true;
}
export function resetLoginLimit(key: string) { loginAttempts.delete(key); }
