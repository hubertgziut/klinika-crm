import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import Toasts from "../components/Toasts";
import { fmtDate } from "../lib";
import { pushToast } from "../toast";
import type { DocSummary, Project } from "../types";

export default function Docs() {
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get("project");
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = projectId ? "/api/documents?project_id=" + encodeURIComponent(projectId) : "/api/documents";
      setDocs(await api.get<DocSummary[]>(url));
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się pobrać dokumentów");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get<Project[]>("/api/projects").then(setProjects).catch(() => {}); }, []);

  async function removeDoc(d: DocSummary) {
    if (!window.confirm("Usunąć dokument „" + d.title + "?\nZałączniki również zostaną usunięte.")) return;
    try {
      await api.del("/api/documents/" + d.id);
      pushToast(true, "Dokument usunięty");
      load();
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się usunąć dokumentu");
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Dokumenty</h1>
        <span className="sub">Wspólne notatki i dokumentacja zespołu</span>
        <span className="spacer" />
        <button className="btn accent" onClick={() => setShowModal(true)}>＋ Dokument</button>
      </div>

      {loading ? (
        <div className="empty"><div className="big">📄</div><p>Ładowanie…</p></div>
      ) : docs.length === 0 ? (
        <div className="panel">
          <div className="empty">
            <div className="big">🗒️</div>
            <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 15 }}>Brak dokumentów</div>
            <p style={{ marginTop: 6 }}>Utwórz pierwszy dokument, aby zacząć dokumentować pracę zespołu.</p>
            <button className="btn accent" style={{ marginTop: 14 }} onClick={() => setShowModal(true)}>＋ Dokument</button>
          </div>
        </div>
      ) : (
        <div className="panel" style={{ padding: "6px 0" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Tytuł</th>
                <th>Projekt</th>
                <th>Ostatnio edytował</th>
                <th>Zmiana</th>
                <th style={{ width: 60 }} />
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td><Link to={"/dokumenty/" + d.id} style={{ fontWeight: 700 }}>📄 {d.title}</Link></td>
                  <td className="muted-text">{d.projectName ?? "—"}</td>
                  <td>{d.updatedByName ?? "—"}</td>
                  <td className="muted-text">{fmtDate(d.updatedAt)}</td>
                  <td>
                    <button className="btn small danger" title="Usuń dokument" aria-label="Usuń dokument" onClick={() => removeDoc(d)}>🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <DocFormModal
          projects={projects}
          defaultProjectId={projectId}
          onClose={() => setShowModal(false)}
          onCreated={(d) => { setShowModal(false); navigate("/dokumenty/" + d.id); }}
        />
      )}
      <Toasts />
    </div>
  );
}

function DocFormModal({ projects, defaultProjectId, onClose, onCreated }: {
  projects: Project[];
  defaultProjectId: string | null;
  onClose: () => void;
  onCreated: (d: DocSummary) => void;
}) {
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState(defaultProjectId ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    setErr("");
    if (!title.trim()) { setErr("Podaj tytuł dokumentu"); return; }
    setBusy(true);
    try {
      const res = await api.post<{ document: DocSummary }>("/api/documents", {
        title: title.trim(),
        projectId: projectId || null,
      });
      onCreated(res.document);
    } catch (e: any) {
      setErr(e?.message || "Nie udało się utworzyć dokumentu");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h2>＋ Nowy dokument</h2>
        <div style={{ display: "grid", gap: 12 }}>
          <label className="field">
            Tytuł
            <input className="input" value={title} autoFocus maxLength={300} placeholder="np. Procedura rejestracji pacjenta"
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
          </label>
          <label className="field">
            Projekt (opcjonalnie)
            <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">— bez projektu —</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>)}
            </select>
          </label>
        </div>
        {err && <div className="login-error" style={{ marginTop: 12 }}>⚠️ {err}</div>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>Anuluj</button>
          <button className="btn accent" disabled={busy} onClick={submit}>
            {busy ? "Tworzenie…" : "Utwórz dokument"}
          </button>
        </div>
      </div>
    </div>
  );
}
