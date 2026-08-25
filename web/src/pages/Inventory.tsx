import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import Toasts from "../components/Toasts";
import { fmtMoney } from "../lib";
import { pushToast } from "../toast";
import type { Product } from "../types";

export default function Inventory() {
  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [stockFor, setStockFor] = useState<Product | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setProducts(await api.get<Product[]>("/api/products"));
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się pobrać inwentarza");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const lowProducts = useMemo(() => products.filter((p) => p.low), [products]);
  const categories = useMemo(() =>
    Array.from(new Set(products.map((p) => p.category).filter(Boolean))).sort((a, b) => a.localeCompare(b, "pl")),
    [products],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return products.filter((p) => {
      if (lowOnly && !p.low) return false;
      if (category && p.category !== category) return false;
      if (needle) {
        const hay = [p.name, p.category, p.supplier, p.sku ?? ""].join(" ").toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [products, q, category, lowOnly]);

  async function removeProduct(p: Product) {
    if (!window.confirm("Usunąć produkt „" + p.name + "”? Pozycje w koszykach zachowają nazwę i cenę.")) return;
    try {
      await api.del("/api/products/" + p.id);
      pushToast(true, "Produkt usunięty");
      load();
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się usunąć produktu");
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Inwentarz</h1>
        <span className="sub">Produkty, stany magazynowe i alerty</span>
        <span className="spacer" />
        <button className="btn accent" onClick={() => { setEditing(null); setShowForm(true); }}>＋ Produkt</button>
      </div>

      {lowProducts.length > 0 && (
        <div className="inv-banner">
          <div className="inv-banner-head">
            <span className="inv-banner-icon">⚠️</span>
            <b>Niski stan — {lowProducts.length} {plural(lowProducts.length, "produkt", "produkty", "produktów")} poniżej progu minimalnego</b>
            <span className="spacer" />
            <button className="btn small ghost" onClick={() => setLowOnly((v) => !v)}>
              {lowOnly ? "Pokaż wszystkie" : "Filtruj tylko niskie"}
            </button>
          </div>
          <div className="inv-banner-chips">
            {lowProducts.map((p) => (
              <button key={p.id} className="chip" title="Kliknij, aby przefiltrować tabelę"
                onClick={() => { setQ(p.name); setCategory(""); setLowOnly(false); }}>
                {p.name} · {fmtMoney(p.price)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="board-toolbar" style={{ marginBottom: 14 }}>
        <input className="input" style={{ maxWidth: 300 }} placeholder="🔍 Szukaj: nazwa, kategoria, dostawca, SKU…"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" style={{ width: 210 }} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Wszystkie kategorie</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="spacer" />
        <span className="badge blue">{filtered.length} {plural(filtered.length, "produkt", "produkty", "produktów")}</span>
      </div>

      {loading ? (
        <div className="empty"><div className="big">📦</div><p>Ładowanie…</p></div>
      ) : products.length === 0 ? (
        <div className="panel">
          <div className="empty">
            <div className="big">📦</div>
            <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 15 }}>Brak produktów w inwentarzu</div>
            <p style={{ marginTop: 6 }}>Dodaj pierwszy produkt, aby śledzić stany magazynowe.</p>
            <button className="btn accent" style={{ marginTop: 14 }} onClick={() => { setEditing(null); setShowForm(true); }}>＋ Dodaj produkt</button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="panel"><div className="empty"><div className="big">🔍</div><p>Brak wyników dla podanych filtrów.</p></div></div>
      ) : (
        <div className="panel" style={{ padding: "6px 0" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Nazwa</th>
                <th>Kategoria</th>
                <th>Dostawca</th>
                <th>Cena</th>
                <th>Stan</th>
                <th>Min.</th>
                <th>Lokalizacja</th>
                <th>Status</th>
                <th style={{ width: 140 }}>Akcje</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div style={{ fontWeight: 700 }}>{p.name}</div>
                    <div className="muted-text" style={{ fontSize: 11.5 }}>{p.sku ? "SKU: " + p.sku + " · " : ""}{p.unit}</div>
                  </td>
                  <td>{p.category || "—"}</td>
                  <td>{p.supplier || "—"}</td>
                  <td style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{fmtMoney(p.price)}</td>
                  <td className={p.low ? "qty-low" : ""} style={{ fontWeight: 600 }}>{p.quantity} {p.unit}</td>
                  <td className="muted-text">{p.minQuantity}</td>
                  <td>{p.location || "—"}</td>
                  <td>{p.low ? <span className="badge warn">Niski stan</span> : <span className="badge green">Dostępny</span>}</td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="btn small ghost" title="Edytuj produkt" aria-label="Edytuj produkt" onClick={() => { setEditing(p); setShowForm(true); }}>✏️</button>
                      <button className="btn small ghost" title="Dopasuj stan magazynowy" aria-label="Dopasuj stan magazynowy" onClick={() => setStockFor(p)}>📦</button>
                      <button className="btn small danger" title="Usuń produkt" aria-label="Usuń produkt" onClick={() => removeProduct(p)}>🗑</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <ProductFormModal
          product={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); setEditing(null); load(); }}
        />
      )}
      {stockFor && (
        <StockModal
          product={stockFor}
          onClose={() => setStockFor(null)}
          onSaved={() => { setStockFor(null); load(); }}
        />
      )}
      <Toasts />
    </div>
  );
}

function ProductFormModal({ product, onClose, onSaved }: { product: Product | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(product?.name ?? "");
  const [category, setCategory] = useState(product?.category ?? "");
  const [unit, setUnit] = useState(product?.unit ?? "szt.");
  const [supplier, setSupplier] = useState(product?.supplier ?? "");
  const [supplierUrl, setSupplierUrl] = useState(product?.supplierUrl ?? "");
  const [price, setPrice] = useState(product ? String(product.price) : "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [quantity, setQuantity] = useState("");
  const [minQuantity, setMinQuantity] = useState("");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    setErr("");
    const priceNum = parseNum(price);
    if (!name.trim()) { setErr("Podaj nazwę produktu"); return; }
    if (!Number.isFinite(priceNum) || priceNum < 0) { setErr("Podaj poprawną cenę (≥ 0)"); return; }
    setBusy(true);
    try {
      if (product) {
        await api.patch("/api/products/" + product.id, {
          name: name.trim(), category: category.trim() || null, unit: unit.trim() || null,
          supplier: supplier.trim() || null, supplierUrl: supplierUrl.trim() || null,
          price: priceNum, sku: sku.trim() || null,
        });
      } else {
        const qty = parseNum(quantity);
        const min = parseNum(minQuantity);
        await api.post("/api/products", {
          name: name.trim(), category: category.trim(), unit: unit.trim() || "szt.",
          supplier: supplier.trim(), supplierUrl: supplierUrl.trim(), price: priceNum,
          sku: sku.trim() || null,
          quantity: Number.isFinite(qty) ? qty : 0,
          minQuantity: Number.isFinite(min) ? min : 0,
          location: location.trim(),
        });
      }
      pushToast(true, product ? "Produkt zapisany" : "Produkt dodany");
      onSaved();
    } catch (e: any) {
      setErr(e?.message || "Nie udało się zapisać produktu");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal wide">
        <h2>{product ? "✏️ Edytuj produkt" : "＋ Nowy produkt"}</h2>
        <div style={{ display: "grid", gap: 12 }}>
          <div className="row">
            <label className="field">Nazwa <input className="input" autoFocus value={name} maxLength={300} onChange={(e) => setName(e.target.value)} /></label>
            <label className="field">Kategoria <input className="input" value={category} maxLength={100} placeholder="np. Materiały jednorazowe" onChange={(e) => setCategory(e.target.value)} /></label>
          </div>
          <div className="row">
            <label className="field">Jednostka <input className="input" value={unit} maxLength={50} onChange={(e) => setUnit(e.target.value)} /></label>
            <label className="field">SKU <input className="input" value={sku} maxLength={100} onChange={(e) => setSku(e.target.value)} /></label>
          </div>
          <div className="row">
            <label className="field">Dostawca <input className="input" value={supplier} maxLength={200} onChange={(e) => setSupplier(e.target.value)} /></label>
            <label className="field">Cena (zł) <input className="input" value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value)} /></label>
          </div>
          <label className="field">Link do hurtowni (URL) <input className="input" value={supplierUrl} maxLength={1000} placeholder="https://…" onChange={(e) => setSupplierUrl(e.target.value)} /></label>
          {!product && (
            <>
              <div className="row">
                <label className="field">Stan początkowy <input className="input" value={quantity} inputMode="decimal" onChange={(e) => setQuantity(e.target.value)} /></label>
                <label className="field">Minimalny stan <input className="input" value={minQuantity} inputMode="decimal" onChange={(e) => setMinQuantity(e.target.value)} /></label>
              </div>
              <label className="field">Lokalizacja <input className="input" value={location} maxLength={200} placeholder="np. Magazyn A3" onChange={(e) => setLocation(e.target.value)} /></label>
            </>
          )}
          {product && (<p className="muted-text" style={{ fontSize: 12.5 }}>Stan magazynowy dopasujesz przyciskiem 📦 obok produktu.</p>)}
        </div>
        {err && <div className="login-error" style={{ marginTop: 12 }}>⚠️ {err}</div>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>Anuluj</button>
          <button className="btn accent" disabled={busy} onClick={submit}>{busy ? "Zapisywanie…" : product ? "Zapisz" : "Dodaj produkt"}</button>
        </div>
      </div>
    </div>
  );
}

function StockModal({ product, onClose, onSaved }: { product: Product; onClose: () => void; onSaved: () => void }) {
  const [quantity, setQuantity] = useState(String(product.quantity));
  const [minQuantity, setMinQuantity] = useState(String(product.minQuantity));
  const [location, setLocation] = useState(product.location);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    setErr("");
    const qty = parseNum(quantity);
    const min = parseNum(minQuantity);
    if (!Number.isFinite(qty) || qty < 0) { setErr("Podaj poprawny stan (≥ 0)"); return; }
    if (!Number.isFinite(min) || min < 0) { setErr("Podaj poprawny minimalny stan (≥ 0)"); return; }
    setBusy(true);
    try {
      await api.patch("/api/inventory/" + product.id, { quantity: qty, minQuantity: min, location: location.trim() });
      pushToast(true, "Stan zaktualizowany");
      onSaved();
    } catch (e: any) {
      setErr(e?.message || "Nie udało się zapisać stanu");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h2>📦 Dopasuj stan — {product.name}</h2>
        <div style={{ display: "grid", gap: 12 }}>
          <div className="row">
            <label className="field">Stan (aktualny) <input className="input" autoFocus value={quantity} inputMode="decimal" onChange={(e) => setQuantity(e.target.value)} /></label>
            <label className="field">Minimalny stan <input className="input" value={minQuantity} inputMode="decimal" onChange={(e) => setMinQuantity(e.target.value)} /></label>
          </div>
          <label className="field">Lokalizacja <input className="input" value={location} maxLength={200} onChange={(e) => setLocation(e.target.value)} /></label>
          {product.low && (<p style={{ fontSize: 12.5 }}>⚠️ Produkt ma obecnie <b>niski stan</b>.</p>)}
        </div>
        {err && <div className="login-error" style={{ marginTop: 12 }}>⚠️ {err}</div>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>Anuluj</button>
          <button className="btn accent" disabled={busy} onClick={submit}>{busy ? "Zapisywanie…" : "Zapisz stan"}</button>
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

