import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { db, getSetting } from "../db";
import { newId, nowISO, safeParse } from "../util";
import { requireAuth } from "../auth";
import { aiChat, getAiStatus, getDeepSeekModel, getLlmOptions, isDemoMode, organizeData, parseAiContent, SYSTEM_PROMPT } from "../ai";
import { getWhisperModelPath, transcribeAudio, whisperAvailable } from "../whisper";

const audioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ===== Faza 6 — Asystent AI: czat, organizacja danych, wątki =====
export const aiRouter = Router();
aiRouter.use(requireAuth);

// ===== Który dostawca AI jest aktywny + Whisper + WhatsApp + lista LLM (selektor) =====
aiRouter.get("/status", async (_req, res) => {
  const s = getAiStatus();
  let whatsapp: { configured: boolean; online: boolean } = { configured: false, online: false };
  try {
    const baseUrl = (getSetting("whatsapp_bridge_url") || process.env.WHATSAPP_BRIDGE_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
    if (baseUrl) {
      const r = await fetch(baseUrl + "/health", { signal: AbortSignal.timeout(3000) });
      whatsapp = { configured: true, online: r.ok };
    }
  } catch {
    whatsapp = { configured: true, online: false };
  }
  res.json({
    ...s,
    whisper: { available: whisperAvailable(), modelPath: getWhisperModelPath() },
    whatsapp,
    llmOptions: getLlmOptions(),
  });
});

// ===== Transkrypcja głosu — lokalne Whisper (whisper-cli, ggml-large-v3) =====
aiRouter.post("/transcribe", audioUpload.single("audio"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Brak pliku audio" });
    return;
  }
  if (!whisperAvailable()) {
    res.status(400).json({ error: "Model Whisper nie znaleziony — sprawdź ścieżkę w Ustawieniach (Asystent AI)" });
    return;
  }
  try {
    const ext = (req.file.originalname || "audio.webm").split(".").pop() || "webm";
    const text = await transcribeAudio(req.file.buffer, ext);
    res.json({ text });
  } catch (e: any) {
    console.error("[whisper] błąd:", e?.message);
    res.status(500).json({ error: "Błąd transkrypcji: " + (e?.message || "nieznany błąd") });
  }
});

const chatSchema = z.object({
  threadId: z.string().min(1).optional(),
  message: z.string().min(1).max(4000),
  provider: z.enum(["auto", "openai", "deepseek"]).optional().default("auto"),
});
const organizeSchema = z.object({
  columns: z.array(z.object({ key: z.string().min(1).max(80), label: z.string().max(200) })).max(50).optional().default([]),
  rows: z.array(z.object({
    id: z.string().optional(),
    cells: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  })).min(1).max(2000),
});

// ===== Konwersja zapisanych wiadomości (JSON) na tekst dla OpenAI =====
function msgToText(content: string): string {
  const obj = safeParse<{ text?: string; answer?: string; products?: unknown[] } | null>(content, null);
  if (obj && typeof obj === "object") {
    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.answer === "string") {
      const products = Array.isArray(obj.products)
        ? "\nProdukty: " + obj.products.map((p: any) => p?.name ?? "").filter(Boolean).join(", ")
        : "";
      return obj.answer + products;
    }
  }
  return String(content ?? "");
}

function threadRow(id: string): any {
  return db.prepare("SELECT * FROM ai_threads WHERE id = ?").get(id) as any;
}
function serializeThread(r: any) {
  const count = db.prepare("SELECT COUNT(*) AS c FROM ai_messages WHERE thread_id = ?").get(r.id) as { c: number };
  return { id: r.id, title: r.title, updatedAt: r.updated_at, messageCount: count.c };
}

