import { Router } from "express";
import { z } from "zod";
import { db, getSetting, setSetting } from "../db";
import { requireAuth, requireRole } from "../auth";
import { sendEmailNow, smtpConfigured } from "../mailer";

export const settingsRouter = Router();

const PUBLIC_KEYS = ["clinic_name", "clinic_emoji"];
const ADMIN_KEYS = [
  "clinic_name", "clinic_emoji", "smtp_host", "smtp_port", "smtp_user",
  "smtp_secure", "smtp_from", "smtp_pass", "openai_key", "search_api_key",
  "app_url", "ai_provider", "deepseek_key", "deepseek_model",
  "whisper_model_path", "whisper_bin", "whatsapp_bridge_url",
  "imap_host", "imap_port", "imap_user", "imap_pass", "imap_secure",
];
const SECRET_KEYS = ["smtp_pass", "openai_key", "search_api_key", "deepseek_key", "imap_pass"];
const DEFAULT_WHISPER = "/Users/hubert/Library/Application Support/Hermes Control/Models/Whisper/ggml-large-v3.bin";

settingsRouter.get("/", (_req, res) => {
  const out: Record<string, string> = {};
  for (const k of PUBLIC_KEYS) {
    const v = getSetting(k);
    if (v != null) out[k] = v;
  }
  res.json(out);
});

settingsRouter.get("/admin", requireAuth, requireRole("admin"), (_req, res) => {
  const out: Record<string, string> = {};
  for (const k of ADMIN_KEYS) {
    const v = getSetting(k);
    out[k] = v ?? (k === "smtp_port" ? "587" : k === "imap_port" ? "993" : k === "imap_secure" ? "true" : k === "whisper_model_path" ? DEFAULT_WHISPER : k === "whisper_bin" ? "whisper-cli" : k === "whatsapp_bridge_url" ? "http://127.0.0.1:3001" : "");
  }
  for (const k of SECRET_KEYS) if (out[k]) out[k] = "***";
  res.json(out);
});

settingsRouter.patch("/admin", requireAuth, requireRole("admin"), (req, res) => {
  const body = req.body || {};
  for (const [k, v] of Object.entries(body)) {
    if (typeof v !== "string") continue;
    if (SECRET_KEYS.includes(k) && v === "***") continue; // maska — nie nadpisuj
    if (ADMIN_KEYS.includes(k)) setSetting(k, v);
  }
  res.json({ ok: true });
});

// ===== Faza 7 — e-mail (SMTP): test, kolejka, ponawianie =====

const testEmailSchema = z.object({ to: z.string().email() });

/** Natychmiastowa wysyłka testowa (poza kolejką). */
settingsRouter.post("/test-email", requireAuth, requireRole("admin"), async (req, res) => {
  const parsed = testEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "Podaj prawidłowy adres e-mail" });
    return;
  }
  if (!smtpConfigured()) {
    res.status(400).json({ ok: false, error: "SMTP nie jest skonfigurowane (host i użytkownik)" });
    return;
  }
  const to = parsed.data.to;
  const subject = "Test — Klinika CRM";
  const html = `<!DOCTYPE html><html lang="pl"><body style="margin:0;padding:24px;font-family:Arial,sans-serif;background:#f3f4f6;">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="background:linear-gradient(135deg,#ff6b5e,#ffb03a);padding:18px 24px;color:#fff;font-weight:800;font-size:17px;">Testowa wiadomość e-mail</div>
      <div style="padding:24px;color:#333;font-size:14px;line-height:1.6;">
        <p>To jest <b>testowa wiadomość</b> wysłana z panelu Ustawień Klinika CRM.</p>
        <p>Jeśli ją widzisz, konfiguracja SMTP działa poprawnie. 🎉</p>
      </div>
    </div></body></html>`;
  const text = "To jest testowa wiadomość wysłana z panelu Ustawień Klinika CRM. Jeśli ją widzisz, konfiguracja SMTP działa poprawnie.";
  const ok = await sendEmailNow(to, subject, html, text);
  if (ok) {
    res.json({ ok: true, message: "Wysłano testową wiadomość" });
  } else {
    res.status(500).json({ ok: false, error: "Błąd SMTP — sprawdź konfigurację i logi serwera" });
  }
});

/** Podsumowanie kolejki e-mail: liczniki + ostatnie 10 błędów. */
settingsRouter.get("/email-queue", requireAuth, requireRole("admin"), (_req, res) => {
  const counts = db.prepare(
    "SELECT status, COUNT(*) AS c FROM email_queue GROUP BY status"
  ).all() as { status: string; c: number }[];
  const by = (s: string) => counts.find((r) => r.status === s)?.c ?? 0;
  const failed = db.prepare(
    `SELECT id, recipient, subject, attempts, last_error, created_at
     FROM email_queue WHERE status = 'failed'
     ORDER BY created_at DESC LIMIT 10`
  ).all() as any[];
  res.json({
    pending: by("pending"),
    sent: by("sent"),
    failed: by("failed"),
    lastErrors: failed.map((r) => ({
      id: r.id,
      recipient: r.recipient,
      subject: r.subject,
      attempts: r.attempts,
      lastError: r.last_error ?? "",
      createdAt: r.created_at,
    })),
  });
});

/** Ponów nieudane wysyłki (failed → pending, zeruje próby). */
settingsRouter.post("/email-queue/retry", requireAuth, requireRole("admin"), (_req, res) => {
  const info = db.prepare(
    "UPDATE email_queue SET status = 'pending', attempts = 0, last_error = NULL WHERE status = 'failed'"
  ).run();
  res.json({ ok: true, retried: Number(info.changes ?? 0) });
});
