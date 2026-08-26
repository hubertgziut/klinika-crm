import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { api } from "../api";
import Toasts from "./Toasts";
import { pushToast } from "../toast";

interface Thread { id: string; title: string; messageCount: number }
interface AiMessage { id: string; role: string; content: any }
interface AiStatus {
  demo: boolean; provider: string; model: string | null;
  whisper: { available: boolean; modelPath: string };
  whatsapp: { configured: boolean; online: boolean };
  llmOptions: { id: "openai" | "deepseek"; label: string; model: string }[];
}

/** Prawy panel Asystenta AI — styl mobilnego ChatGPT: bąbelki, mikrofon (Whisper), selektor LLM. */
export default function AiPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<AiMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [llm, setLlm] = useState("auto");
  const [rec, setRec] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    api.get<AiStatus>("/api/ai/status").then(setStatus).catch(() => {});
    api.get<Thread[]>("/api/ai/threads").then(setThreads).catch(() => {});
  }, []);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [msgs, open, busy]);

  async function openThread(id: string | null) {
    setThreadId(id);
    if (!id) { setMsgs([]); return; }
    try {
      const d = await api.get<{ messages: AiMessage[] }>(`/api/ai/threads/${id}`);
      setMsgs(d.messages);
    } catch { setMsgs([]); }
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    setMsgs((m) => [...m, { id: "tmp" + Date.now(), role: "user", content: { type: "text", answer: text } }]);
    try {
      const r = await api.post<{ thread: Thread; message: AiMessage }>("/api/ai/chat", { message: text, threadId, provider: llm });
      setThreadId(r.thread.id);
      setMsgs((m) => [...m, r.message]);
      api.get<Thread[]>("/api/ai/threads").then(setThreads).catch(() => {});
    } catch (e: any) {
      pushToast(false, e?.message || "Błąd odpowiedzi AI");
      setMsgs((m) => m.slice(0, -1));
    } finally {
      setBusy(false);
    }
  }

  async function doTaskFromProduct(p: any) {
    try {
      const projects = await api.get<any[]>("/api/projects");
      const pr = projects[0];
      if (!pr) { pushToast(false, "Najpierw utwórz projekt (menu Projekty)"); return; }
      await api.post(`/api/projects/${pr.id}/tasks`, {
        title: "[AI] " + p.name,
        description: ((p.reason ? p.reason + "\n" : "") + (p.price ? "Cena: " + p.price + " zł\n" : "") + (p.url ? "Link: " + p.url : "")),
        ai_source: JSON.stringify({ type: "product", product: p }),
        priority: "medium",
      });
      pushToast(true, "Zadanie utworzone w projekcie „" + pr.name + "”");
    } catch (e: any) { pushToast(false, e?.message || "Błąd"); }
  }

  async function doCartFromProduct(p: any) {
    try {
      let carts = await api.get<any[]>("/api/carts");
      let cart = carts[0];
      if (!cart) {
        const c = await api.post<{ cart: any }>("/api/carts", { name: "Koszyk AI" });
        cart = c.cart;
      }
      await api.post(`/api/carts/${cart.id}/items`, { name: p.name, price: p.price || 0, url: p.url || "", supplier: p.supplier || "" });
      pushToast(true, "Dodano do koszyka „" + cart.name + "”");
    } catch (e: any) { pushToast(false, e?.message || "Błąd"); }
  }

  function renderContent(c: any, key: string) {
    if (c?.type === "products" && Array.isArray(c.products)) {
      return (
        <div key={key} className="ai-msg-bot">
          {c.answer}
          {c.products.map((p: any, i: number) => (
            <div className="ai-card" key={i}>
              <div className="c-name">{p.name}</div>
              <div className="c-meta">
                {typeof p.price === "number" && p.price > 0 ? p.price.toLocaleString("pl-PL") + " zł" : ""}
                {p.supplier ? " · " + p.supplier : ""}
                {p.reason ? " — " + p.reason : ""}
              </div>
              {p.url && <div className="c-meta"><a href={p.url} target="_blank" rel="noreferrer">🔗 link do oferty</a></div>}
              <div className="c-actions">
                <button className="btn small" onClick={() => doTaskFromProduct(p)}>📋 Do zadań</button>
                <button className="btn small accent" onClick={() => doCartFromProduct(p)}>🛒 Do koszyka</button>
              </div>
            </div>
          ))}
        </div>
      );
    }
    const text = c?.type === "text" ? c.answer : (typeof c === "string" ? c : (c?.answer || ""));
    return <div key={key} className="ai-msg-bot">{text}</div>;
  }

  async function toggleMic() {
    if (rec) { recRef.current?.stop(); return; }
    if (!status?.whisper?.available) { pushToast(false, "Whisper niedostępne — sprawdź ścieżkę modelu w Ustawieniach"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunks.current = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRec(false);
        const blob = new Blob(chunks.current, { type: "audio/webm" });
        if (blob.size < 2000) return;
        setBusy(true);
        try {
          const fd = new FormData();
          fd.append("audio", blob, "mikrofon.webm");
          const res = await fetch("/api/ai/transcribe", { method: "POST", body: fd, credentials: "include" });
          const j = await res.json();
          if (res.ok && j.text) setInput((p) => (p ? p + " " : "") + j.text);
          else pushToast(false, j?.error || "Błąd transkrypcji");
        } catch (e: any) { pushToast(false, "Błąd: " + e.message); }
        finally { setBusy(false); }
      };
      mr.start();
      recRef.current = mr;
      setRec(true);
    } catch (e: any) { pushToast(false, "Mikrofon niedostępny: " + e.message); }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  if (!open) return null;
  return (
    <aside className="ai-panel">
      <div className="ai-head">
        <span>✨ Asystent AI</span>
        {status && (
          <span className="ai-chip">
            {status.demo ? "tryb demo" : (status.provider === "deepseek" ? "DeepSeek" : "OpenAI") + (status.model ? " · " + status.model : "")}
          </span>
        )}
        <span className="spacer" />
        <button className="bell" title="Nowy wątek" onClick={() => openThread(null)}>➕</button>
        <button className="bell" title="Zwiń panel" onClick={onClose}>✕</button>
      </div>
      <div className="ai-thread-row">
        <select value={threadId ?? ""} onChange={(e) => openThread(e.target.value || null)}>
          <option value="">— nowy wątek —</option>
          {threads.map((t) => <option key={t.id} value={t.id}>{t.title.slice(0, 34)}</option>)}
        </select>
      </div>
      <div className="ai-msgs" ref={scrollRef}>
        {msgs.length === 0 && (
          <div className="empty" style={{ padding: 20 }}>
            <div className="big">🤖</div>
            Zapytaj asystenta — może zarządzać zadaniami, projektami, zakupami, kalendarzem i pocztą.
          </div>
        )}
        {msgs.map((m, i) => m.role === "user"
          ? <div key={m.id || i} className="ai-msg-user">{typeof m.content === "string" ? m.content : (m.content?.text || m.content?.answer || "")}</div>
          : renderContent(m.content, m.id || String(i)))}
        {busy && <div className="ai-msg-bot"><span className="aithink">myślę…</span></div>}
      </div>
      <div className="ai-input-wrap">
        {rec && (
          <div className="rec-bar">
            <span className="rec-dot" /> Nagrywanie…{" "}
            <button className="btn small accent" onClick={() => recRef.current?.stop()}>Zatrzymaj</button>
          </div>
        )}
        <div className="ai-input-row">
          <textarea rows={1} placeholder="Zapytaj asystenta…" value={input}
            onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} />
          <button className="ai-mic" title={status?.whisper?.available ? "Nagraj głos (lokalne Whisper)" : "Whisper niedostępne"}
            onClick={toggleMic} disabled={busy || !status?.whisper?.available}
            style={rec ? { background: "#fee2e2", color: "#b91c1c" } : undefined}>🎤</button>
          <button className="ai-send" onClick={send} disabled={busy || !input.trim()}>➤</button>
        </div>
        <div className="ai-llm-row">
          <span>LLM:</span>
          <select value={llm} onChange={(e) => setLlm(e.target.value)}>
            <option value="auto">Auto (skonfigurowany)</option>
            {status?.llmOptions.map((o) => (
              <option key={o.id} value={o.id}>{o.label} — {o.model}</option>
            ))}
          </select>
          {status?.whatsapp && <span title="Mostek WhatsApp">{status.whatsapp.online ? "🟢 WA" : "⚪ WA"}</span>}
        </div>
      </div>
      <Toasts />
    </aside>
  );
}
