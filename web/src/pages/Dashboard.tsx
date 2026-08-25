import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../store";

interface SettingsPublic { clinic_name?: string; clinic_emoji?: string }

export default function Dashboard() {
  const user = useApp((s) => s.user)!;
  const [settings, setSettings] = useState<SettingsPublic>({});
  useEffect(() => {
    api.get<SettingsPublic>("/api/settings").then(setSettings).catch(() => {});
  }, []);

  const modules = [
    { to: "/projekty", emoji: "📁", label: "Projekty", desc: "Gałęzie, zadania, osie czasu" },
    { to: "/zadania", emoji: "✅", label: "Zadania", desc: "Tablica kanban całego zespołu" },
    { to: "/komunikator", emoji: "💬", label: "Komunikator", desc: "Czaty kanałowe i prywatne" },
    { to: "/tabele", emoji: "📊", label: "Tabele", desc: "Arkusze jak w Excelu" },
    { to: "/dokumenty", emoji: "📄", label: "Dokumenty", desc: "Edytor jak w Wordzie" },
    { to: "/inwentarz", emoji: "📦", label: "Inwentarz", desc: "Stany magazynowe kliniki" },
    { to: "/koszyki", emoji: "🛒", label: "Koszyki", desc: "Zakupy z linkami do hurtowni" },
    { to: "/ai", emoji: "✨", label: "Asystent AI", desc: "Pytania, produkty, porządkowanie" },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>Cześć, {user.name.split(" ")[0]}! 👋</h1>
        <span className="sub">{settings.clinic_emoji || "🩺"} {settings.clinic_name || "Klinika"} — Twoja przestrzeń pracy</span>
      </div>
      <div className="grid-stats">
        <div className="stat"><div className="st-label">📌 Otwarte zadania</div><div className="st-value">—</div><div className="st-sub">moduł zadań w budowie</div></div>
        <div className="stat"><div className="st-label">📁 Aktywne projekty</div><div className="st-value">—</div><div className="st-sub">moduł projektów w budowie</div></div>
        <div className="stat"><div className="st-label">🛒 Koszyki</div><div className="st-value">—</div><div className="st-sub">moduł zakupów w budowie</div></div>
        <div className="stat"><div className="st-label">📦 Inwentarz</div><div className="st-value">—</div><div className="st-sub">moduł magazynu w budowie</div></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 14 }}>
        {modules.map((m) => (
          <Link key={m.to} to={m.to} style={{ textDecoration: "none", color: "inherit" }}>
            <div className="panel" style={{ height: "100%", transition: "transform .12s, box-shadow .12s" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; (e.currentTarget as HTMLElement).style.boxShadow = "var(--shadow-lg)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = "none"; (e.currentTarget as HTMLElement).style.boxShadow = "var(--shadow)"; }}>
              <div style={{ fontSize: 30 }}>{m.emoji}</div>
              <div style={{ fontWeight: 800, marginTop: 6 }}>{m.label}</div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{m.desc}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
