import { Fragment, useCallback, useEffect, useState } from "react";
import { api } from "../api";
import Toasts from "../components/Toasts";
import { fmtMoney, fmtDate } from "../lib";
import { pushToast } from "../toast";
import type { OrderFull, OrderItem, OrderStatus, OrderSummary } from "../types";

const STATUS_META: { value: OrderStatus; label: string; cls: string }[] = [
  { value: "placed", label: "Złożone", cls: "badge blue" },
  { value: "shipped", label: "Wysłane", cls: "badge purple" },
  { value: "delivered", label: "Dostarczone", cls: "badge green" },
  { value: "cancelled", label: "Anulowane", cls: "badge gray" },
];

export default function Orders() {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [details, setDetails] = useState<Record<string, OrderItem[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setOrders(await api.get<OrderSummary[]>("/api/orders"));
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się pobrać zamówień");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function toggle(id: string) {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (!details[id]) {
      try {
        const d = await api.get<{ order: OrderFull }>("/api/orders/" + id);
        setDetails((prev) => ({ ...prev, [id]: d.order.items }));
      } catch (e: any) {
        pushToast(false, e?.message || "Nie udało się pobrać szczegółów zamówienia");
      }
    }
  }

  async function changeStatus(o: OrderSummary, status: OrderStatus) {
    try {
      const res = await api.patch<{ order: OrderSummary }>("/api/orders/" + o.id, { status });
      setOrders((prev) => prev.map((x) => x.id === o.id ? res.order : x));
      pushToast(true, "Status zamówienia " + o.number + " zmieniony");
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się zmienić statusu");
    }
  }

  const badgeFor = (s: OrderStatus) => STATUS_META.find((m) => m.value === s) ?? STATUS_META[0];

  return (
    <div className="page">
      <div className="page-head">
        <h1>Zamówienia</h1>
        <span className="sub">Lista zamówień złożonych z koszyków</span>
        <span className="spacer" />
        <span className="badge blue">{orders.length} {plural(orders.length, "zamówienie", "zamówienia", "zamówień")}</span>
      </div>

      {loading ? (
        <div className="empty"><div className="big">🚚</div><p>Ładowanie…</p></div>
      ) : orders.length === 0 ? (
        <div className="panel">
          <div className="empty">
            <div className="big">🚚</div>
            <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 15 }}>Brak zamówień</div>
            <p style={{ marginTop: 6 }}>Złóż zamówienie z koszyka w module Koszyki, aby pojawiło się tutaj.</p>
          </div>
        </div>
      ) : (
        <div className="panel" style={{ padding: "6px 0" }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 40 }} />
                <th>Numer</th>
                <th>Status</th>
                <th>Suma</th>
                <th>Koszyk</th>
                <th>Kto złożył</th>
                <th>Data</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const meta = badgeFor(o.status);
                const open = expanded === o.id;
                return (
                  <Fragment key={o.id}>
                    <tr className="order-row" onClick={() => toggle(o.id)}>
                      <td><span className={"chevron" + (open ? " open" : "")}>▸</span></td>
                      <td><b className="mono">{o.number}</b></td>
                      <td>
                        <select
                          className="status-select"
                          value={o.status}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => changeStatus(o, e.target.value as OrderStatus)}
                        >
                          {STATUS_META.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                        <span className={meta.cls} style={{ marginLeft: 6 }}>{meta.label}</span>
                      </td>
                      <td style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{fmtMoney(o.total)}</td>
                      <td>{o.cartName || "—"}</td>
                      <td>{o.placedByName || "—"}</td>
                      <td className="muted-text">{fmtDate(o.createdAt)}</td>
                    </tr>
                    {open && (
                      <tr key={o.id + "-detail"} className="order-detail-row">
                        <td colSpan={7}>
                          <div className="order-detail">
                            <div className="td-section-title">Pozycje zamówienia</div>
                            {(details[o.id] ?? []).length === 0 ? (
                              <p className="muted-text">Ładowanie pozycji…</p>
                            ) : (
                              <table className="table" style={{ maxWidth: 620 }}>
                                <thead>
                                  <tr>
                                    <th>Nazwa</th>
                                    <th>Cena</th>
                                    <th>Ilość</th>
                                    <th>Wartość</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(details[o.id] ?? []).map((it) => (
                                    <tr key={it.id}>
                                      <td>{it.name}</td>
                                      <td>{fmtMoney(it.price)}</td>
                                      <td>{it.quantity}</td>
                                      <td style={{ fontWeight: 600 }}>{fmtMoney(it.price * it.quantity)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                            <div className="order-detail-total">Razem: <b>{fmtMoney(o.total)}</b></div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Toasts />
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const m = n % 10;
  const f = n % 100;
  if (m >= 2 && m <= 4 && !(f >= 12 && f <= 14)) return few;
  return many;
}

