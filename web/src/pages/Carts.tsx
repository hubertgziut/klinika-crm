import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import Toasts from "../components/Toasts";
import { fmtMoney } from "../lib";
import { pushToast } from "../toast";
import { AI_PRODUCT_MIME, type AiProduct, type CartStatus, type CartSummary } from "../types";

const COLUMNS: { value: CartStatus; label: string; emoji: string }[] = [
  { value: "new", label: "Nowe", emoji: "🆕" },
  { value: "in_progress", label: "W koszyku", emoji: "🛒" },
  { value: "ordered", label: "Zamówione", emoji: "📦" },
  { value: "delivered", label: "Dostarczone", emoji: "✅" },
];

export default function Carts() {
  const [carts, setCarts] = useState<CartSummary[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<CartStatus | null>(null);
  const [extOver, setExtOver] = useState<CartStatus | null>(null);
  const [showForm, setShowForm] = useState(false);
  const suppressClick = useRef(false);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      setCarts(await api.get<CartSummary[]>("/api/carts"));
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się pobrać koszyków");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  function cartsIn(status: CartStatus): CartSummary[] {
    return carts.filter((c) => c.status === status);
  }

  function handleDragStart(e: React.DragEvent, c: CartSummary) {
    suppressClick.current = true;
    setDragId(c.id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", c.id);
  }
  function handleDragEnd() {
    setDragId(null);
    setOverCol(null);
    window.setTimeout(() => { suppressClick.current = false; }, 0);
  }

  async function moveTo(cartId: string, status: CartStatus) {
    setCarts((prev) => prev.map((c) => c.id === cartId ? { ...c, status } : c));
    try {
      const res = await api.patch<{ cart: CartSummary }>("/api/carts/" + cartId, { status });
      setCarts((prev) => prev.map((c) => c.id === cartId ? res.cart : c));
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się zmienić statusu koszyka");
      load();
    }
  }

  function hasProductData(e: React.DragEvent): boolean {
    return Array.from(e.dataTransfer.types).includes(AI_PRODUCT_MIME);
  }

  function readProduct(e: React.DragEvent): AiProduct | null {
    try {
      return JSON.parse(e.dataTransfer.getData(AI_PRODUCT_MIME)) as AiProduct;
    } catch {
      return null;
    }
  }

  // Upuszczenie karty produktu AI na kolumnę pipeline'u: dodaj do pierwszego koszyka
  // w tej kolumnie lub utwórz nowy koszyk (status = kolumna docelowa).
  async function addProductToCartFor(cartId: string, product: AiProduct) {
    try {
      await api.post("/api/carts/" + cartId + "/items", {
        name: product.name,
        price: product.price,
        quantity: 1,
        url: product.url || undefined,
        supplier: product.supplier || undefined,
      });
      pushToast(true, "Dodano do koszyka: " + product.name);
      load();
    } catch (err: any) {
      pushToast(false, err?.message || "Nie udało się dodać do koszyka");
    }
  }

  async function addProductToCart(status: CartStatus, product: AiProduct) {
    let target = carts.find((c) => c.status === status);
    if (!target) {
      const res = await api.post<{ cart: CartSummary }>("/api/carts", {
        name: "AI: " + product.name.slice(0, 40),
        status,
      });
      target = res.cart;
    }
    await api.post("/api/carts/" + target.id + "/items", {
      name: product.name,
      price: product.price,
      quantity: 1,
      url: product.url || undefined,
      supplier: product.supplier || undefined,
    });
    pushToast(true, "Dodano do koszyka „" + target.name + "”: " + product.name);
    load();
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Koszyki</h1>
        <span className="sub">Pipeline zakupów — przeciągnij kartę, aby zmienić status</span>
        <span className="spacer" />
        <button className="btn accent" onClick={() => setShowForm(true)}>＋ Koszyk</button>
      </div>

      {carts.length === 0 ? (
        <div className="panel">
          <div className="empty">
            <div className="big">🛒</div>
            <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 15 }}>Brak koszyków</div>
            <p style={{ marginTop: 6 }}>Utwórz koszyk, aby zbierać produkty z inwentarza i zamawiać u dostawców.</p>
            <button className="btn accent" style={{ marginTop: 14 }} onClick={() => setShowForm(true)}>＋ Nowy koszyk</button>
          </div>
        </div>
      ) : (
        <div className="cart-pipeline">
          {COLUMNS.map((col) => {
            const list = cartsIn(col.value);
            const isOver = overCol === col.value;
            return (
              <div
                key={col.value}
                className={"cart-col" + (isOver ? " over" : "") + (extOver === col.value ? " drop-active" : "")}
                onDragOver={(e) => {
                  if (hasProductData(e)) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                    setExtOver(col.value);
                    return;
                  }
                  if (!dragId) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setOverCol(col.value);
                }}
                onDragLeave={() => { setOverCol((v) => v === col.value ? null : v); setExtOver((v) => v === col.value ? null : v); }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (hasProductData(e)) {
                    const p = readProduct(e);
                    setExtOver(null);
                    if (p) addProductToCart(col.value, p).catch((err: any) => pushToast(false, err?.message || "Nie udało się dodać do koszyka"));
                    return;
                  }
                  const id = dragId ?? e.dataTransfer.getData("text/plain");
                  if (id) moveTo(id, col.value);
                  setDragId(null);
                  setOverCol(null);
                }}
              >
                <div className="col-head">
                  <span>{col.emoji}</span>
                  <span>{col.label}</span>
                  <span className="cnt">{list.length}</span>
                </div>
                {list.map((c) => (
                  <div
                    key={c.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, c)}
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => {
                      if (hasProductData(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setExtOver(col.value); }
                    }}
                    onDrop={(e) => {
                      if (hasProductData(e)) {
                        e.preventDefault();
                        e.stopPropagation();
                        const p = readProduct(e);
                        setExtOver(null);
                        if (p) addProductToCartFor(c.id, p);
                        return;
                      }
                    }}
                    className={"cart-card" + (dragId === c.id ? " dragging" : "")}
                    onClick={() => { if (!suppressClick.current) navigate("/koszyki/" + c.id); }}
                  >
                    <div className="cc-head">
                      <span className={"status-dot " + c.status} />
                      <span className="cc-name">{c.name}</span>
                    </div>
                    <div className="cc-supplier">{c.supplier ? "🏭 " + c.supplier : "—"}</div>
                    <div className="cc-foot">
                      <span className="cc-count">{c.itemCount} {plural(c.itemCount, "pozycja", "pozycje", "pozycji")}</span>
                      <span className="cc-total">{fmtMoney(c.total)}</span>
                    </div>
                  </div>
                ))}
                {list.length === 0 && (
                  <div className="kanban-empty" onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverCol(col.value); } }}>
                    Upuść tutaj
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showForm && <CartFormModal onClose={() => setShowForm(false)} onCreated={() => { setShowForm(false); load(); }} />}
      <Toasts />
    </div>
  );
}

function CartFormModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [supplier, setSupplier] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    setErr("");
    if (!name.trim()) { setErr("Podaj nazwę koszyka"); return; }
    setBusy(true);
    try {
      await api.post("/api/carts", { name: name.trim(), supplier: supplier.trim() });
      pushToast(true, "Koszyk utworzony");
      onCreated();
    } catch (e: any) {
      setErr(e?.message || "Nie udało się utworzyć koszyka");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h2>＋ Nowy koszyk</h2>
        <div style={{ display: "grid", gap: 12 }}>
          <label className="field">
            Nazwa
            <input className="input" autoFocus value={name} maxLength={200} placeholder="np. Zakupy do pralni"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
          </label>
          <label className="field">
            Dostawca (opcjonalnie)
            <input className="input" value={supplier} maxLength={200} placeholder="np. MedPlus"
              onChange={(e) => setSupplier(e.target.value)} />
          </label>
        </div>
        {err && <div className="login-error" style={{ marginTop: 12 }}>⚠️ {err}</div>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>Anuluj</button>
          <button className="btn accent" disabled={busy} onClick={submit}>{busy ? "Tworzenie…" : "Utwórz koszyk"}</button>
        </div>
      </div>
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

