import { useEffect, useState } from "react";
import { api } from "../api";
import Toasts from "../components/Toasts";
import { pushToast } from "../toast";
import { useApp } from "../store";

interface MailItem {
  id: string; messageId: string; folder: string; fromName: string; fromEmail: string;
  toText: string; subject: string; bodyText: string; bodyHtml: string;
  mailDate: string; seen: boolean; syncedAt: string;
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" }) + " " +
    d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
}

export default function Mail() {
  const [items, setItems] = useState<MailItem[]>([]);
  const [configured, setConfigured] = useState(true);
  const [sel, setSel] = useState<MailItem | null>(null);
  const [composer, setComposer] = useState(false);
  const [form, setForm] = useState({ to: "", subject: "", body: "" });
  const [busy, setBusy] = useState(false);
  const refreshMailUnread = useApp((s) => s.refreshMailUnread);

  async function load() {
    try {
      const d = await api.get<{ items: MailItem[]; configured: boolean }>("/api/mail");
      setItems(d.items);
      setConfigured(d.configured);
      refreshMailUnread();
    } catch (e: any) { pushToast(false, e?.message || "Błąd ładowania poczty"); }
  }
  useEffect(() => { load(); }, []);

  async function openMail(m: MailItem) {
    setSel(m);
    if (!m.seen) {
      try { await api.post(`/api/mail/${m.id}/seen`, { seen: true }); setItems((xs) => xs.map((x) => x.id === m.id ? { ...x, seen: true } : x)); refreshMailUnread(); } catch { /* ignore */ }
    }
  }

  async function sync() {
    setBusy(true);
    try {
      const r = await api.post<{ ok: boolean; synced: number }>("/api/mail/sync");
      pushToast(true, "Zsynchronizowano: " + (r.synced ?? 0) + " nowych");
      await load();
    } catch (e: any) { pushToast(false, e?.message || "Błąd synchronizacji"); }
    finally { setBusy(false); }
  }

  async function send() {
    if (!form.to.trim() || !form.subject.trim()) { pushToast(false, "Podaj adres i temat"); return; }
    setBusy(true);
    try {
      const r = await api.post<{ ok: boolean; queued?: boolean; message?: string }>("/api/mail/send", form);
      pushToast(r.queued ? false : true, r.queued ? (r.message || "Wysłano do kolejki") : "Wiadomość wysłana");
      setComposer(false);
      setForm({ to: "", subject: "", body: "" });
    } catch (e: any) { pushToast(false, e?.message || "Błąd wysyłki"); }
    finally { setBusy(false); }
  }

  async function makeTask() {
    if (!sel) return;
    try {
      const r = await api.post<{ ok: boolean; projectName: string }>(`/api/mail/${sel.id}/task`);
      pushToast(true, "Zadanie utworzone w projekcie „" + r.projectName + "”");
    } catch (e: any) { pushToast(false, e?.message || "Błąd"); }
  }

  if (!configured && items.length === 0) {
    return (
      <div className="page">
        <div className="page-head"><h1>📧 Poczta</h1><span className="sub">Skrzynka e-mail zespołu</span></div>
        <div className="panel">
          <div className="empty">
            <div className="big">📧</div>
            <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 15 }}>Skrzynka e-mail nie jest skonfigurowana</div>
            <p style={{ marginTop: 6 }}>Dodaj dane IMAP w Ustawieniach → „Skrzynka e-mail (IMAP)”, aby czytać i wysyłać pocztę z poziomu CRM. Wysyłka korzysta ze skonfigurowanego SMTP.</p>
            <button className="btn accent" style={{ marginTop: 14 }} onClick={load}>🔄 Odśwież</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 1200 }}>
      <div className="page-head">
        <h1>📧 Poczta</h1><span className="sub">Skrzynka zespołu (IMAP)</span>
        <div className="spacer" />
        <button className="btn ghost small" onClick={sync} disabled={busy}>{busy ? "Synchronizuję…" : "🔄 Synchronizuj"}</button>
        <button className="btn accent" onClick={() => { setForm({ to: "", subject: "", body: "" }); setComposer(true); }}>✉️ Nowa wiadomość</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 16, alignItems: "start" }}>
        <div className="panel" style={{ maxHeight: "calc(100vh - 180px)", overflow: "auto", padding: 8 }}>
          {items.length === 0 && <div style={{ padding: 20, color: "var(--muted)", textAlign: "center" }}>Brak wiadomości. Kliknij „Synchronizuj”.</div>}
          {items.map((m) => (
            <div key={m.id} onClick={() => openMail(m)}
              style={{ cursor: "pointer", padding: "10px 12px", borderRadius: 10, background: m.id === sel?.id ? "var(--accent-soft)" : "transparent", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {!m.seen && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", flex: "0 0 auto" }} />}
                <b style={{ fontSize: 12.5, fontWeight: m.seen ? 600 : 800 }}>{m.fromName || m.fromEmail || "—"}</b>
                <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--muted)" }}>{fmtDate(m.mailDate)}</span>
              </div>
              <div style={{ fontSize: 12.5, marginTop: 2, fontWeight: m.seen ? 500 : 700, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{m.subject || "(bez tematu)"}</div>
            </div>
          ))}
        </div>
        <div className="panel" style={{ minHeight: 300 }}>
          {!sel ? (
            <div className="empty"><div className="big">📬</div>Wybierz wiadomość, aby ją przeczytać.</div>
          ) : (
            <>
              <div className="panel-title">📄 {sel.subject || "(bez tematu)"}<span className="spacer" /></div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>
                <b>Od:</b> {sel.fromName} &lt;{sel.fromEmail}&gt; · <b>Data:</b> {fmtDate(sel.mailDate)}
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", maxHeight: "calc(100vh - 340px)", overflow: "auto" }}>
                {sel.bodyText || "(brak treści)"}
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                <button className="btn small" onClick={() => { setForm({ to: sel.fromEmail, subject: "Re: " + (sel.subject || ""), body: "" }); setComposer(true); }}>↩️ Odpowiedz</button>
                <button className="btn small" onClick={makeTask}>📋 Utwórz zadanie</button>
              </div>
            </>
          )}
        </div>
      </div>

      {composer && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setComposer(false); }}>
          <div className="modal">
            <h2>✉️ Nowa wiadomość</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label className="field">Do <input className="input" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} placeholder="adres@example.com" /></label>
              <label className="field">Temat <input className="input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></label>
              <label className="field">Treść <textarea className="input" rows={6} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></label>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button className="btn ghost" onClick={() => setComposer(false)}>Anuluj</button>
                <button className="btn accent" onClick={send} disabled={busy}>{busy ? "Wysyłam…" : "Wyślij"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
      <Toasts />
    </div>
  );
}
