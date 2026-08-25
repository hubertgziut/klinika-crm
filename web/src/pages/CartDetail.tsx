import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import Toasts from "../components/Toasts";
import { fmtMoney } from "../lib";
import { pushToast } from "../toast";
import type { CartFull, CartItem, CartStatus, OrderFull, Product } from "../types";

const CART_STATUS_LABEL: Record<CartStatus, string> = {
  new: "🆕 Nowe",
  in_progress: "🛒 W koszyku",
  ordered: "📦 Zamówione",
  delivered: "✅ Dostarczone",
};

export default function CartDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [cart, setCart] = useState<CartFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [placing, setPlacing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const d = await api.get<{ cart: CartFull }>("/api/carts/" + id);
      setCart(d.cart);
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się pobrać koszyka");
      navigate("/koszyki");
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);
  useEffect(() => { load(); }, [load]);

  async function updateCart(patch: Partial<Pick<CartFull, "name" | "supplier" | "status">>) {
    if (!cart) return;
    const prev = cart;
    setCart({ ...cart, ...patch } as CartFull);
    try {
      const res = await api.patch<{ cart: CartFull }>("/api/carts/" + id, patch);
      setCart((c) => c ? { ...c, ...res.cart } : c);
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się zapisać koszyka");
      setCart(prev);
    }
  }

  async function updateItem(iid: string, patch: Partial<Pick<CartItem, "name" | "price" | "quantity" | "url" | "supplier">>) {
    if (!cart) return;
    setCart({ ...cart, items: cart.items.map((it) => it.id === iid ? { ...it, ...patch } as CartItem : it) });
    try {
      const res = await api.patch<{ item: CartItem }>("/api/carts/" + id + "/items/" + iid, patch);
      setCart((c) => c ? { ...c, items: c.items.map((it) => it.id === iid ? res.item : it) } : c);
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się zapisać pozycji");
      load();
    }
  }

  async function removeItem(iid: string) {
    try {
      await api.del("/api/carts/" + id + "/items/" + iid);
      setCart((c) => c ? { ...c, items: c.items.filter((it) => it.id !== iid) } : c);
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się usunąć pozycji");
    }
  }

  async function placeOrder() {
    if (!cart || cart.items.length === 0) return;
    setPlacing(true);
    try {
      const res = await api.post<{ order: OrderFull }>("/api/carts/" + id + "/order");
      pushToast(true, "Zamówienie " + res.order.number + " złożone");
      navigate("/zamowienia");
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się złożyć zamówienia");
      setPlacing(false);
    }
  }

  async function removeCart() {
    if (!cart) return;
    if (!window.confirm("Usunąć koszyk „" + cart.name + "”? Pozycje zostaną usunięte.")) return;
    try {
      await api.del("/api/carts/" + id);
      pushToast(true, "Koszyk usunięty");
      navigate("/koszyki");
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się usunąć koszyka");
    }
  }

  const total = useMemo(() =>
    cart ? cart.items.reduce((s, it) => s + Number(it.price) * Number(it.quantity), 0) : 0,
    [cart],
  );
  const locked = cart?.status === "ordered" || cart?.status === "delivered";

  if (loading) return <div className="page"><div className="empty"><div className="big">🛒</div><p>Ładowanie…</p></div></div>;
  if (!cart) return null;

  return (
    <div className="page">
      <div className="page-head">
        <Link to="/koszyki" className="back-link">← Koszyki</Link>
        <span className="spacer" />
        <span className="badge blue" style={{ fontSize: 12.5 }}>{cart.itemCount} {plural(cart.itemCount, "pozycja", "pozycje", "pozycji")}</span>
        <span className="badge" style={{ fontSize: 13, padding: "4px 14px" }}>{fmtMoney(total)}</span>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="cd-head">
          <div className="cd-titles">
            <input
              className="cd-name"
              value={cart.name}
              maxLength={200}
              disabled={locked}
              onChange={(e) => setCart({ ...cart, name: e.target.value })}
              onBlur={() => updateCart({ name: cart.name })}
              placeholder="Nazwa koszyka"
            />
            <div className="cd-supplier-row">
              <span className="muted-text">Dostawca:</span>
              <input
                className="cd-supplier"
                value={cart.supplier}
                maxLength={200}
                placeholder="—"
                onChange={(e) => setCart({ ...cart, supplier: e.target.value })}
                onBlur={() => updateCart({ supplier: cart.supplier })}
              />
            </div>
          </div>
          <div className="cd-actions">
            <select
              className="input"
              style={{ width: 170 }}
              value={cart.status}
              onChange={(e) => updateCart({ status: e.target.value as CartStatus })}
            >
              {(Object.keys(CART_STATUS_LABEL) as CartStatus[]).map((s) => (
                <option key={s} value={s}>{CART_STATUS_LABEL[s]}</option>
              ))}
            </select>
            <button className="btn accent" disabled={placing || cart.items.length === 0 || locked}
              title={locked ? "Zamówienie już złożone" : cart.items.length === 0 ? "Koszyk jest pusty" : "Złóż zamówienie"}
              onClick={placeOrder}>
              {placing ? "Składanie…" : "📦 Złóż zamówienie"}
            </button>
            <button className="btn danger" disabled={locked} onClick={removeCart}>🗑 Usuń koszyk</button>
          </div>
        </div>
        {locked && <p className="muted-text" style={{ marginTop: 8, fontSize: 12.5 }}>Koszyk jest już zamówiony — status zmienisz w module Zamówienia.</p>}
      </div>

      <div className="panel" style={{ padding: "6px 0" }}>
        <div className="panel-title" style={{ padding: "8px 14px 4px", marginBottom: 0 }}>
          <span>🧾 Pozycje</span>
          <span className="spacer" />
          <button className="btn small accent" disabled={locked} onClick={() => setShowAdd(true)}>＋ Pozycja</button>
        </div>
        {cart.items.length === 0 ? (
          <div className="empty">
            <div className="big">🧺</div>
            <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 15 }}>Koszyk jest pusty</div>
            <p style={{ marginTop: 6 }}>Dodaj produkty z inwentarza lub wpisz pozycję ręcznie.</p>
            <button className="btn accent" style={{ marginTop: 14 }} disabled={locked} onClick={() => setShowAdd(true)}>＋ Dodaj pozycję</button>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Nazwa</th>
                <th style={{ width: 110 }}>Cena</th>
                <th style={{ width: 90 }}>Ilość</th>
                <th style={{ width: 130 }}>Dostawca</th>
                <th style={{ width: 60 }}>Link</th>
                <th style={{ width: 60 }} />
              </tr>
            </thead>
            <tbody>
              {cart.items.map((it) => (
                <tr key={it.id}>
                  <td>
                    <input className="cd-inline" value={it.name} disabled={locked} maxLength={300}
                      onChange={(e) => setCart({ ...cart, items: cart.items.map((x) => x.id === it.id ? { ...x, name: e.target.value } : x) })}
                      onBlur={() => updateItem(it.id, { name: it.name })} />
                    <div className="muted-text" style={{ fontSize: 11 }}>{it.productId ? "z inwentarza" : "ręcznie"}</div>
                  </td>
                  <td>
                    <input className="cd-inline num" value={String(it.price)} disabled={locked} inputMode="decimal"
                      onChange={(e) => setCart({ ...cart, items: cart.items.map((x) => x.id === it.id ? { ...x, price: parseNum(e.target.value) } : x) })}
                      onBlur={() => updateItem(it.id, { price: Number(it.price) })} />
                  </td>
                  <td>
                    <input className="cd-inline num" value={String(it.quantity)} disabled={locked} inputMode="decimal"
                      onChange={(e) => setCart({ ...cart, items: cart.items.map((x) => x.id === it.id ? { ...x, quantity: parseNum(e.target.value) } : x) })}
                      onBlur={() => updateItem(it.id, { quantity: Number(it.quantity) || 1 })} />
                  </td>
                  <td className="muted-text">{it.supplier || "—"}</td>
                  <td>
                    {it.url ? (
                      <a href={it.url} target="_blank" rel="noreferrer" title={it.url} className="cd-link">🔗</a>
                    ) : <span className="muted-text">—</span>}
                  </td>
                  <td>
                    <button className="btn small danger" disabled={locked} title="Usuń pozycję" aria-label="Usuń pozycję" onClick={() => removeItem(it.id)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && (
        <AddItemModal onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); load(); }} />
      )}
      <Toasts />
    </div>
  );
}

function AddItemModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const { id } = useParams();
  const [mode, setMode] = useState<"inventory" | "manual">("inventory");
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [url, setUrl] = useState("");
  const [supplier, setSupplier] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { api.get<Product[]>("/api/products").then(setProducts).catch(() => {}); }, []);

  const selected = products.find((p) => p.id === productId);

  async function submit() {
    setErr("");
    setBusy(true);
    try {
      if (mode === "inventory") {
        if (!productId) { setErr("Wybierz produkt z inwentarza"); setBusy(false); return; }
        const qty = parseNum(quantity);
        await api.post("/api/carts/" + id + "/items", {
          productId,
          quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
        });
      } else {
        const priceNum = parseNum(price);
        if (!name.trim()) { setErr("Podaj nazwę pozycji"); setBusy(false); return; }
        if (!Number.isFinite(priceNum) || priceNum < 0) { setErr("Podaj poprawną cenę (≥ 0)"); setBusy(false); return; }
        const qty = parseNum(quantity);
        await api.post("/api/carts/" + id + "/items", {
          name: name.trim(),
          price: priceNum,
          quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
          url: url.trim(),
          supplier: supplier.trim(),
        });
      }
      pushToast(true, "Pozycja dodana");
      onAdded();
    } catch (e: any) {
      setErr(e?.message || "Nie udało się dodać pozycji");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal wide">
        <h2>＋ Dodaj pozycję</h2>
        <div className="seg">
          <button className={"seg-btn" + (mode === "inventory" ? " active" : "")} onClick={() => setMode("inventory")}>📦 Z inwentarza</button>
          <button className={"seg-btn" + (mode === "manual" ? " active" : "")} onClick={() => setMode("manual")}>✍️ Ręcznie</button>
        </div>
        <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
          {mode === "inventory" ? (
            <>
              <label className="field">
                Produkt
                <select className="input" value={productId} onChange={(e) => setProductId(e.target.value)}>
                  <option value="">— wybierz produkt —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} {p.low ? "(niski stan)" : ""}</option>
                  ))}
                </select>
              </label>
              {selected && (
                <div className="inv-preview">
                  <div><b>{selected.name}</b></div>
                  <div className="muted-text">Cena: <b style={{ color: "var(--text)" }}>{fmtMoney(selected.price)}</b> · Dostawca: {selected.supplier || "—"}</div>
                  <div className="muted-text">Stan: {selected.quantity} {selected.unit} · {selected.location || "brak lokalizacji"}</div>
                </div>
              )}
              <label className="field">
                Ilość
                <input className="input" value={quantity} inputMode="decimal" onChange={(e) => setQuantity(e.target.value)} />
              </label>
            </>
          ) : (
            <>
              <label className="field">
                Nazwa
                <input className="input" autoFocus value={name} maxLength={300} placeholder="np. Worek na odpady 60 l"
                  onChange={(e) => setName(e.target.value)} />
              </label>
              <div className="row">
                <label className="field">Cena (zł) <input className="input" value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value)} /></label>
                <label className="field">Ilość <input className="input" value={quantity} inputMode="decimal" onChange={(e) => setQuantity(e.target.value)} /></label>
              </div>
              <label className="field">Link do hurtowni (URL) <input className="input" value={url} maxLength={1000} placeholder="https://…" onChange={(e) => setUrl(e.target.value)} /></label>
              <label className="field">Dostawca <input className="input" value={supplier} maxLength={200} onChange={(e) => setSupplier(e.target.value)} /></label>
            </>
          )}
        </div>
        {err && <div className="login-error" style={{ marginTop: 12 }}>⚠️ {err}</div>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>Anuluj</button>
          <button className="btn accent" disabled={busy} onClick={submit}>{busy ? "Dodawanie…" : "Dodaj pozycję"}</button>
        </div>
      </div>
    </div>
  );
}

function parseNum(s: string): number {
  return Number(String(s).trim().replace(/\./g, "").replace(",", "."));
}

function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const m = n % 10;
  const f = n % 100;
  if (m >= 2 && m <= 4 && !(f >= 12 && f <= 14)) return few;
  return many;
}

