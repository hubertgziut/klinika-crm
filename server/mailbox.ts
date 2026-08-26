import { ImapFlow } from "imapflow";
import { db, getSetting } from "./db";
import { newId, nowISO } from "./util";

// ===== V2.2 — Skrzynka e-mail (IMAP) =====

export function getImapConfig() {
  return {
    host: getSetting("imap_host") || process.env.IMAP_HOST || "",
    port: Number(getSetting("imap_port") || process.env.IMAP_PORT || 993),
    secure: getSetting("imap_secure") === "true" || process.env.IMAP_SECURE === "true" || true,
    user: getSetting("imap_user") || process.env.IMAP_USER || "",
    pass: getSetting("imap_pass") || process.env.IMAP_PASS || "",
  };
}
export function imapConfigured(): boolean {
  const c = getImapConfig();
  return !!(c.host && c.user && c.pass);
}

/** Synchronizacja INBOX: pobiera ostatnie ~100 wiadomości (envelope + treść tekstowa). */
export async function syncInbox(): Promise<number> {
  const cfg = getImapConfig();
  if (!cfg.host || !cfg.user || !cfg.pass) return 0;
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  });
  await client.connect();
  let count = 0;
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mb = client.mailbox;
      const exists = mb ? mb.exists ?? 0 : 0;
      if (exists > 0) {
        const fromSeq = Math.max(1, exists - 99);
        for await (const msg of client.fetch(`${fromSeq}:*`, { envelope: true, uid: true, bodyParts: ["text"] })) {
          const mid = msg.envelope?.messageId || "uid-" + msg.uid;
          const existing = db.prepare("SELECT id FROM emails WHERE message_id = ?").get(mid);
          if (existing) continue;
          let body = "";
          try { body = String((msg.bodyParts as any)?.get?.("text") || "").slice(0, 20000); } catch { /* brak treści */ }
          const f = (msg.envelope?.from?.[0]) || {};
          db.prepare(
            `INSERT INTO emails (id, message_id, folder, from_name, from_email, to_text, subject, body_text, mail_date, created_at, synced_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`
          ).run(
            newId(), mid, "INBOX",
            String(f.name || "").slice(0, 200),
            String(f.address || "").slice(0, 300),
            "",
            String(msg.envelope?.subject || "").slice(0, 500),
            body,
            msg.envelope?.date ? new Date(msg.envelope.date).toISOString() : nowISO(),
            nowISO(), nowISO()
          );
          count++;
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return count;
}

export function startMailboxWorker(intervalMs = 60_000) {
  let running = false;
  setInterval(() => {
    if (running || !imapConfigured()) return;
    running = true;
    syncInbox().then((n) => {
      if (n > 0) console.log(`[poczta] zsynchronizowano ${n} nowych wiadomości`);
    }).catch((e: any) => console.error("[poczta] sync:", e?.message)).finally(() => { running = false; });
  }, intervalMs);
  console.log("[poczta] worker IMAP uruchomiony (co " + intervalMs / 1000 + " s)");
}
