import { useEffect, useState } from "react";
import { api } from "../api";
import Toasts from "../components/Toasts";
import { pushToast } from "../toast";

interface WaStatus { configured: boolean; online: boolean; bridgeUrl: string; info: unknown }

export default function WhatsApp() {
  const [status, setStatus] = useState<WaStatus | null>(null);
  const [chatId, setChatId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { refresh(); }, []);
  async function refresh() {
    try { setStatus(await api.get<WaStatus>("/api/whatsapp/status")); } catch { /* ignore */ }
  }
  async function send() {
    if (!chatId.trim() || !message.trim()) { pushToast(false, "Podaj numer i treść"); return; }
    setBusy(true);
    try {
      const r = await api.post<{ ok: boolean }>("/api/whatsapp/send", { chatId: chatId.trim(), message });
      pushToast(true, "Wiadomość wysłana przez mostek");
      setMessage("");
    } catch (e: any) { pushToast(false, e?.message || "Błąd wysyłki"); }
    finally { setBusy(false); }
  }

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <div className="page-head">
        <h1>📱 WhatsApp</h1>
        <span className="sub">Integracja przez mostek WhatsApp Web (Baileys)</span>
        <div className="spacer" />
        <button className="btn ghost small" onClick={refresh}>🔄 Odśwież status</button>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-title">🔌 Status mostka
          <span className="spacer" />
          {status && (
            <span className={`badge ${status.online ? "green" : "warn"}`}>
              {status.online ? "● online" : "● offline"}
            </span>
          )}
        </div>
        {status ? (
          <p style={{ fontSize: 13, color: "var(--muted)" }}>
            Mostek: <code>{status.bridgeUrl}</code>
            {!status.online && " — uruchom go: node bridge.js --port 3001 (katalog ~/.hermes/hermes-agent/scripts/whatsapp-bridge) i zaloguj się kodem QR przy pierwszym starcie."}
          </p>
        ) : <p style={{ color: "var(--muted)", fontSize: 13 }}>Sprawdzam…</p>}
      </div>

      <div className="panel">
        <div className="panel-title">✉️ Wyślij wiadomość</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label className="field">Numer (chatId)
            <input className="input" value={chatId} onChange={(e) => setChatId(e.target.value)}
              placeholder="np. 48501234567@s.whatsapp.net" disabled={!status?.online} />
          </label>
          <label className="field">Treść
            <textarea className="input" rows={4} value={message} onChange={(e) => setMessage(e.target.value)}
              placeholder="Wiadomość do zespołu…" disabled={!status?.online} />
          </label>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn accent" onClick={send} disabled={busy || !status?.online}>
              {busy ? "Wysyłam…" : "📤 Wyślij"}
            </button>
            {!status?.online && <span style={{ fontSize: 12, color: "var(--muted)", alignSelf: "center" }}>Mostek offline — wyślij po uruchomieniu.</span>}
          </div>
          <p style={{ fontSize: 12, color: "var(--muted)" }}>
            💡 Asystent AI też potrafi wysyłać WhatsApp (narzędzie send_whatsapp): powiedz np. „wyślij na WhatsApp numer 501234567, że jutro dyżur o 8:00”.
          </p>
        </div>
      </div>
      <Toasts />
    </div>
  );
}
