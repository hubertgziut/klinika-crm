import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { PROJECT_COLORS, PROJECT_EMOJIS } from "../lib";
import Toasts from "../components/Toasts";
import type { Project } from "../types";

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const navigate = useNavigate();

  async function load() {
    setLoading(true);
    try {
      setProjects(await api.get<Project[]>("/api/projects"));
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Projekty</h1>
        <span className="sub">Gałęzie, zadania i osie czasu zespołu</span>
        <span className="spacer" />
        <button className="btn accent" onClick={() => setShowModal(true)}>＋ Nowy projekt</button>
      </div>

      {loading ? (
        <div className="empty"><div className="big">📂</div><p>Ładowanie…</p></div>
      ) : projects.length === 0 ? (
        <div className="panel">
          <div className="empty">
            <div className="big">🗂️</div>
            <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 15 }}>Brak projektów</div>
            <p style={{ marginTop: 6 }}>Utwórz pierwszy projekt, aby zacząć planować pracę zespołu.</p>
            <button className="btn accent" style={{ marginTop: 14 }} onClick={() => setShowModal(true)}>＋ Nowy projekt</button>
          </div>
        </div>
      ) : (
        <div className="project-grid">
          {projects.map((p) => {
            const done = p.doneCount;
            const total = p.taskCount;
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            return (
              <Link key={p.id} to={"/projekty/" + p.id} style={{ textDecoration: "none", color: "inherit" }}>
                <div className="project-card" style={{ ["--pcolor" as string]: p.color }}>
                  <div className="pc-emoji">{p.emoji}</div>
                  <div className="pc-name">{p.name}</div>
                  {p.description && <div className="pc-desc">{p.description}</div>}
                  <div className="pc-meta">
                    <span>✅ {done}/{total} zadań</span>
                    <span>🌿 {p.branchCount} gałęzi</span>
                  </div>
                  <div className="progress"><div style={{ width: pct + "%" }} /></div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {showModal && <ProjectFormModal onClose={() => setShowModal(false)} onCreated={(p) => { setShowModal(false); navigate("/projekty/" + p.id); }} />}
      <Toasts />
    </div>
  );
}

function ProjectFormModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Project) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [emoji, setEmoji] = useState("📁");
  const [color, setColor] = useState(PROJECT_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    setErr("");
    if (!name.trim()) { setErr("Podaj nazwę projektu"); return; }
    setBusy(true);
    try {
      const res = await api.post<{ project: Project }>("/api/projects", {
        name: name.trim(), description, emoji, color,
      });
      onCreated(res.project);
    } catch (e: any) {
      setErr(e?.message || "Nie udało się utworzyć projektu");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h2>＋ Nowy projekt</h2>
        <div style={{ display: "grid", gap: 12 }}>
          <label className="field">
            Nazwa
            <input className="input" value={name} autoFocus maxLength={120} placeholder="np. Zakupy do pralni"
              onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            Opis
            <textarea className="input" rows={2} value={description} placeholder="Krótki opis (opcjonalnie)"
              onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label className="field">
            Emoji
            <div className="emoji-picker">
              {PROJECT_EMOJIS.map((e) => (
                <button key={e} type="button"
                  className={"emoji-opt" + (emoji === e ? " active" : "")}
                  onClick={() => setEmoji(e)}>{e}</button>
              ))}
            </div>
          </label>
          <label className="field">
            Kolor
            <div className="color-picker">
              {PROJECT_COLORS.map((c) => (
                <button key={c} type="button"
                  className={"color-opt" + (color === c ? " active" : "")}
                  style={{ background: c }}
                  onClick={() => setColor(c)} aria-label={c} />
              ))}
            </div>
          </label>
        </div>
        {err && <div className="login-error" style={{ marginTop: 12 }}>⚠️ {err}</div>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>Anuluj</button>
          <button className="btn accent" disabled={busy} onClick={submit}>
            {busy ? "Tworzenie…" : "Utwórz projekt"}
          </button>
        </div>
      </div>
    </div>
  );
}
