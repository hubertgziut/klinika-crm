import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword, newId, nowISO, safeParse } from "./util";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
export const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "clinic.db");
for (const d of ["", "uploads", "backups", "logs"]) {
  fs.mkdirSync(path.join(DATA_DIR, d), { recursive: true });
}

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA busy_timeout = 5000;");
db.exec(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));

export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}
export function setSetting(key: string, value: string) {
  db.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at"
  ).run(key, value, nowISO());
}
export function getSettingJSON<T>(key: string, fallback: T): T {
  return safeParse(getSetting(key), fallback);
}

export function initDb() {
  const adminEmail = (process.env.ADMIN_EMAIL || "admin@klinika.local").toLowerCase();
  const adminPass = process.env.ADMIN_PASSWORD || "ZmieńMnie123!";
  const count = db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
  if (count.c === 0) {
    db.prepare(
      "INSERT INTO users (id, email, password_hash, name, role, avatar_color, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)"
    ).run(newId(), adminEmail, hashPassword(adminPass), "Administrator", "admin", "#ff6b5e", nowISO(), nowISO());
    console.log(`[db] Utworzono konto administratora: ${adminEmail}`);
  }
  if (!getSetting("clinic_name")) setSetting("clinic_name", "Klinika");
  if (!getSetting("clinic_emoji")) setSetting("clinic_emoji", "🩺");
  const ch = db.prepare("SELECT COUNT(*) AS c FROM channels").get() as { c: number };
  if (ch.c === 0) {
    const admin = db.prepare("SELECT id FROM users ORDER BY created_at LIMIT 1").get() as { id: string };
    const chId = newId();
    db.prepare("INSERT INTO channels (id, name, topic, kind, created_by, created_at) VALUES (?,?,?,?,?,?)")
      .run(chId, "ogólny", "Wiadomości całego zespołu", "channel", admin.id, nowISO());
    db.prepare("INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES (?,?,?)").run(chId, admin.id, nowISO());
  }
}
