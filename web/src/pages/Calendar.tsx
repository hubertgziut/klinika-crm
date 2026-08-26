import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import Toasts from "../components/Toasts";
import { pushToast } from "../toast";

interface CalEvent {
  id: string; title: string; type: string; typeLabel: string; color: string;
  startAt: string; endAt: string; allDay: boolean; location: string; notes: string;
  projectId: string | null; projectName: string | null;
  participants: { id: string; name: string; avatarColor: string; notifyMinutes: number }[];
  isParticipant: boolean;
}
interface UserLite { id: string; name: string; email: string }

const TYPES = [
  { id: "dyzur", label: "Dyżur", color: "#0ea5e9" },
  { id: "spotkanie", label: "Spotkanie", color: "#8b5cf6" },
  { id: "wizyta", label: "Wizyta", color: "#10b981" },
  { id: "zadanie", label: "Zadanie", color: "#f59e0b" },
  { id: "zamowienie", label: "Zamówienie", color: "#ff6b5e" },
  { id: "inne", label: "Inne", color: "#94a3b8" },
];
const DOW = ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Nd"];
const MONTHS = ["styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"];

const EMPTY_FORM = {
  title: "", type: "inne", startAt: "", endAt: "", allDay: false,
  location: "", notes: "", projectId: "", participantIds: [] as string[], notifyMinutes: 15,
};

