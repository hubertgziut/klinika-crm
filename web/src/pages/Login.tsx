import { useState, type FormEvent } from "react";
import { useApp } from "../store";

export default function Login() {
  const login = useApp((s) => s.login);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err?.message || "Nie udało się zalogować");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">
          <span className="glyph">🩺</span>
          <span>Klinika CRM</span>
        </div>
        <p style={{ color: "var(--muted)", fontSize: 13.5, lineHeight: 1.5 }}>
          Zaloguj się do przestrzeni pracy zespołu kliniki.
        </p>
        <form onSubmit={onSubmit}>
          <label className="field">
            E-mail
            <input className="input" type="email" required autoFocus value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="imie@klinika.pl" />
          </label>
          <label className="field">
            Hasło
            <input className="input" type="password" required value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </label>
          {error && <div className="login-error">⚠️ {error}</div>}
          <button className="btn accent block" disabled={busy}>
            {busy ? "Logowanie…" : "Zaloguj się"}
          </button>
        </form>
        <p className="hint">
          Pierwsze logowanie: konto administratora zdefiniowane w pliku <b>.env</b>
          (ADMIN_EMAIL / ADMIN_PASSWORD). Konta zespołu zakłada administrator w Ustawieniach.
        </p>
      </div>
    </div>
  );
}
