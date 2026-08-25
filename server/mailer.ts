import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { db, getSetting, setSetting } from "./db";
import { newId, nowISO } from "./util";

// =====================================================================
// Klinika CRM — Faza 7: powiadomienia e-mail (SMTP)
// Kolejka email_queue + worker (co 30 s) + szablony HTML + wyzwalacze.
// API istniejące (getSmtpConfig, smtpConfigured, getTransporter,
// enqueueEmail, sendEmailNow, startMailWorker) zostało zachowane.
// =====================================================================

export function getSmtpConfig() {
  return {
    host: getSetting("smtp_host") || process.env.SMTP_HOST || "",
    port: Number(getSetting("smtp_port") || process.env.SMTP_PORT || 587),
    secure: getSetting("smtp_secure") === "true" || process.env.SMTP_SECURE === "true",
    user: getSetting("smtp_user") || process.env.SMTP_USER || "",
    pass: getSetting("smtp_pass") || process.env.SMTP_PASS || "",
    from: getSetting("smtp_from") || process.env.SMTP_FROM || "Klinika CRM <noreply@klinika.local>",
  };
}

export function smtpConfigured(): boolean {
  const c = getSmtpConfig();
  return !!(c.host && c.user);
}

export function getTransporter(): Transporter | null {
  const c = getSmtpConfig();
  if (!c.host || !c.user) return null;
  return nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    auth: { user: c.user, pass: c.pass },
  });
}

export function enqueueEmail(recipient: string, subject: string, bodyHtml: string, bodyText = "") {
  db.prepare(
    "INSERT INTO email_queue (id, recipient, subject, body_html, body_text, created_at) VALUES (?,?,?,?,?,?)"
  ).run(newId(), recipient, subject, bodyHtml, bodyText, nowISO());
}

export async function sendEmailNow(recipient: string, subject: string, bodyHtml: string, bodyText = ""): Promise<boolean> {
  const t = getTransporter();
  const cfg = getSmtpConfig();
  if (!t) return false;
  try {
    await t.sendMail({ from: cfg.from, to: recipient, subject, html: bodyHtml, text: bodyText });
    return true;
  } catch (e: any) {
    console.error("[mailer] błąd wysyłki:", e.message);
    return false;
  }
}

// ---------------------------------------------------------------------
// Pomocnicze: marka kliniki, linki, kodowanie
// ---------------------------------------------------------------------

export function clinicName(): string {
  return getSetting("clinic_name") || "Klinika";
}
export function clinicEmoji(): string {
  return getSetting("clinic_emoji") || "🩺";
}

/** Bazowy adres aplikacji: env APP_URL > ustawienie app_url > null (aplikacja lokalna). */
export function appBaseUrl(): string | null {
  const env = process.env.APP_URL;
  if (env && env.trim()) return env.trim().replace(/\/+$/, "");
  const s = getSetting("app_url");
  if (s && s.trim()) return s.trim().replace(/\/+$/, "");
  return null;
}