export default function CalendarPage() {
  const [ym, setYm] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [upcoming, setUpcoming] = useState<CalEvent[]>([]);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [modal, setModal] = useState<{ open: boolean; editing: CalEvent | null; presetDate?: string }>({ open: false, editing: null });
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  const range = useMemo(() => {
    const first = new Date(ym.y, ym.m, 1);
    const start = new Date(first);
    start.setDate(1 - ((first.getDay() + 6) % 7)); // poniedziałek jako pierwszy
    const end = new Date(start); end.setDate(start.getDate() + 41);
    return { from: start.toISOString(), to: end.toISOString() };
  }, [ym]);

  useEffect(() => {
    api.get<CalEvent[]>(`/api/calendar?from=${range.from}&to=${range.to}`).then(setEvents).catch(() => {});
    api.get<CalEvent[]>("/api/calendar/upcoming").then(setUpcoming).catch(() => {});
  }, [range]);

  useEffect(() => {
    api.get<UserLite[]>("/api/users").then(setUsers).catch(() => {});
    api.get<any[]>("/api/projects").then(setProjects).catch(() => {});
  }, []);

  function openNew(date?: Date) {
    const iso = (d: Date) => d.toISOString().slice(0, 16);
    const base = date || new Date();
    setForm({ ...EMPTY_FORM, startAt: iso(base), endAt: iso(new Date(base.getTime() + 3600e3)) });
    setModal({ open: true, editing: null, presetDate: iso(date || new Date()) });
  }
  function openEdit(ev: CalEvent) {
    setForm({
      title: ev.title, type: ev.type, startAt: ev.startAt.slice(0, 16), endAt: (ev.endAt || ev.startAt).slice(0, 16),
      allDay: ev.allDay, location: ev.location || "", notes: ev.notes || "",
      projectId: ev.projectId || "", participantIds: ev.participants.map((p) => p.id), notifyMinutes: ev.participants[0]?.notifyMinutes || 15,
    });
    setModal({ open: true, editing: ev });
  }

  async function save() {
    if (!form.title.trim() || !form.startAt) { pushToast(false, "Podaj tytuł i datę"); return; }
    setBusy(true);
    try {
      const body: any = {
        title: form.title, type: form.type, startAt: new Date(form.startAt).toISOString(),
        endAt: form.endAt ? new Date(form.endAt).toISOString() : undefined,
        allDay: form.allDay, location: form.location, notes: form.notes,
        projectId: form.projectId || null, participantIds: form.participantIds, notifyMinutes: form.notifyMinutes,
      };
      if (modal.editing) await api.patch(`/api/calendar/${modal.editing.id}`, body);
      else await api.post("/api/calendar", body);
      pushToast(true, modal.editing ? "Wydarzenie zaktualizowane" : "Wydarzenie dodane");
      setModal({ open: false, editing: null });
      api.get<CalEvent[]>(`/api/calendar?from=${range.from}&to=${range.to}`).then(setEvents).catch(() => {});
      api.get<CalEvent[]>("/api/calendar/upcoming").then(setUpcoming).catch(() => {});
    } catch (e: any) { pushToast(false, e?.message || "Błąd zapisu"); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!modal.editing) return;
    if (!window.confirm("Usunąć wydarzenie?")) return;
    try {
      await api.del(`/api/calendar/${modal.editing.id}`);
      pushToast(true, "Wydarzenie usunięte");
      setModal({ open: false, editing: null });
      api.get<CalEvent[]>(`/api/calendar?from=${range.from}&to=${range.to}`).then(setEvents).catch(() => {});
      api.get<CalEvent[]>("/api/calendar/upcoming").then(setUpcoming).catch(() => {});
    } catch (e: any) { pushToast(false, e?.message || "Błąd"); }
  }

  function toggleUser(id: string) {
    setForm((f) => ({ ...f, participantIds: f.participantIds.includes(id) ? f.participantIds.filter((x) => x !== id) : [...f.participantIds, id] }));
  }

  // Siatka miesiąca
  const cells = useMemo(() => {
    const start = new Date(range.from);
    const out: { date: Date; events: CalEvent[] }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      out.push({ date: d, events: events.filter((e) => e.startAt.slice(0, 10) === iso || e.endAt?.slice(0, 10) === iso) });
    }
    return out;
  }, [range, events]);

  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div className="page" style={{ maxWidth: 1200 }}>
      <div className="page-head">
        <h1>📅 Kalendarz</h1>
        <span className="sub">Dyżury, spotkania, wizyty, zadania, zamówienia — z przypomnieniami</span>
        <div className="spacer" />
        <button className="btn ghost small" onClick={() => { const d = new Date(); setYm({ y: d.getFullYear(), m: d.getMonth() }); }}>Dziś</button>
        <button className="btn ghost small" onClick={() => setYm((s) => { const m = new Date(s.y, s.m - 1, 1); return { y: m.getFullYear(), m: m.getMonth() }; })}>‹</button>
        <button className="btn ghost small" onClick={() => setYm((s) => { const m = new Date(s.y, s.m + 1, 1); return { y: m.getFullYear(), m: m.getMonth() }; })}>›</button>
        <span style={{ fontWeight: 800, minWidth: 150 }}>{MONTHS[ym.m]} {ym.y}</span>
        <button className="btn accent" onClick={() => openNew(new Date())}>＋ Wydarzenie</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16, alignItems: "start" }}>
        <div className="panel" style={{ padding: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 6 }}>
            {DOW.map((d) => <div key={d} style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: "var(--muted)", padding: 4 }}>{d}</div>)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
            {cells.map((c, i) => {
              const iso = c.date.toISOString().slice(0, 10);
              const isToday = iso === todayIso;
              const otherMonth = c.date.getMonth() !== ym.m;
              return (
                <div key={i} onClick={() => openNew(c.date)}
                  style={{ minHeight: 86, border: "1px solid var(--border)", borderRadius: 10, padding: 5, cursor: "pointer",
                    background: isToday ? "var(--accent-soft)" : otherMonth ? "var(--sidebar-bg)" : "#fff" }}>
                  <div style={{ fontSize: 11, fontWeight: isToday ? 800 : 600, color: isToday ? "var(--accent-text)" : otherMonth ? "var(--muted)" : "var(--text)" }}>{c.date.getDate()}</div>
                  {c.events.slice(0, 3).map((e) => (
                    <div key={e.id} onClick={(ev) => { ev.stopPropagation(); openEdit(e); }}
                      title={e.title + (e.location ? " · " + e.location : "")}
                      style={{ fontSize: 10.5, fontWeight: 600, color: "#fff", background: e.color, borderRadius: 6, padding: "2px 5px", marginTop: 3, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                      {e.allDay ? "• " : ""}{e.startAt.slice(11, 16)} {e.title}
                    </div>
                  ))}
                  {c.events.length > 3 && <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>+{c.events.length - 3} więcej</div>}
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">⏰ Nadchodzące <span className="spacer" /></div>
          {upcoming.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13 }}>Brak nadchodzących wydarzeń.</div>}
          {upcoming.slice(0, 8).map((e) => (
            <div key={e.id} onClick={() => openEdit(e)} style={{ cursor: "pointer", display: "flex", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
              <span style={{ width: 8, height: 8, borderRadius: 50, background: e.color, marginTop: 5, flex: "0 0 auto" }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 12.5 }}>{e.title}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                  {e.startAt.slice(8, 10)}.{e.startAt.slice(5, 7)} {e.startAt.slice(11, 16)}
                  {e.location ? " · 📍 " + e.location : ""} · {e.typeLabel}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {modal.open && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setModal({ open: false, editing: null }); }}>
          <div className="modal" style={{ maxWidth: 560 }}>
            <h2>{modal.editing ? "✏️ Edytuj wydarzenie" : "＋ Nowe wydarzenie"}</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label className="field">Tytuł <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="np. Dyżur recepcji" /></label>
              <div className="row">
                <label className="field">Typ
                  <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                    {TYPES.map((t) => <option key={t.id} value={t.id}>● {t.label}</option>)}
                  </select>
                </label>
                <label className="field">Projekt
                  <select className="input" value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
                    <option value="">— brak —</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>)}
                  </select>
                </label>
              </div>
              <div className="row">
                <label className="field">Start <input className="input" type="datetime-local" value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} /></label>
                <label className="field">Koniec <input className="input" type="datetime-local" value={form.endAt} onChange={(e) => setForm({ ...form, endAt: e.target.value })} /></label>
              </div>
              <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={form.allDay} onChange={(e) => setForm({ ...form, allDay: e.target.checked })} /> Cały dzień
              </label>
              <label className="field">Miejsce <input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="np. Recepcja, online…" /></label>
              <label className="field">Notatki <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
              <label className="field">Przypomnienie
                <select className="input" value={form.notifyMinutes} onChange={(e) => setForm({ ...form, notifyMinutes: Number(e.target.value) })}>
                  <option value={5}>5 min przed</option><option value={15}>15 min przed</option>
                  <option value={30}>30 min przed</option><option value={60}>1 godz. przed</option>
                  <option value={1440}>1 dzień przed</option>
                </select>
              </label>
              <label className="field">Uczestnicy (powiadomienia)
                <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 130, overflow: "auto", border: "1px solid var(--border)", borderRadius: 10, padding: 8 }}>
                  {users.map((u) => (
                    <label key={u.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, cursor: "pointer" }}>
                      <input type="checkbox" checked={form.participantIds.includes(u.id)} onChange={() => toggleUser(u.id)} /> {u.name} <span style={{ color: "var(--muted)", fontSize: 11 }}>({u.email})</span>
                    </label>
                  ))}
                </div>
              </label>
              <div className="modal-actions" style={{ display: "flex", gap: 10, marginTop: 4 }}>
                {modal.editing && <button className="btn" style={{ background: "#fee2e2", color: "#b91c1c" }} onClick={remove}>🗑 Usuń</button>}
                <span style={{ flex: 1 }} />
                <button className="btn ghost" onClick={() => setModal({ open: false, editing: null })}>Anuluj</button>
                <button className="btn accent" onClick={save} disabled={busy}>{busy ? "Zapisuję…" : "Zapisz"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
      <Toasts />
    </div>
  );
}
