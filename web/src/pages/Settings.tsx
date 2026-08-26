import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useApp } from "../store";
import Avatar from "../components/Avatar";

interface AdminSettings {
  clinic_name: string; clinic_emoji: string;
  smtp_host: string; smtp_port: string; smtp_user: string; smtp_secure: string; smtp_from: string;
  smtp_pass: string; openai_key: string; search_api_key: string; app_url: string;
  ai_provider: string; deepseek_key: string; deepseek_model: string;
  whisper_model_path: string; whisper_bin: string; whatsapp_bridge_url: string;
  imap_host: string; imap_port: string; imap_user: string; imap_pass: string; imap_secure: string;
}

interface AiStatus { demo: boolean; provider: "openai" | "deepseek" | "demo"; model: string | null }

interface EmailQueueInfo {
  pending: number;
  sent: number;
  failed: number;
  lastErrors: {
    id: string;
    recipient: string;
    subject: string;
    attempts: number;
    lastError: string;
    createdAt: string;
  }[];
}

interface AccountUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "manager" | "member";
  avatarColor: string;
  active: boolean;
  createdAt: string;
}

interface Toast { id: number; ok: boolean; text: string; }

const EMPTY: AdminSettings = {
  clinic_name: "Klinika", clinic_emoji: "🩺",
  smtp_host: "", smtp_port: "587", smtp_user: "", smtp_secure: "false", smtp_from: "",
  smtp_pass: "", openai_key: "", search_api_key: "", app_url: "",
  ai_provider: "auto", deepseek_key: "", deepseek_model: "deepseek-v4-flash",
  whisper_model_path: "/Users/hubert/Library/Application Support/Hermes Control/Models/Whisper/ggml-large-v3.bin",
  whisper_bin: "whisper-cli", whatsapp_bridge_url: "http://127.0.0.1:3001",
  imap_host: "", imap_port: "993", imap_user: "", imap_pass: "", imap_secure: "true",
};

const ROLE_LABEL: Record<AccountUser["role"], string> = {
  admin: "Administrator", manager: "Manager", member: "Członek zespołu",
};

