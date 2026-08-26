import { Router } from "express";
import { z } from "zod";
import { db, getSetting } from "../db";
import { newId, nowISO } from "../util";
import { requireAuth } from "../auth";
import { emitToUser } from "../ws";

// ===== V2.3 — WhatsApp przez mostek WhatsApp Web (Baileys) =====
export const whatsappRouter = Router();
whatsappRouter.use(requireAuth);

export function getBridgeUrl(): string {
  return (getSetting("whatsapp_bridge_url") || process.env.WHATSAPP_BRIDGE_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
}

export async function bridgeOnline(): Promise<boolean> {
  try {
    const r = await fetch(getBridgeUrl() + "/health", { signal: AbortSignal.timeout(4000) });
    return r.ok;
  } catch {
    return false;
  }
}

whatsappRouter.get("/status", async (_req, res) => {
  const url = getBridgeUrl();
  let online = false;
  let info: unknown = null;
  try {
    const r = await fetch(url + "/health", { signal: AbortSignal.timeout(4000) });
    online = r.ok;
    if (online) info = await r.json().catch(() => null);
  } catch { online = false; }
  res.json({ configured: !!url, online, bridgeUrl: url, info });
});

const sendSchema = z.object({
  chatId: z.string().min(1).max(200),
  message: z.string().min(1).max(4000),
});

whatsappRouter.post("/send", async (req, res) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Podaj numer (chatId) i treść" }); return; }
  try {
    const r = await fetch(getBridgeUrl() + "/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
      signal: AbortSignal.timeout(20000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { res.status(502).json({ error: (j as any)?.error || "Błąd mostka WhatsApp" }); return; }
    res.json({ ok: true, sent: j });
  } catch (e: any) {
    res.status(502).json({ error: "Mostek WhatsApp niedostępny: " + (e?.message || "") });
  }
});

whatsappRouter.get("/chat/:id", async (req, res) => {
  try {
    const r = await fetch(getBridgeUrl() + "/chat/" + encodeURIComponent(req.params.id), { signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { res.status(502).json({ error: (j as any)?.error || "Błąd mostka" }); return; }
    res.json(j);
  } catch {
    res.status(502).json({ error: "Mostek WhatsApp niedostępny" });
  }
});

// ===== Forwarder przychodzących: long-poll /messages → powiadomienia adminów =====
let forwarderRunning = false;
export function startWhatsappForwarder() {
  if (forwarderRunning) return;
  forwarderRunning = true;
  const loop = async () => {
    try {
      const url = getBridgeUrl();
      if (url) {
        const r = await fetch(url + "/messages", { signal: AbortSignal.timeout(30000) });
        if (r.ok) {
          const data = await r.json().catch(() => null);
          const msg = Array.isArray(data) ? data[0] : data;
          const text = String(msg?.body || msg?.message || msg?.text || "").trim();
          if (text) {
            const title = "📱 WhatsApp: " + String(msg?.from || msg?.sender || msg?.chatId || "wiadomość");
            const body = text.slice(0, 300);
            const admins = db.prepare("SELECT id FROM users WHERE role = 'admin' AND active = 1").all() as { id: string }[];
            for (const a of admins) {
              db.prepare(
                "INSERT INTO notifications (id, user_id, type, title, body, link, created_at) VALUES (?,?,?,?,?,?,?)"
              ).run(newId(), a.id, "whatsapp", title, body, "/whatsapp", nowISO());
              emitToUser(a.id, "notif:new", { title, body });
            }
          }
        }
      }
    } catch { /* mostek offline — spróbujemy ponownie */ }
    setTimeout(loop, 1500);
  };
  setTimeout(loop, 3000);
  console.log("[whatsapp] forwarder przychodzących uruchomiony");
}
