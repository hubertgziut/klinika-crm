import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { pushToast } from "../toast";
import type { ColumnType, TableColumn, TableFull, TableRowData } from "../types";

// ===== Arkusz (Faza 4): siatka, typy, formuły =SUM(A1:A5), eksport CSV, autosave =====

interface Props {
  initial: TableFull;
  onDeleted: () => void;
}

interface CellPos {
  r: number;
  c: number;
}

const FORMULA_FNS = ["SUM", "AVG", "MIN", "MAX", "COUNT"] as const;

export default function Spreadsheet({ initial, onDeleted }: Props) {
  const [table, setTable] = useState<TableFull>(initial);
  const [editing, setEditing] = useState<CellPos | null>(null);
  const [draft, setDraft] = useState("");
  const [colEditor, setColEditor] = useState<{ c: number; label: string; type: ColumnType } | null>(null);
  const [saving, setSaving] = useState(false);
  const [organizing, setOrganizing] = useState(false);

  const pendingRef = useRef<Record<string, Record<string, string>>>({});
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const suppressBlurRef = useRef(false);
  const tableIdRef = useRef(table.id);
  tableIdRef.current = table.id;

  // reset stanu przy przejściu na inną tabelę
  useEffect(() => {
    setTable(initial);
    setEditing(null);
    setColEditor(null);
  }, [initial.id]);

  // ===== Autosave (debounce 400 ms na wiersz, optymistycznie) =====
  const flushRow = useCallback(async (rowId: string) => {
    const cells = pendingRef.current[rowId];
    if (!cells || Object.keys(cells).length === 0) return;
    delete pendingRef.current[rowId];
    delete timersRef.current[rowId];
    setSaving(true);
    try {
      const res = await api.patch<{ row: TableRowData }>(
        "/api/tables/" + tableIdRef.current + "/rows/" + rowId, { cells }
      );
      setTable((prev) => ({ ...prev, rows: prev.rows.map((rr) => rr.id === rowId ? res.row : rr) }));
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się zapisać zmian");
    } finally {
      setSaving(false);
    }
  }, []);

  const queueSave = useCallback((rowId: string, colKey: string, value: string) => {
    pendingRef.current[rowId] = { ...(pendingRef.current[rowId] ?? {}), [colKey]: value };
    if (timersRef.current[rowId]) clearTimeout(timersRef.current[rowId]);
    timersRef.current[rowId] = setTimeout(() => { flushRow(rowId); }, 400);
  }, [flushRow]);

  // dopisz zaległe zmiany przy opuszczeniu strony
  useEffect(() => {
    return () => {
      for (const rowId of Object.keys(pendingRef.current)) {
        const cells = pendingRef.current[rowId];
        if (cells && Object.keys(cells).length > 0) {
          api.patch("/api/tables/" + tableIdRef.current + "/rows/" + rowId, { cells }).catch(() => {});
        }
      }
    };
  }, []);

  // ===== Zatwierdzenie komórki (optymistyczne) + nawigacja =====
  function commitCell(r: number, c: number, value: string, move?: { dr: number; dc: number }) {
    const col = table.columns[c];
    const row = table.rows[r];
    if (!col || !row) { setEditing(null); return; }
    const prev = row.cells[col.key] ?? "";
    if (prev !== value) {
      const nextRows = table.rows.map((rr, i) =>
        i === r ? { ...rr, cells: { ...rr.cells, [col.key]: value } } : rr
      );
      setTable((prevTable) => ({ ...prevTable, rows: nextRows }));
      queueSave(row.id, col.key, value);
    }
    if (move) {
      const nr = Math.max(0, Math.min(r + move.dr, table.rows.length - 1));
      const nc = Math.max(0, Math.min(c + move.dc, table.columns.length - 1));
      const draftVal = table.rows[nr]?.cells[table.columns[nc]?.key ?? ""] ?? "";
      setEditing({ r: nr, c: nc });
      setDraft(draftVal);
    } else {
      setEditing(null);
    }
  }

  // ===== Formuły =====
  function computeFormula(formula: string, t: TableFull): number | null {
    const m = /^=([A-Za-z]+)\(([A-Za-z])(\d+):([A-Za-z])(\d+)\)$/.exec(formula.trim());
    if (!m) return null;
    const fn = m[1].toUpperCase();
    if (!(FORMULA_FNS as readonly string[]).includes(fn)) return null;
    const colLetter = m[2].toUpperCase();
    const colIdx = colLetter.charCodeAt(0) - 65;
    if (colIdx < 0 || colIdx > 25) return null;
    const r1 = Math.max(1, Math.min(parseInt(m[3], 10), parseInt(m[5], 10)));
    const r2 = Math.max(parseInt(m[3], 10), parseInt(m[5], 10));
    const colKey = t.columns[colIdx]?.key;
    if (!colKey) return null;
    const values: number[] = [];
    for (let i = r1; i <= r2 && i <= t.rows.length; i++) {
      const cell = t.rows[i - 1]?.cells[colKey];
      if (cell === undefined || cell === null || cell === "") continue;
      if (cell.startsWith("=")) continue; // nie zagnieżdżaj formuł
      const num = toNumber(cell);
      if (num === null) continue;
      values.push(num);
    }
    if (values.length === 0) return null;
    switch (fn) {
      case "SUM": return values.reduce((a, b) => a + b, 0);
      case "AVG": return values.reduce((a, b) => a + b, 0) / values.length;
      case "MIN": return Math.min(...values);
      case "MAX": return Math.max(...values);
      case "COUNT": return values.length;
    }
    return null;
  }

  function toNumber(v: string): number | null {
    const s = v.trim().replace(/\s/g, "").replace(",", ".");
    if (s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function fmtNum(n: number): string {
    const r = Math.round(n * 100) / 100;
    return String(r);
  }

  function displayValue(cell: string | undefined, type: ColumnType, t: TableFull): string {
    const v = cell ?? "";
    if (v.startsWith("=")) {
      const res = computeFormula(v, t);
      return res === null ? "" : fmtNum(res);
    }
    if (type === "date") {
      const mm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
      if (mm) return mm[3] + "." + mm[2] + "." + mm[1];
    }
    return v;
  }

  // ===== Eksport CSV (separator ";", UTF-8 z BOM, wartości wyliczone) =====
  function exportCsv() {
    const headers = table.columns.map((c) => csvCell(c.label));
    const lines = [headers.join(";")];
    for (const row of table.rows) {
      const cells = table.columns.map((c) => csvCell(displayValue(row.cells[c.key], c.type, table)));
      lines.push(cells.join(";"));
    }
    const csv = "\uFEFF" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (table.name || "tabela").replace(/[\\/:*?"<>|]+/g, "_") + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    pushToast(true, "Wyeksportowano CSV");
  }

  function csvCell(v: string): string {
    if (/[";\n\r]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
    return v;
  }

  // ===== Operacje na kolumnach / wierszach / tabeli =====
  async function addColumn() {
    const label = "Kolumna " + (table.columns.length + 1);
    try {
      const res = await api.post<{ table: TableFull }>("/api/tables/" + table.id + "/columns", { label, type: "text" });
      setTable(res.table);
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się dodać kolumny");
    }
  }

  async function applyColumnEdit(c: number, label: string, type: ColumnType) {
    const labelTrim = label.trim();
    if (!labelTrim) { setColEditor(null); return; }
    const cols: TableColumn[] = table.columns.map((col, i) =>
      i === c ? { ...col, label: labelTrim, type } : col
    );
    try {
      const res = await api.patch<{ table: TableFull }>("/api/tables/" + table.id, { columns: cols });
      setTable(res.table);
      pushToast(true, "Kolumna zaktualizowana");
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się zapisać kolumny");
    }
    setColEditor(null);
  }

  async function deleteColumn(c: number) {
    const col = table.columns[c];
    if (!col || !window.confirm("Usunąć kolumnę „" + col.label + "?\nKomórki tej kolumny zostaną usunięte.")) return;
    const cols = table.columns.filter((_, i) => i !== c);
    try {
      const res = await api.patch<{ table: TableFull }>("/api/tables/" + table.id, { columns: cols });
      setTable(res.table);
      setEditing(null);
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się usunąć kolumny");
    }
  }

  async function addRow() {
    try {
      const res = await api.post<{ row: TableRowData }>("/api/tables/" + table.id + "/rows", {});
      setTable((prev) => ({ ...prev, rows: [...prev.rows, res.row] }));
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się dodać wiersza");
    }
  }

  async function deleteRow(r: number) {
    const row = table.rows[r];
    if (!row || !window.confirm("Usunąć ten wiersz?")) return;
    try {
      await api.del("/api/tables/" + table.id + "/rows/" + row.id);
      setTable((prev) => ({ ...prev, rows: prev.rows.filter((_, i) => i !== r) }));
      if (editing?.r === r) setEditing(null);
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się usunąć wiersza");
    }
  }

  async function renameTable(name: string) {
    const n = name.trim();
    if (!n || n === table.name) return;
    const prev = table.name;
    setTable((t) => ({ ...t, name: n }));
    try {
      const res = await api.patch<{ table: TableFull }>("/api/tables/" + table.id, { name: n });
      setTable(res.table);
    } catch (e: any) {
      setTable((t) => ({ ...t, name: prev }));
      pushToast(false, e?.message || "Nie udało się zmienić nazwy");
    }
  }

  // ===== Segregacja danych przez asystenta AI =====
  async function organizeRows() {
    if (table.rows.length === 0 || organizing) return;
    setOrganizing(true);
    try {
      const payload = {
        columns: table.columns.map((c) => ({ key: c.key, label: c.label })),
        rows: table.rows.map((r) => ({ id: r.id, cells: r.cells })),
      };
      const res = await api.post<{ rows: { id?: string; cells: Record<string, string> }[] }>("/api/ai/organize", payload);
      const byId = new Map(table.rows.map((r) => [r.id, r]));
      const ordered: TableRowData[] = [];
      for (const item of res.rows) {
        if (item.id && byId.has(item.id)) {
          ordered.push(byId.get(item.id)!);
          byId.delete(item.id);
        }
      }
      for (const row of byId.values()) ordered.push(row); // ewentualne resztki na końcu
      if (ordered.length !== table.rows.length) {
        pushToast(false, "Odpowiedź AI nie pasuje do wierszy — bez zmian");
        return;
      }
      // zapis pozycji (PATCH rows) — nowa kolejność
      await Promise.all(ordered.map((row, i) =>
        api.patch("/api/tables/" + table.id + "/rows/" + row.id, { position: i })
      ));
      setTable((prev) => ({ ...prev, rows: ordered.map((row, i) => ({ ...row, position: i })) }));
      pushToast(true, "✨ Dane posegregowane przez AI");
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się posegregować danych");
    } finally {
      setOrganizing(false);
    }
  }

  async function deleteTable() {
    if (!window.confirm("Usunąć tabelę „" + table.name + "?\nWszystkie wiersze zostaną usunięte.")) return;
    try {
      await api.del("/api/tables/" + table.id);
      pushToast(true, "Tabela usunięta");
      onDeleted();
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się usunąć tabeli");
    }
  }

  function beginEdit(r: number, c: number) {
    setEditing({ r, c });
    setDraft(table.rows[r]?.cells[table.columns[c]?.key ?? ""] ?? "");
  }

  function onCellKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!editing) return;
    const { r, c } = editing;
    if (e.key === "Enter") {
      e.preventDefault();
      suppressBlurRef.current = true;
      commitCell(r, c, draft, { dr: 1, dc: 0 });
    } else if (e.key === "Tab") {
      e.preventDefault();
      suppressBlurRef.current = true;
      commitCell(r, c, draft, { dr: 0, dc: e.shiftKey ? -1 : 1 });
    } else if (e.key === "Escape") {
      e.preventDefault();
      suppressBlurRef.current = true;
      setEditing(null);
    } else if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      suppressBlurRef.current = true;
      const dir = e.key === "ArrowUp" ? { dr: -1, dc: 0 }
        : e.key === "ArrowDown" ? { dr: 1, dc: 0 }
        : e.key === "ArrowLeft" ? { dr: 0, dc: -1 }
        : { dr: 0, dc: 1 };
      commitCell(r, c, draft, dir);
    }
  }

  return (
    <div className="ss-wrap">
      <div className="ss-toolbar">
        <input
          className="ss-title"
          value={table.name}
          maxLength={120}
          placeholder="Nazwa tabeli"
          onBlur={(e) => renameTable(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
            if (e.key === "Escape") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
          }}
        />
        <span className={"ss-save-ind" + (saving ? " on" : "")}>{saving ? "Zapisywanie…" : "Zapisano"}</span>
        <span className="spacer" />
        <button className="btn" onClick={organizeRows} disabled={table.rows.length === 0 || organizing}
          title={table.rows.length === 0 ? "Dodaj wiersze, aby posegregować dane" : "Posegreguj wiersze przez asystenta AI"}>
          {organizing ? "Segregowanie…" : "✨ Segreguj dane"}
        </button>
        <button className="btn" onClick={exportCsv} title="Eksport do pliku CSV">⬇ Eksport CSV</button>
        <button className="btn" onClick={addColumn}>＋ kolumna</button>
        <button className="btn" onClick={addRow}>＋ wiersz</button>
        <button className="btn danger" onClick={deleteTable}>🗑 usuń</button>
      </div>

      <div className="ss-scroll">
        <table className="ss-table">
          <thead>
            <tr>
              <th className="ss-corner">#</th>
              {table.columns.map((col, c) => (
                <th key={col.key} className="ss-col-head">
                  {colEditor?.c === c ? (
                    <div className="ss-col-edit">
                      <input
                        className="input"
                        value={colEditor.label}
                        maxLength={80}
                        autoFocus
                        onChange={(e) => setColEditor({ c, label: e.target.value, type: colEditor.type })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); applyColumnEdit(c, colEditor.label, colEditor.type); }
                          if (e.key === "Escape") { e.preventDefault(); setColEditor(null); }
                        }}
                      />
                      <select
                        className="input"
                        value={colEditor.type}
                        onChange={(e) => setColEditor({ c, label: colEditor.label, type: e.target.value as ColumnType })}
                      >
                        <option value="text">tekst</option>
                        <option value="number">liczba</option>
                        <option value="date">data</option>
                      </select>
                      <button className="btn small accent" onClick={() => applyColumnEdit(c, colEditor.label, colEditor.type)} title="Zapisz" aria-label="Zapisz">✓</button>
                    </div>
                  ) : (
                    <div className="ss-col-btns">
                      <button
                        className="ss-col-label"
                        title="Kliknij, aby zmienić etykietę lub typ"
                        onClick={() => setColEditor({ c, label: col.label, type: col.type })}
                      >
                        <span className="ss-col-name">{col.label}</span>
                        <span className="ss-col-type">{col.type === "number" ? "#" : col.type === "date" ? "📅" : "Aa"}</span>
                      </button>
                      <button className="ss-col-del" title="Usuń kolumnę" onClick={() => deleteColumn(c)}>✕</button>
                    </div>
                  )}
                </th>
              ))}
              <th className="ss-add-col">
                <button className="btn small ghost" onClick={addColumn} title="Dodaj kolumnę">＋</button>
              </th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={row.id}>
                <td className="ss-row-head">
                  <span className="ss-row-num">{r + 1}</span>
                  <button className="ss-row-del" title="Usuń wiersz" onClick={() => deleteRow(r)}>✕</button>
                </td>
                {table.columns.map((col, c) => {
                  const isEditing = editing?.r === r && editing?.c === c;
                  return (
                    <td key={col.key} className={"ss-cell" + (isEditing ? " editing" : "")}>
                      {isEditing ? (
                        <input
                          className="ss-input"
                          type={col.type === "number" ? "number" : col.type === "date" ? "date" : "text"}
                          value={draft}
                          autoFocus
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={onCellKeyDown}
                          onBlur={() => {
                            if (suppressBlurRef.current) { suppressBlurRef.current = false; return; }
                            commitCell(r, c, draft);
                          }}
                        />
                      ) : (
                        <button
                          className="ss-cell-btn"
                          title="Kliknij, aby edytować"
                          onClick={() => beginEdit(r, c)}
                        >
                          {displayValue(row.cells[col.key], col.type, table) || "\u00A0"}
                        </button>
                      )}
                    </td>
                  );
                })}
                <td className="ss-fill" />
              </tr>
            ))}
            {table.rows.length === 0 && (
              <tr>
                <td className="ss-row-head" />
                <td className="ss-fill" colSpan={table.columns.length + 1}>
                  <button className="btn small ghost" onClick={addRow}>＋ dodaj pierwszy wiersz</button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