// ===== POST /api/ai/chat — wysłanie wiadomości (utworzenie wątku, jeśli brak) =====
aiRouter.post("/chat", async (req, res) => {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Nieprawidłowe dane czatu", details: parsed.error.flatten() });
    return;
  }
  const { threadId, message, provider } = parsed.data;
  const userId = req.user!.id;
  const t = nowISO();

  let tid = threadId;
  if (!tid) {
    const id = newId();
    const title = message.trim().slice(0, 40) || "Nowy wątek";
    db.prepare("INSERT INTO ai_threads (id, user_id, title, created_at, updated_at) VALUES (?,?,?,?,?)")
      .run(id, userId, title, t, t);
    tid = id;
  } else {
    const thread = db.prepare("SELECT id FROM ai_threads WHERE id = ? AND user_id = ?").get(tid, userId);
    if (!thread) { res.status(404).json({ error: "Nie znaleziono wątku" }); return; }
  }

  // Zapisz wiadomość użytkownika (content = JSON {text})
  const userMsgId = newId();
  db.prepare("INSERT INTO ai_messages (id, thread_id, role, content, created_at) VALUES (?,?,?,?,?)")
    .run(userMsgId, tid, "user", JSON.stringify({ text: message }), t);
  db.prepare("UPDATE ai_threads SET updated_at = ? WHERE id = ?").run(t, tid);

  // Historia: ostatnie ~12 wiadomości wątku (user/assistant)
  const hist = db.prepare(
    "SELECT role, content FROM ai_messages WHERE thread_id = ? ORDER BY created_at ASC, id ASC"
  ).all(tid) as any[];
  const recent = hist
    .slice(-12)
    .map((m) => ({ role: m.role, content: msgToText(m.content) }))
    .filter((m) => m.role === "user" || m.role === "assistant");

  // Wywołanie AI (pełny tryb z function calling lub tryb demo)
  let result;
  try {
    const raw = await aiChat([{ role: "system", content: SYSTEM_PROMPT }, ...recent], provider);
    result = parseAiContent(raw);
  } catch (e: any) {
    res.status(502).json({ error: e?.message || "Błąd odpowiedzi AI" });
    return;
  }

  // Zapisz odpowiedź asystenta (content = JSON odpowiedzi)
  const msgId = newId();
  db.prepare("INSERT INTO ai_messages (id, thread_id, role, content, created_at) VALUES (?,?,?,?,?)")
    .run(msgId, tid, "assistant", JSON.stringify(result), t);
  db.prepare("UPDATE ai_threads SET updated_at = ? WHERE id = ?").run(t, tid);

  res.json({
    threadId: tid,
    thread: serializeThread(threadRow(tid)),
    message: { id: msgId, threadId: tid, role: "assistant", content: result, createdAt: t },
    demo: isDemoMode(),
  });
});

// ===== POST /api/ai/organize — segregowanie wierszy tabeli =====
aiRouter.post("/organize", async (req, res) => {
  const parsed = organizeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Nieprawidłowe dane do segregacji", details: parsed.error.flatten() });
    return;
  }
  try {
    const result = await organizeData(parsed.data.columns, parsed.data.rows);
    res.json(result);
  } catch (e: any) {
    res.status(502).json({ error: e?.message || "Błąd AI" });
  }
});

// ===== GET /api/ai/threads — lista wątków użytkownika =====
aiRouter.get("/threads", (req, res) => {
  const rows = db.prepare(
    "SELECT * FROM ai_threads WHERE user_id = ? ORDER BY updated_at DESC"
  ).all(req.user!.id) as any[];
  res.json(rows.map(serializeThread));
});

// ===== GET /api/ai/threads/:id — wiadomości wątku (tylko właściciel) =====
aiRouter.get("/threads/:id", (req, res) => {
  const thread = db.prepare("SELECT * FROM ai_threads WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.user!.id) as any;
  if (!thread) { res.status(404).json({ error: "Nie znaleziono wątku" }); return; }
  const rows = db.prepare(
    "SELECT * FROM ai_messages WHERE thread_id = ? ORDER BY created_at ASC, id ASC"
  ).all(req.params.id) as any[];
  res.json({
    thread: serializeThread(thread),
    messages: rows.map((m) => ({
      id: m.id,
      threadId: m.thread_id,
      role: m.role,
      content: safeParse(m.content, {}),
      createdAt: m.created_at,
    })),
  });
});