/** Zwraca gotowy link (np. "https://klinika.pl/zadania/abc") lub null, gdy brak APP_URL. */
function appLink(path: string): string | null {
  const b = appBaseUrl();
  return b ? b + path : null;
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Uproszczona wersja tekstowa z HTML (bez tagów). */
function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const TASK_STATUS_LABEL: Record<string, string> = {
  todo: "Do zrobienia",
  in_progress: "W trakcie",
  review: "Do weryfikacji",
  done: "Zakończone",
};
const ORDER_STATUS_LABEL: Record<string, string> = {
  placed: "złożone",
  shipped: "wysłane",
  delivered: "dostarczone",
  cancelled: "anulowane",
};
export const orderStatusLabel = (s: string) => ORDER_STATUS_LABEL[s] ?? s;

// ---------------------------------------------------------------------
// Szablon główny (layout)
// ---------------------------------------------------------------------

export function layoutEmail(title: string, bodyHtml: string): string {
  const emoji = esc(clinicEmoji());
  const name = esc(clinicName());
  return `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:#fbfaf6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:28px 16px;">
    <div style="background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #f0e9e1;box-shadow:0 4px 18px rgba(0,0,0,.06);">
      <div style="background:linear-gradient(135deg,#ff6b5e,#ffb03a);padding:22px 28px;color:#fff;">
        <div style="font-size:26px;line-height:1;">${emoji}</div>
        <div style="font-size:19px;font-weight:800;letter-spacing:.2px;margin-top:6px;">${name}</div>
      </div>
      <div style="padding:26px 28px;color:#2d2a26;font-size:15px;line-height:1.55;">
        ${bodyHtml}
      </div>
      <div style="padding:14px 28px;background:#fdfaf6;border-top:1px solid #f0e9e1;color:#9a8f80;font-size:12px;text-align:center;">
        Wysłano automatycznie przez Klinika CRM
      </div>
    </div>
  </div>
</body>
</html>`;
}

/** Pojedynczy przycisk-link w e-mailu (lub tekst, gdy brak APP_URL). */
function linkButton(href: string | null, label: string, fallbackText: string): string {
  if (!href) return `<p style="margin:0;color:#6b6255;">ℹ️ ${esc(fallbackText)}</p>`;
  return `<p style="margin:0;"><a href="${esc(href)}" style="display:inline-block;background:linear-gradient(135deg,#ff6b5e,#ffb03a);color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font-weight:700;font-size:14px;">${esc(label)}</a></p>`;
}

function kvRow(label: string, value: string): string {
  return `<tr><td style="padding:5px 0;color:#8a7f70;width:130px;font-size:13px;vertical-align:top;">${esc(label)}</td><td style="padding:5px 0;font-weight:600;">${esc(value)}</td></tr>`;
}

// ---------------------------------------------------------------------
// Wyzwalacze (zdarzenia) — wszystko przez kolejkę (enqueueEmail)
// ---------------------------------------------------------------------

export interface MailUser {
  email: string;
  name: string;
  emailNotifications?: number | boolean | null;
  email_notifications?: number | boolean | null;
}
export interface MailTask {
  id: string;
  title: string;
  description?: string | null;
  status?: string;
  priority?: string;
  dueDate?: string | null;
  due_date?: string | null;
  projectId?: string | null;
  project_id?: string | null;
}
export interface MailOrder {
  id: string;
  number: string;
  status: string;
  total?: number;
}
export interface LowStockItem {
  name: string;
  quantity: number;
  minQuantity: number;
  unit?: string;
  location?: string;
}

function wantsEmail(user: MailUser): boolean {
  return Number(user.emailNotifications ?? user.email_notifications ?? 1) === 1;
}

/** „Przydzielono Ci zadanie: {tytuł}” */
export function notifyTaskAssigned(user: MailUser, task: MailTask, projectName: string) {
  if (!wantsEmail(user)) return;
  const subject = `Przydzielono Ci zadanie: ${task.title}`;
  const desc = (task.description || "").trim();
  const descShort = desc.length > 220 ? desc.slice(0, 220) + "…" : desc;
  const due = task.dueDate ?? task.due_date ?? null;
  const link = appLink("/zadania");
  const bodyHtml = `
    <p style="margin:0 0 14px;">Cześć <b>${esc(user.name)}</b>!</p>
    <p style="margin:0 0 18px;">Przydzielono Ci zadanie <b>„${esc(task.title)}”</b>.</p>
    <table style="border-collapse:collapse;margin:0 0 16px;">
      ${kvRow("Projekt", projectName || "—")}
      ${kvRow("Status", TASK_STATUS_LABEL[task.status ?? ""] ?? task.status ?? "—")}
      ${kvRow("Termin", fmtDate(due))}
    </table>
    ${descShort ? `<div style="background:#fdfaf6;border:1px solid #f0e9e1;border-radius:9px;padding:12px 14px;color:#4d463d;font-size:14px;margin:0 0 18px;">${esc(descShort)}</div>` : ""}
    ${linkButton(link, "Zobacz zadanie", "aplikacja jest dostępna w sieci lokalnej")}`;
  const html = layoutEmail(subject, bodyHtml);
  enqueueEmail(user.email, subject, html, plainText(html));
}

/** „Nowy komentarz w zadaniu: {tytuł}” */
export function notifyComment(user: MailUser, task: MailTask, commenterName: string, commentBody: string) {
  if (!wantsEmail(user)) return;
  const subject = `Nowy komentarz w zadaniu: ${task.title}`;
  const body = (commentBody || "").trim();
  const bodyShort = body.length > 320 ? body.slice(0, 320) + "…" : body;
  const link = appLink("/zadania");
  const bodyHtml = `
    <p style="margin:0 0 14px;">Cześć <b>${esc(user.name)}</b>!</p>
    <p style="margin:0 0 16px;"><b>${esc(commenterName)}</b> dodał(a) komentarz do zadania <b>„${esc(task.title)}”</b>:</p>
    <div style="background:#fdfaf6;border:1px solid #f0e9e1;border-left:3px solid #ff6b5e;border-radius:9px;padding:12px 14px;color:#4d463d;font-size:14px;margin:0 0 18px;">${esc(bodyShort || "(pusty komentarz)")}</div>
    ${linkButton(link, "Zobacz zadanie", "aplikacja jest dostępna w sieci lokalnej")}`;
  const html = layoutEmail(subject, bodyHtml);
  enqueueEmail(user.email, subject, html, plainText(html));
}

/** „Zamówienie {number}: {status po polsku}” */
export function notifyOrderStatus(user: MailUser, order: MailOrder, newStatus: string, total?: number) {
  if (!wantsEmail(user)) return;
  const label = ORDER_STATUS_LABEL[newStatus] ?? newStatus;
  const subject = `Zamówienie ${order.number}: ${label}`;
  const totalText = typeof total === "number" && Number.isFinite(total)
    ? new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" }).format(total) : null;
  const link = appLink("/zamowienia");
  const bodyHtml = `
    <p style="margin:0 0 14px;">Cześć <b>${esc(user.name)}</b>!</p>
    <p style="margin:0 0 18px;">Zamówienie <b>${esc(order.number)}</b> ma teraz status: <b style="color:#e05247;">${esc(label)}</b>.</p>
    <table style="border-collapse:collapse;margin:0 0 16px;">
      ${kvRow("Zamówienie", order.number)}
      ${kvRow("Status", label)}
      ${totalText ? kvRow("Wartość", totalText) : ""}
    </table>
    ${linkButton(link, "Zobacz zamówienie", "aplikacja jest dostępna w sieci lokalnej")}`;
  const html = layoutEmail(subject, bodyHtml);
  enqueueEmail(user.email, subject, html, plainText(html));
}

/** „Twoje konto w Klinika CRM” — powitanie z hasłem tymczasowym. */
export function notifyWelcome(user: MailUser, tempPassword: string) {
  if (!wantsEmail(user)) return;
  const subject = `Twoje konto w ${clinicName()}`;
  const bodyHtml = `
    <p style="margin:0 0 14px;">Cześć <b>${esc(user.name)}</b>!</p>
    <p style="margin:0 0 16px;">Twoje konto w systemie <b>${esc(clinicName())} CRM</b> zostało właśnie utworzone.</p>
    <table style="border-collapse:collapse;margin:0 0 16px;">
      ${kvRow("E-mail", user.email)}
      ${kvRow("Hasło tymczasowe", tempPassword || "—")}
    </table>
    <div style="background:#fff4e5;border:1px solid #ffd9a8;border-radius:9px;padding:12px 14px;color:#7a5a20;font-size:13.5px;margin:0 0 18px;">
      ⚠️ Po pierwszym zalogowaniu <b>zmień hasło</b> w Ustawieniach, aby nikt inny nie miał do niego dostępu.
    </div>
    ${linkButton(appLink("/"), "Zaloguj się do aplikacji", "aplikacja jest dostępna w sieci lokalnej")}`;
  const html = layoutEmail(subject, bodyHtml);
  enqueueEmail(user.email, subject, html, plainText(html));
}

// ---------------------------------------------------------------------
// Niskie stany w inwentarzu
// ---------------------------------------------------------------------

export function collectLowStockItems(): LowStockItem[] {
  const rows = db.prepare(
    `SELECT p.name, p.unit, i.quantity, i.min_quantity, i.location
     FROM inventory i JOIN products p ON p.id = i.product_id
     WHERE i.quantity IS NOT NULL AND i.quantity < i.min_quantity
     ORDER BY (i.min_quantity - i.quantity) DESC`
  ).all() as any[];
  return rows.map((r) => ({
    name: r.name,
    quantity: Number(r.quantity ?? 0),
    minQuantity: Number(r.min_quantity ?? 0),
    unit: r.unit ?? "szt.",
    location: r.location ?? "",
  }));
}

/** Odbiorcy raportu: aktywni administratorzy i managerowie (z e-mailami). */
export function lowStockRecipients(): MailUser[] {
  const rows = db.prepare(
    `SELECT email, name, email_notifications FROM users
     WHERE active = 1 AND role IN ('admin','manager') AND email IS NOT NULL AND email != ''
     ORDER BY name`
  ).all() as any[];
  return rows.map((r) => ({ email: r.email, name: r.name, emailNotifications: r.email_notifications }));
}

/**
 * Zbiera produkty z niskim stanem i (jeśli są + SMTP skonfigurowane) enqueue
 * raport do adminów i managerów. Zwraca podsumowanie.
 */
export function sendLowStockReport(): { sent: boolean; count: number; recipients: number } {
  const items = collectLowStockItems();
  if (items.length === 0) return { sent: false, count: 0, recipients: 0 };
  if (!smtpConfigured()) {
    console.log("[mailer] raport niskich stanów: " + items.length + " produkt(ów), ale SMTP nie jest skonfigurowane — pominięto");
    return { sent: false, count: items.length, recipients: 0 };
  }
  const subject = "Alert: niskie stany w inwentarzu";
  const rowsHtml = items.map((it, i) =>
    `<tr style="${i % 2 ? "background:#fdfaf6;" : ""}">
       <td style="padding:8px 10px;border-bottom:1px solid #f0e9e1;">${esc(it.name)}</td>
       <td style="padding:8px 10px;border-bottom:1px solid #f0e9e1;text-align:center;color:#e05247;font-weight:700;">${it.quantity} ${esc(it.unit || "szt.")}</td>
       <td style="padding:8px 10px;border-bottom:1px solid #f0e9e1;text-align:center;">${it.minQuantity} ${esc(it.unit || "szt.")}</td>
       <td style="padding:8px 10px;border-bottom:1px solid #f0e9e1;">${esc(it.location || "—")}</td>
     </tr>`
  ).join("");
  const bodyHtml = `
    <p style="margin:0 0 14px;">Uwaga — w inwentarzu ${items.length > 1 ? "jest " + items.length + " produkty/produktów" : "jest 1 produkt"} o stanie poniżej minimum:</p>
    <table style="border-collapse:collapse;width:100%;margin:0 0 16px;font-size:13.5px;">
      <thead><tr style="background:#fff1e9;">
        <th style="padding:8px 10px;text-align:left;">Produkt</th>
        <th style="padding:8px 10px;">Stan</th>
        <th style="padding:8px 10px;">Min.</th>
        <th style="padding:8px 10px;text-align:left;">Lokalizacja</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    ${linkButton(appLink("/inwentarz"), "Przejdź do inwentarza", "aplikacja jest dostępna w sieci lokalnej")}`;
  const html = layoutEmail(subject, bodyHtml);
  const text = plainText(html);
  const recipients = lowStockRecipients();
  for (const u of recipients) {
    if (wantsEmail(u)) enqueueEmail(u.email, subject, html, text);
  }
  console.log(`[mailer] raport niskich stanów: ${items.length} produkt(ów) → kolejka (${recipients.length} odbiorców)`);
  return { sent: true, count: items.length, recipients: recipients.length };
}

// ---------------------------------------------------------------------
// Worker kolejki (co 30 s) + harmonogram raportu niskich stanów
// ---------------------------------------------------------------------

async function processQueue() {
  const rows = db.prepare(
    "SELECT * FROM email_queue WHERE status = 'pending' AND attempts < 3 ORDER BY created_at LIMIT 20"
  ).all() as any[];
  for (const row of rows) {
    const err = await trySend(row);
    if (err === null) {
      db.prepare("UPDATE email_queue SET status='sent', sent_at=?, attempts=attempts+1 WHERE id=?").run(nowISO(), row.id);
    } else {
      const attempts = Number(row.attempts ?? 0) + 1;
      const status = attempts >= 3 ? "failed" : "pending";
      db.prepare("UPDATE email_queue SET attempts=?, status=?, last_error=? WHERE id=?").run(attempts, status, err, row.id);
    }
  }
}

/** Próba wysyłki pojedynczego wpisu; zwraca null (OK) albo komunikat błędu. */
async function trySend(row: any): Promise<string | null> {
  const t = getTransporter();
  const cfg = getSmtpConfig();
  if (!t) return "SMTP nie jest skonfigurowane";
  try {
    await t.sendMail({
      from: cfg.from, to: row.recipient, subject: row.subject,
      html: row.body_html, text: row.body_text,
    });
    return null;
  } catch (e: any) {
    return e?.message ?? "błąd SMTP";
  }
}

function localDateStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Harmonogram: co minutę sprawdza, czy minęła 07:00 czasu lokalnego i czy
 * raport niskich stanów nie został już dziś wysłany (klucz low_stock_last_sent).
 */
function startLowStockScheduler() {
  setInterval(() => {
    try {
      const now = new Date();
      if (now.getHours() !== 7) return;
      const today = localDateStr(now);
      if (getSetting("low_stock_last_sent") === today) return;
      const res = sendLowStockReport();
      if (res.sent || (res.count === 0 && res.recipients === 0)) {
        // Wyślij tylko raz dziennie — oznacz klucz również, gdy nie ma czego wysyłać,
        // aby nie powtarzać sprawdzenia co minutę w godzinie 7:00.
        setSetting("low_stock_last_sent", today);
      }
    } catch (e: any) {
      console.error("[mailer] harmonogram niskich stanów:", e?.message ?? e);
    }
  }, 60_000);
  console.log("[mailer] harmonogram raportu niskich stanów uruchomiony (codziennie 07:00)");
}

export function startMailWorker(intervalMs = 30000) {
  setInterval(() => {
    processQueue().catch((e) => console.error("[mailer] worker:", e.message));
  }, intervalMs);
  startLowStockScheduler();
  console.log("[mailer] worker uruchomiony (kolejka e-mail)");
}
