import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import Toasts from "../components/Toasts";
import { fmtDate } from "../lib";
import { pushToast } from "../toast";
import type { Project, TableSummary } from "../types";

export default function Tables() {
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get("project");
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = projectId ? "/api/tables?project_id=" + encodeURIComponent(projectId) : "/api/tables";
      setTables(await api.get<TableSummary[]>(url));
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się pobrać tabel");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get<Project[]>("/api/projects").then(setProjects).catch(() => {}); }, []);

  async function removeTable(t: TableSummary) {
    if (!window.confirm("Usunąć tabelę „" + t.name + "?\nWszystkie wiersze zostaną usunięte.")) return;
    try {
      await api.del("/api/tables/" + t.id);
      pushToast(true, "Tabela usunięta");
      load();
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się usunąć tabeli");
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Tabele</h1>
        <span className="sub">Arkusze z formułami i eksportem CSV</span>
        <span className="spacer" />
        <button className="btn accent" onClick={() => setShowModal(true)}>＋ Nowa tabela</button>
      </div>

      {loading ? (
        <div className="empty"><div className="big">📊</div><p>Ładowanie…</p></div>
      ) : tables.length === 0 ? (
        <div className="panel">
          <div className="empty">
            <div className="big">📋</div>
            <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 15 }}>Brak tabel</div>
            <p style={{ marginTop: 6 }}>Utwórz pierwszą tabelę, aby zacząć porządkować dane kliniki.</p>
            <button className="btn accent" style={{ marginTop: 14 }} onClick={() => setShowModal(true)}>＋ Nowa tabela</button>
          </div>
        </div>
      ) : (
        <div className="panel" style={{ padding: "6px 0" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Nazwa</th>
                <th>Wiersze</th>
                <th>Kolumny</th>
                <th>Ostatnia zmiana</th>
                <th style={{ width: 60 }} />
              </tr>
            </thead>
            <tbody>
              {tables.map((t) => (
                <tr key={t.id}>
                  <td><Link to={"/tabele/" + t.id} style={{ fontWeight: 700 }}>📊 {t.name}</Link></td>
                  <td>{t.rowCount}</td>
                  <td>{t.colCount}</td>
                  <td className="muted-text">{fmtDate(t.updatedAt)}</td>
                  <td>
                    <button className="btn small danger" title="Usuń tabelę" aria-label="Usuń tabelę" onClick={() => removeTable(t)}>🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <TableFormModal
          projects={projects}
          defaultProjectId={projectId}
          onClose={() => setShowModal(false)}
          onCreated={(t) => { setShowModal(false); navigate("/tabele/" + t.id); }}
        />
      )}
      <Toasts />
    </div>
  );
}

function TableFormModal({ projects, defaultProjectId, onClose, onCreated }: {
  projects: Project[];
  defaultProjectId: string | null;
  onClose: () => void;
  onCreated: (t: TableSummary) => void;
}) {
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState(defaultProjectId ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    setErr("");
    if (!name.trim()) { setErr("Podaj nazwę tabeli"); return; }
    setBusy(true);
    try {
      const res = await api.post<{ table: TableSummary }>("/api/tables", {
        name: name.trim(),
        projectId: projectId || null,
      });
      onCreated(res.table);
    } catch (e: any) {
      setErr(e?.message || "Nie udało się utworzyć tabeli");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h2>＋ Nowa tabela</h2>
        <div style={{ display: "grid", gap: 12 }}>
          <label className="field">
            Nazwa
            <input className="input" value={name} autoFocus maxLength={120} placeholder="np. Inwentarz sprzętu"
              onChange={(e) => setName(e.target.value)}
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
            {busy ? "Tworzenie…" : "Utwórz tabelę"}
          </button>
        </div>
      </div>
    </div>
  );
}
