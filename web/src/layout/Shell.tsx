import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate, Link } from "react-router-dom";
import { useApp } from "../store";
import Avatar from "../components/Avatar";
import AiPanel from "../components/AiPanel";
import { connectSocket, disconnectSocket } from "../socket";

const NAV = [
  { to: "/", label: "Pulpit", emoji: "🏠", end: true },
  { to: "/projekty", label: "Projekty", emoji: "📁" },
  { to: "/zadania", label: "Zadania", emoji: "✅" },
  { to: "/kalendarz", label: "Kalendarz", emoji: "📅" },
  { to: "/poczta", label: "Poczta", emoji: "📧" },
  { to: "/whatsapp", label: "WhatsApp", emoji: "📱" },
  { to: "/komunikator", label: "Komunikator", emoji: "💬" },
  { to: "/tabele", label: "Tabele", emoji: "📊" },
  { to: "/dokumenty", label: "Dokumenty", emoji: "📄" },
  { to: "/inwentarz", label: "Inwentarz", emoji: "📦" },
  { to: "/koszyki", label: "Koszyki", emoji: "🛒" },
  { to: "/ai", label: "Asystent AI", emoji: "✨", ai: true },
];

const TITLES: Record<string, string> = {
  "/": "Pulpit", "/projekty": "Projekty", "/zadania": "Zadania",
  "/komunikator": "Komunikator", "/tabele": "Tabele", "/dokumenty": "Dokumenty",
  "/inwentarz": "Inwentarz", "/koszyki": "Koszyki", "/zamowienia": "Zamówienia", "/kalendarz": "Kalendarz", "/poczta": "Poczta", "/whatsapp": "WhatsApp",
  "/ai": "Asystent AI", "/ustawienia": "Ustawienia",
};

export default function Shell() {
  const user = useApp((s) => s.user)!;
  const logout = useApp((s) => s.logout);
  const unreadCount = useApp((s) => s.unreadCount);
  const mailUnread = useApp((s) => s.mailUnread);
  const refreshMailUnread = useApp((s) => s.refreshMailUnread);
  const navigate = useNavigate();
  const [aiOpen, setAiOpen] = useState(true);

  useEffect(() => {
    connectSocket();
    refreshMailUnread();
    const t = setInterval(() => refreshMailUnread(), 60000);
    return () => { disconnectSocket(); clearInterval(t); };
  }, []);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="logo">
          <span className="glyph">🩺</span>
          <span className="txt">Klinika CRM</span>
        </div>
        <nav className="side-nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => `nav-item ${isActive ? "active" : ""} ${n.ai ? "ai" : ""}`}>
              <span className="emoji">{n.emoji}</span>
              <span className="lbl">{n.label}</span>
              {n.to === "/poczta" && mailUnread > 0 && <span className="cnt">{mailUnread > 99 ? "99+" : mailUnread}</span>}
            </NavLink>
          ))}
          <div className="nav-sep">Przestrzeń</div>
          <NavLink to="/ustawienia" className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
            <span className="emoji">⚙️</span><span className="lbl">Ustawienia</span>
          </NavLink>
        </nav>
        <div className="sidebar-user">
          <Avatar name={user.name} color={user.avatarColor} size={30} />
          <div className="meta"><b>{user.name}</b><span>{roleLabel(user.role)}</span></div>
          <button className="bell" title="Wyloguj" onClick={async () => { await logout(); navigate("/"); }}>
            🚪
          </button>
        </div>
      </aside>
      <main className="main">
        <div className="topbar">
          <h1>{TITLES[location.pathname] || "Klinika CRM"}</h1>
          <div className="search-box">🔍 <input placeholder="Szukaj zadań, projektów, produktów…" /></div>
          <div style={{ flex: 1 }} />
          <button className="bell" onClick={() => navigate("/komunikator")} title="Komunikator">
            🔔{unreadCount > 0 && <span className="bell-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>}
          </button>
          <button className="bell" onClick={() => setAiOpen((o) => !o)} title={aiOpen ? "Zwiń Asystenta AI" : "Otwórz Asystenta AI"}>
            🤖{aiOpen ? "" : <span className="bell-badge ai">AI</span>}
          </button>
          <Link to="/projekty"><button className="btn accent">＋ Nowy projekt</button></Link>
        </div>
        <div className="content">
          <Outlet />
        </div>
      </main>
      <AiPanel open={aiOpen} onClose={() => setAiOpen(false)} />
    </div>
  );
}

function roleLabel(role: string): string {
  if (role === "admin") return "Administrator";
  if (role === "manager") return "Manager";
  return "Członek zespołu";
}