function roleBadgeClass(role: AccountUser["role"]): string {
  if (role === "admin") return "badge";
  if (role === "manager") return "badge blue";
  return "badge green";
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function Settings() {
  const user = useApp((s) => s.user)!;
  const [form, setForm] = useState<AdminSettings>(EMPTY);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [users, setUsers] = useState<AccountUser[] | null>(null);
  const isAdmin = user.role === "admin";

  // zmiana hasła
  const [pwForm, setPwForm] = useState({ current: "", next: "", next2: "" });
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  // dodawanie konta
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ email: "", name: "", role: "member" as AccountUser["role"], password: "" });
  const [addErr, setAddErr] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addResult, setAddResult] = useState<{ name: string; email: string; tempPassword?: string } | null>(null);

  // reset hasła
  const [resetPw, setResetPw] = useState<{ user: AccountUser; tempPassword: string } | null>(null);

  // e-mail: test SMTP + kolejka
  const [testEmailTo, setTestEmailTo] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [queue, setQueue] = useState<EmailQueueInfo | null>(null);
  const [queueBusy, setQueueBusy] = useState(false);

  // toasty
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);

  function pushToast(ok: boolean, text: string) {
    const id = ++toastSeq.current;
    setToasts((t) => [...t, { id, ok, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }

  function copyText(text: string) {
    navigator.clipboard?.writeText(text).then(
      () => pushToast(true, "Skopiowano do schowka"),
      () => pushToast(false, "Nie udało się skopiować")
    );
  }

  async function loadUsers() {
    try {
      const list = await api.get<AccountUser[]>("/api/users");
      setUsers(list);
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się pobrać kont");
    }
  }

  async function loadQueue() {
    try {
      const q = await api.get<EmailQueueInfo>("/api/settings/email-queue");
      setQueue(q);
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się pobrać kolejki e-mail");
    }
  }

  async function sendTestEmail() {
    if (!testEmailTo.trim()) {
      pushToast(false, "Podaj adres e-mail, na który wysłać test");
      return;
    }
    setTestBusy(true);
    try {
      const res = await api.post<{ ok: boolean; message?: string; error?: string }>("/api/settings/test-email", { to: testEmailTo.trim() });
      pushToast(!!res.ok, res.ok ? "✅ " + (res.message || "Wysłano testową wiadomość") : "❌ " + (res.error || "Błąd wysyłki"));
    } catch (e: any) {
      pushToast(false, "❌ " + (e?.message || "Nie udało się wysłać testu"));
    } finally {
      setTestBusy(false);
    }
  }

  async function retryFailed() {
    setQueueBusy(true);
    try {
      const res = await api.post<{ ok: boolean; retried: number }>("/api/settings/email-queue/retry");
      pushToast(true, "Ponowiono " + res.retried + " nieudanych wysyłek");
      await loadQueue();
    } catch (e: any) {
      pushToast(false, e?.message || "Błąd ponawiania");
    } finally {
      setQueueBusy(false);
    }
  }

  useEffect(() => {
    if (isAdmin) {
      api.get<AdminSettings>("/api/settings/admin").then((d) => setForm({ ...EMPTY, ...d })).catch(() => {});
      api.get<AiStatus>("/api/ai/status").then(setAiStatus).catch(() => {});
      loadUsers();
      loadQueue();
      setTestEmailTo(user.email || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  function set<K extends keyof AdminSettings>(k: K, v: AdminSettings[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    setMsg(null);
    try {
      await api.patch("/api/settings/admin", form);
      setMsg({ ok: true, text: "✅ Ustawienia zapisane" });
      api.get<AiStatus>("/api/ai/status").then(setAiStatus).catch(() => {});
    } catch (e: any) {
      setMsg({ ok: false, text: "❌ " + (e?.message || "błąd") });
    }
  }

  // ---- zmiana hasła ----
  async function changePassword() {
    setPwMsg(null);
    if (!pwForm.current || !pwForm.next || !pwForm.next2) {
      setPwMsg({ ok: false, text: "Wypełnij wszystkie pola" });
      return;
    }
    if (pwForm.next.length < 8) {
      setPwMsg({ ok: false, text: "Nowe hasło musi mieć co najmniej 8 znaków" });
      return;
    }
    if (pwForm.next !== pwForm.next2) {
      setPwMsg({ ok: false, text: "Powtórzone hasło różni się od nowego" });
      return;
    }
    setPwBusy(true);
    try {
      await api.post("/api/auth/change-password", { currentPassword: pwForm.current, newPassword: pwForm.next });
      setPwMsg({ ok: true, text: "✅ Hasło zmienione — pozostałe sesje zostały wylogowane" });
      setPwForm({ current: "", next: "", next2: "" });
    } catch (e: any) {
      setPwMsg({ ok: false, text: "❌ " + (e?.message || "Nie udało się zmienić hasła") });
    } finally {
      setPwBusy(false);
    }
  }

  // ---- zarządzanie kontami ----
  function openAdd() {
    setAddErr("");
    setAddResult(null);
    setAddForm({ email: "", name: "", role: "member", password: "" });
    setAddOpen(true);
  }
  function closeAdd() {
    setAddOpen(false);
    setAddErr("");
    setAddResult(null);
  }

  async function submitAdd() {
    setAddErr("");
    if (!addForm.email || !addForm.name) {
      setAddErr("Podaj e-mail oraz imię i nazwisko");
      return;
    }
    setAddBusy(true);
    try {
      const body: Record<string, unknown> = { email: addForm.email, name: addForm.name, role: addForm.role };
      if (addForm.password) body.password = addForm.password;
      const res = await api.post<{ user: AccountUser; tempPassword?: string }>("/api/users", body);
      setAddResult({ name: res.user.name, email: res.user.email, tempPassword: res.tempPassword });
      pushToast(true, "Konto utworzone");
      await loadUsers();
    } catch (e: any) {
      setAddErr(e?.message || "Nie udało się utworzyć konta");
    } finally {
      setAddBusy(false);
    }
  }

  async function toggleActive(u: AccountUser) {
    try {
      await api.patch("/api/users/" + u.id, { active: !u.active });
      pushToast(true, u.active ? "Konto dezaktywowane" : "Konto aktywowane");
      await loadUsers();
    } catch (e: any) {
      pushToast(false, e?.message || "Błąd");
    }
  }

  async function resetPassword(u: AccountUser) {
    try {
      const res = await api.post<{ ok: boolean; tempPassword: string }>("/api/users/" + u.id + "/reset-password");
      setResetPw({ user: u, tempPassword: res.tempPassword });
    } catch (e: any) {
      pushToast(false, e?.message || "Błąd");
    }
  }

  async function removeUser(u: AccountUser) {
    if (!window.confirm("Usunąć konto " + u.name + " (" + u.email + ")?\nKonto zostanie dezaktywowane — będzie można je później aktywować.")) return;
    try {
      await api.del("/api/users/" + u.id);
      pushToast(true, "Konto usunięte");
      await loadUsers();
    } catch (e: any) {
      pushToast(false, e?.message || "Błąd");
    }
  }

  return (
    <div className="page" style={{ maxWidth: 880 }}>
      <div className="page-head"><h1>Ustawienia</h1></div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-title">👤 Moje konto</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <label className="field">Imię i nazwisko<input className="input" value={user.name} disabled /></label>
          <label className="field">E-mail<input className="input" value={user.email} disabled /></label>
        </div>
        <div style={{ marginTop: 12 }}>
          <span className="badge">{ROLE_LABEL[user.role]}</span>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-title">🔒 Zmień hasło</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
          <label className="field">Obecne hasło
            <input className="input" type="password" value={pwForm.current} onChange={(e) => setPwForm({ ...pwForm, current: e.target.value })} placeholder="••••••••" autoComplete="current-password" />
          </label>
          <label className="field">Nowe hasło (min. 8 znaków)
            <input className="input" type="password" value={pwForm.next} onChange={(e) => setPwForm({ ...pwForm, next: e.target.value })} placeholder="••••••••" autoComplete="new-password" />
          </label>
          <label className="field">Powtórz nowe hasło
            <input className="input" type="password" value={pwForm.next2} onChange={(e) => setPwForm({ ...pwForm, next2: e.target.value })} placeholder="••••••••" autoComplete="new-password" />
          </label>
        </div>
        {pwMsg && (
          <div className="login-error" style={{ marginTop: 12, background: pwMsg.ok ? "var(--green-soft)" : "#fee2e2", color: pwMsg.ok ? "#047857" : "#b91c1c" }}>
            {pwMsg.text}
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <button className="btn accent" disabled={pwBusy} onClick={changePassword}>
            {pwBusy ? "Zapisywanie…" : "Zapisz nowe hasło"}
          </button>
        </div>
      </div>

      {isAdmin && (
        <>
          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-title">
              👥 Zarządzanie kontami
              <span className="spacer" />
              {users && <span className="badge blue">{users.length}</span>}
              <button className="btn accent small" onClick={openAdd}>➕ Dodaj konto</button>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Użytkownik</th>
                  <th>Rola</th>
                  <th>Status</th>
                  <th>Utworzono</th>
                  <th style={{ textAlign: "right" }}>Akcje</th>
                </tr>
              </thead>
              <tbody>
                {users && users.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <div className="empty" style={{ padding: 22 }}>Brak kont — dodaj pierwsze konto zespołu.</div>
                    </td>
                  </tr>
                )}
                {(users || []).map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="user-cell">
                        <Avatar name={u.name} color={u.avatarColor} size={30} />
                        <div>
                          <div className="u-name">
                            {u.name}
                            {u.id === user.id && <span className="badge">Ty</span>}
                          </div>
                          <div className="u-mail">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td><span className={roleBadgeClass(u.role)}>{ROLE_LABEL[u.role]}</span></td>
                    <td>
                      {u.active
                        ? <span className="badge green">● Aktywny</span>
                        : <span className="badge warn">● Nieaktywny</span>}
                    </td>
                    <td className="muted-text">{fmtDate(u.createdAt)}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="btn small" onClick={() => resetPassword(u)} title="Wygeneruj nowe hasło">🔑 Resetuj hasło</button>{" "}
                      <button className="btn small" onClick={() => toggleActive(u)}>
                        {u.active ? "😴 Dezaktywuj" : "▶️ Aktywuj"}
                      </button>{" "}
                      <button className="btn small danger" onClick={() => removeUser(u)} title="Usuń (dezaktywuj) konto">🗑 Usuń</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-title">🏥 Dane kliniki</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <label className="field">Nazwa kliniki
                <input className="input" value={form.clinic_name} onChange={(e) => set("clinic_name", e.target.value)} />
              </label>
              <label className="field">Emoji
                <input className="input" value={form.clinic_emoji} onChange={(e) => set("clinic_emoji", e.target.value)} />
              </label>
            </div>
          </div>

          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-title">📧 Powiadomienia e-mail (SMTP)
              <span className="spacer" />
              <span className="badge blue">konfiguracja</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <label className="field">Host SMTP<input className="input" value={form.smtp_host} onChange={(e) => set("smtp_host", e.target.value)} placeholder="smtp.example.com" /></label>
              <label className="field">Port<input className="input" value={form.smtp_port} onChange={(e) => set("smtp_port", e.target.value)} /></label>
              <label className="field">Użytkownik<input className="input" value={form.smtp_user} onChange={(e) => set("smtp_user", e.target.value)} /></label>
              <label className="field">Hasło<input className="input" type="password" value={form.smtp_pass} onChange={(e) => set("smtp_pass", e.target.value)} placeholder={form.smtp_pass === "***" ? "zapisane — zostaw, aby nie zmieniać" : ""} /></label>
              <label className="field">Od (from)<input className="input" value={form.smtp_from} onChange={(e) => set("smtp_from", e.target.value)} placeholder="Klinika CRM <noreply@klinika.pl>" /></label>
              <label className="field" style={{ justifyContent: "flex-end" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 26 }}>
                  <input type="checkbox" checked={form.smtp_secure === "true"} onChange={(e) => set("smtp_secure", String(e.target.checked))} />
                  TLS (bezpieczne połączenie)
                </span>
              </label>
              <label className="field">Adres aplikacji (APP_URL)
                <input className="input" value={form.app_url} onChange={(e) => set("app_url", e.target.value)} placeholder="https://klinika.example.pl" />
              </label>
            </div>
            <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input
                className="input"
                style={{ flex: 1, minWidth: 240 }}
                type="email"
                value={testEmailTo}
                onChange={(e) => setTestEmailTo(e.target.value)}
                placeholder="adres@klinika.pl"
              />
              <button className="btn accent" disabled={testBusy} onClick={sendTestEmail}>
                {testBusy ? "Wysyłanie…" : "✉️ Wyślij e-mail testowy"}
              </button>
            </div>
            <p className="muted-text" style={{ marginTop: 8 }}>Wysyłka natychmiastowa (poza kolejką) — sprawdza konfigurację SMTP. Zapisz ustawienia przed testem.</p>
          </div>

          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-title">
              📬 Kolejka e-mail
              <span className="spacer" />
              <span className="badge">oczekujące: {queue ? queue.pending : "…"}</span>{" "}
              <span className="badge green">wysłane: {queue ? queue.sent : "…"}</span>{" "}
              <span className="badge warn">nieudane: {queue ? queue.failed : "…"}</span>{" "}
              <button className="btn small" disabled={queueBusy || !queue || queue.failed === 0} onClick={retryFailed}>
                ↻ Ponów nieudane
              </button>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Odbiorca</th>
                  <th>Temat</th>
                  <th style={{ textAlign: "center" }}>Próby</th>
                  <th>Błąd</th>
                  <th>Data</th>
                </tr>
              </thead>
              <tbody>
                {queue && queue.lastErrors.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <div className="empty" style={{ padding: 18 }}>Brak błędów wysyłki 🎉</div>
                    </td>
                  </tr>
                )}
                {(queue?.lastErrors || []).map((e) => (
                  <tr key={e.id}>
                    <td>{e.recipient}</td>
                    <td>{e.subject}</td>
                    <td style={{ textAlign: "center" }}>{e.attempts}</td>
                    <td className="muted-text" title={e.lastError}>
                      {e.lastError.length > 56 ? e.lastError.slice(0, 56) + "…" : e.lastError}
                    </td>
                    <td className="muted-text">{fmtDate(e.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-title">✨ Asystent AI (OpenAI / DeepSeek)
              <span className="spacer" />
              <span className="badge purple">bez klucza = tryb demo</span>
            </div>

            <label className="field" style={{ marginBottom: 12 }}>Dostawca AI
              <select className="input" value={form.ai_provider} onChange={(e) => set("ai_provider", e.target.value)}>
                <option value="auto">Auto — DeepSeek, jeśli jest klucz; inaczej OpenAI</option>
                <option value="deepseek">DeepSeek (np. deepseek-v4-flash)</option>
                <option value="openai">OpenAI (gpt-4o-mini)</option>
              </select>
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <label className="field">Klucz API OpenAI
                <input className="input" type="password" value={form.openai_key} onChange={(e) => set("openai_key", e.target.value)} placeholder={form.openai_key === "***" ? "zapisany — zostaw, aby nie zmieniać" : "sk-…"} />
              </label>
              <label className="field">Klucz API DeepSeek
                <input className="input" type="password" value={form.deepseek_key} onChange={(e) => set("deepseek_key", e.target.value)} placeholder={form.deepseek_key === "***" ? "zapisany — zostaw, aby nie zmieniać" : "sk-…"} />
              </label>
            </div>

            <label className="field" style={{ marginTop: 12 }}>Model DeepSeek
              <input className="input" value={form.deepseek_model} onChange={(e) => set("deepseek_model", e.target.value)} placeholder="deepseek-v4-flash" />
            </label>

            {aiStatus && (
              <div style={{ marginTop: 12, fontSize: 12.5, padding: "9px 12px", borderRadius: "var(--radius-sm)", background: "var(--sidebar-bg)" }}>
                {aiStatus.demo
                  ? <>⚙️ <b>Tryb demo</b> — dodaj klucz OpenAI lub DeepSeek, aby włączyć pełny asystent.</>
                  : <>✅ Aktywny dostawca: <b>{aiStatus.provider === "deepseek" ? "DeepSeek (" + (aiStatus.model || "—") + ")" : "OpenAI (" + (aiStatus.model || "—") + ")"}</b></>}
              </div>
            )}
          </div>

          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-title">🎤 Transkrypcja głosu (lokalne Whisper)
              <span className="spacer" />
              <span className="badge green">100% lokalnie</span>
            </div>
            <label className="field">Ścieżka do modelu (ggml)
              <input className="input" value={form.whisper_model_path} onChange={(e) => set("whisper_model_path", e.target.value)} />
            </label>
            <label className="field" style={{ marginTop: 10 }}>Binarka whisper-cli
              <input className="input" value={form.whisper_bin} onChange={(e) => set("whisper_bin", e.target.value)} />
            </label>
            <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>Mikrofon 🎤 w panelu Asystenta AI transkrybuje głos przez Whisper v3 large zainstalowane lokalnie — nic nie wychodzi z komputera.</p>
          </div>

          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-title">💬 WhatsApp (mostek WhatsApp Web)
              <span className="spacer" />
              <span className="badge blue">Baileys</span>
            </div>
            <label className="field">Adres mostka
              <input className="input" value={form.whatsapp_bridge_url} onChange={(e) => set("whatsapp_bridge_url", e.target.value)} placeholder="http://127.0.0.1:3001" />
            </label>
            <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
              Mostek uruchamiasz osobno (katalog ~/.hermes/hermes-agent/scripts/whatsapp-bridge, port 3001):
              <code style={{ display: "block", marginTop: 4, background: "var(--sidebar-bg)", padding: "6px 10px", borderRadius: 8 }}>node bridge.js --port 3001</code>
              Przy pierwszym starcie zaloguj się kodem QR (WhatsApp Web). Po zalogowaniu CRM może wysyłać wiadomości (także przez AI).
            </p>
          </div>

          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-title">📧 Skrzynka e-mail (IMAP)
              <span className="spacer" />
              <span className="badge green">czytanie + wysyłka</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <label className="field">Host IMAP<input className="input" value={form.imap_host} onChange={(e) => set("imap_host", e.target.value)} placeholder="imap.example.com" /></label>
              <label className="field">Port<input className="input" value={form.imap_port} onChange={(e) => set("imap_port", e.target.value)} /></label>
              <label className="field">Użytkownik<input className="input" value={form.imap_user} onChange={(e) => set("imap_user", e.target.value)} /></label>
              <label className="field">Hasło<input className="input" type="password" value={form.imap_pass} onChange={(e) => set("imap_pass", e.target.value)} placeholder={form.imap_pass === "***" ? "zapisane" : ""} /></label>
            </div>
            <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 }}>
              <input type="checkbox" checked={form.imap_secure === "true"} onChange={(e) => set("imap_secure", String(e.target.checked))} /> TLS (bezpieczne połączenie, port 993)
            </label>
          </div>

          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-title">🔎 Wyszukiwanie produktów w sieci (opcjonalne)</div>
            <label className="field">Klucz API (np. Brave Search)
              <input className="input" type="password" value={form.search_api_key} onChange={(e) => set("search_api_key", e.target.value)} placeholder={form.search_api_key === "***" ? "zapisany" : "BSA…"} />
            </label>
          </div>

          {msg && <div className="login-error" style={{ marginBottom: 14, background: msg.ok ? "var(--green-soft)" : "#fee2e2", color: msg.ok ? "#047857" : "#b91c1c" }}>{msg.text}</div>}
          <button className="btn accent" onClick={save}>Zapisz ustawienia</button>
        </>
      )}

      {/* Modal: dodaj konto */}
      {addOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) closeAdd(); }}>
          <div className="modal">
            {addResult ? (
              <>
                <h2>✅ Konto utworzone</h2>
                <p>Konto <b>{addResult.name}</b> ({addResult.email}) jest gotowe do zalogowania.</p>
                {addResult.tempPassword && (
                  <div className="pass-box">
                    <div className="pass-label">Wygenerowane hasło — przekaż je użytkownikowi:</div>
                    <div className="pass-value mono">{addResult.tempPassword}</div>
                    <button className="btn small" onClick={() => copyText(addResult.tempPassword || "")}>📋 Skopiuj</button>
                  </div>
                )}
                <div className="modal-actions">
                  <button className="btn accent" onClick={closeAdd}>Zamknij</button>
                </div>
              </>
            ) : (
              <>
                <h2>➕ Dodaj konto</h2>
                <div style={{ display: "grid", gap: 12 }}>
                  <label className="field">E-mail
                    <input className="input" type="email" value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} placeholder="imie@klinika.pl" autoFocus />
                  </label>
                  <label className="field">Imię i nazwisko
                    <input className="input" value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} placeholder="Jan Kowalski" />
                  </label>
                  <label className="field">Rola
                    <select className="input" value={addForm.role} onChange={(e) => setAddForm({ ...addForm, role: e.target.value as AccountUser["role"] })}>
                      <option value="member">Członek zespołu</option>
                      <option value="manager">Manager</option>
                      <option value="admin">Administrator</option>
                    </select>
                  </label>
                  <label className="field">Hasło
                    <span style={{ fontWeight: 400, fontSize: 12 }}>(opcjonalne — puste = serwer wygeneruje)</span>
                    <input className="input" type="password" value={addForm.password} onChange={(e) => setAddForm({ ...addForm, password: e.target.value })} placeholder="min. 6 znaków lub zostaw puste" autoComplete="new-password" />
                  </label>
                </div>
                {addErr && <div className="login-error" style={{ marginTop: 12 }}>⚠️ {addErr}</div>}
                <div className="modal-actions">
                  <button className="btn ghost" onClick={closeAdd}>Anuluj</button>
                  <button className="btn accent" disabled={addBusy} onClick={submitAdd}>
                    {addBusy ? "Tworzenie…" : "Utwórz konto"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Modal: reset hasła */}
      {resetPw && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setResetPw(null); }}>
          <div className="modal">
            <h2>🔑 Resetowanie hasła</h2>
            <p>Nowe hasło dla konta <b>{resetPw.user.name}</b> ({resetPw.user.email}):</p>
            <div className="pass-box">
              <div className="pass-label">Wygenerowane hasło — przekaż je użytkownikowi:</div>
              <div className="pass-value mono">{resetPw.tempPassword}</div>
              <button className="btn small" onClick={() => copyText(resetPw.tempPassword)}>📋 Skopiuj</button>
            </div>
            <p style={{ marginTop: 10 }} className="muted-text">Po zalogowaniu użytkownik może zmienić hasło w Ustawieniach (Zmień hasło).</p>
            <div className="modal-actions">
              <button className="btn accent" onClick={() => setResetPw(null)}>Zamknij</button>
            </div>
          </div>
        </div>
      )}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={"toast " + (t.ok ? "ok" : "err")}>{t.text}</div>
        ))}
      </div>
    </div>
  );
}
