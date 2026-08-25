import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import Spreadsheet from "../components/Spreadsheet";
import Toasts from "../components/Toasts";
import { pushToast } from "../toast";
import type { TableFull } from "../types";

export default function TablePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [table, setTable] = useState<TableFull | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setTable(await api.get<{ table: TableFull }>("/api/tables/" + id).then((r) => r.table));
    } catch (e: any) {
      pushToast(false, e?.message || "Nie znaleziono tabeli");
      setMissing(true);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (missing) {
    return (
      <div className="page">
        <Link to="/tabele" className="back-link">← Tabele</Link>
        <div className="panel" style={{ marginTop: 14 }}>
          <div className="empty"><div className="big">📊</div><p>Nie znaleziono tabeli.</p></div>
        </div>
        <Toasts />
      </div>
    );
  }

  if (!table) {
    return <div className="page"><div className="empty"><div className="big">📊</div><p>Ładowanie…</p></div></div>;
  }

  return (
    <div className="page ss-page">
      <div className="page-head" style={{ marginBottom: 12 }}>
        <Link to="/tabele" className="back-link">← Tabele</Link>
        <span className="spacer" />
      </div>
      <Spreadsheet key={table.id} initial={table} onDeleted={() => navigate("/tabele")} />
      <Toasts />
    </div>
  );
}
