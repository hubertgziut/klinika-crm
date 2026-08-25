export default function Placeholder({ title, emoji }: { title: string; emoji: string }) {
  return (
    <div className="page">
      <div className="page-head"><h1>{title}</h1></div>
      <div className="panel">
        <div className="empty">
          <div className="big">{emoji}</div>
          <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 15 }}>Moduł w budowie</div>
          <p style={{ marginTop: 6 }}>Ten moduł pojawi się w kolejnej fazie prac nad Klinika CRM.</p>
        </div>
      </div>
    </div>
  );
}
