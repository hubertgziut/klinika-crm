import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import Toasts from "../components/Toasts";
import { fmtDate, fmtMoney, STATUSES } from "../lib";
import { pushToast } from "../toast";
import type {
  AiChatMessage, AiProduct, AiReply, AiThreadSummary,
  Branch, CartSummary, Project, Task, TaskStatus,
} from "../types";

// ===== Faza 6 — Asystent AI (czat, karty produktów, drag & drop do zadań/koszyka) =====

export default function AiAssistant() {
  const [threads, setThreads] = useState<AiThreadSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<{ product: AiProduct; mode: "task" | "cart" } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadThreads = useCallback(async () => {
    try {
      setThreads(await api.get<AiThreadSummary[]>("/api/ai/threads"));
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się pobrać wątków");
    }
  }, []);

  useEffect(() => { loadThreads(); }, [loadThreads]);

  useEffect(() => {
    if (!activeId) return;
    setLoading(true);
    api.get<{ thread: AiThreadSummary; messages: AiChatMessage[] }>("/api/ai/threads/" + activeId)
      .then((d) => { setMessages(d.messages); setLoading(false); })
      .catch((e: any) => { pushToast(false, e?.message || "Nie udało się pobrać wątku"); setLoading(false); });
  }, [activeId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    const optimistic: AiChatMessage = {
      id: "local-" + Date.now(), threadId: activeId ?? "", role: "user",
      content: { text }, createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    setInput("");
    try {
      const res = await api.post<{ threadId: string; message: AiChatMessage }>(
        "/api/ai/chat",
        activeId ? { threadId: activeId, message: text } : { message: text }
      );
      setActiveId(res.threadId);
      setMessages((m) => [...m.filter((x) => x.id !== optimistic.id), res.message]);
      await loadThreads();
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się wysłać wiadomości");
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
    } finally {
      setBusy(false);
    }
  }

  function newThread() {
    setActiveId(null);
    setMessages([]);
  }

  return (
    <div className="page ai-page">
      <div className="ai-shell">
        <aside className="ai-side">
          <div className="ai-side-head">
            <h2>Wątki</h2>
            <button className="btn small accent" onClick={newThread} title="Nowy wątek">＋ Nowy wątek</button>
          </div>
          <div className="ai-thread-scroll">
            {threads.length === 0 && (
              <div className="chat-empty"><p>Brak wątków — zacznij nowy czat ✨</p></div>
            )}
            {threads.map((t) => (
              <button
                key={t.id}
                className={"ai-thread" + (t.id === activeId ? " active" : "")}
                onClick={() => setActiveId(t.id)}
              >
                <span className="ai-thread-title">💬 {t.title}</span>
                <span className="ai-thread-meta">{t.messageCount} wiad. · {fmtDate(t.updatedAt)}</span>
              </button>
            ))}
          </div>
        </aside>

        <main className="ai-main">
          <div className="ai-head">
            <h3>✨ Asystent AI</h3>
            <span className="ai-demo-hint">Klinika CRM · OpenAI</span>
          </div>

          {loading ? (
            <div className="ai-msgs"><div className="empty"><div className="big">✨</div><p>Ładowanie…</p></div></div>
          ) : messages.length === 0 ? (
            <div className="ai-msgs">
              <div className="ai-welcome">
                <div className="big">✨</div>
                <b>Jak mogę pomóc?</b>
                <p>Wyszukuję produkty z inwentarza i koszyków, podsumowuję zadania i projekty, proponuję zakupy.</p>
                <p className="muted-text" style={{ fontSize: 12.5 }}>
                  Przykłady: „znajdź pralkę” · „znajdź środki dezynfekcyjne” · „podsumuj” · „wyszukaj zadania”
                </p>
              </div>
            </div>
          ) : (
            <div className="ai-msgs" ref={scrollRef}>
              {messages.map((m) =>
                m.role === "user" ? (
                  <UserBubble key={m.id} text={userText(m.content)} />
                ) : (
                  <AiBubble key={m.id} reply={m.content as AiReply} onAction={setAction} />
                )
              )}
            </div>
          )}

          <div className="ai-input">
            <textarea
              className="input"
              rows={1}
              value={input}
              placeholder="Zapytaj asystenta… np. „znajdź pralkę”"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
              }}
            />
            <button className="btn accent" disabled={busy || !input.trim()} onClick={send}>
              {busy ? "…" : "Wyślij"}
            </button>
          </div>
        </main>
      </div>

      {action?.mode === "task" && (
        <ToTaskModal product={action.product} onClose={() => setAction(null)} onDone={() => setAction(null)} />
      )}
      {action?.mode === "cart" && (
        <ToCartModal product={action.product} onClose={() => setAction(null)} onDone={() => setAction(null)} />
      )}
      <Toasts />
    </div>
  );
}

function userText(content: AiChatMessage["content"]): string {
  if (content && typeof content === "object" && "text" in content) return content.text ?? "";
  return "";
}

// ===== Bąbelki =====
function UserBubble({ text }: { text: string }) {
  return (
    <div className="msg-row mine">
      <div className="msg-bubble">
        <div className="m-head"><b>Ty</b></div>
        <div className="m-body">{text}</div>
      </div>
    </div>
  );
}

function AiBubble({ reply, onAction }: { reply: AiReply; onAction: (a: { product: AiProduct; mode: "task" | "cart" }) => void }) {
  const products = Array.isArray(reply.products) ? reply.products : [];
  return (
    <div className="msg-row">
      <div className="msg-bubble ai-bubble">
        <div className="m-head"><b>✨ Asystent</b></div>
        <div className="m-body ai-answer">{reply.answer}</div>
        {products.length > 0 && (
          <div className="ai-products">
            {products.map((p, i) => (
              <AiProductCard key={p.name + i} product={p} onAction={onAction} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ===== Karta produktu AI (draggable) =====
export function AiProductCard({
  product, onAction,
}: {
  product: AiProduct;
  onAction?: (a: { product: AiProduct; mode: "task" | "cart" }) => void;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className={"ai-card" + (dragging ? " dragging" : "")}
      draggable
      onDragStart={(e) => {
        setDragging(true);
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData("application/x-klinika-product", JSON.stringify(product));
      }}
      onDragEnd={() => setDragging(false)}
    >
      <div className="ai-card-head">
        <span className="ai-card-grip" title="Przeciągnij na kanban lub do koszyka">⠿</span>
        <span className="ai-card-name">{product.name}</span>
        <span className="ai-card-price">{fmtMoney(product.price)}</span>
      </div>
      <div className="ai-card-meta">
        {product.supplier && <span>🏭 {product.supplier}</span>}
        {product.url && (
          <a href={product.url} target="_blank" rel="noreferrer" title={product.url} onClick={(e) => e.stopPropagation()}>
            🔗 Oferta
          </a>
        )}
      </div>
      {product.reason && <div className="ai-card-reason">💡 {product.reason}</div>}
      {onAction && (
        <div className="ai-card-actions">
          <button className="btn small" onClick={() => onAction({ product, mode: "task" })}>📋 Przenieś do zadań</button>
          <button className="btn small accent" onClick={() => onAction({ product, mode: "cart" })}>🛒 Dodaj do koszyka</button>
        </div>
      )}
    </div>
  );
}

// ===== Modal: przenieś do zadań =====
function ToTaskModal({ product, onClose, onDone }: { product: AiProduct; onClose: () => void; onDone: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.get<Project[]>("/api/projects")
      .then((ps) => { setProjects(ps); if (ps[0]) setProjectId(ps[0].id); })
      .catch((e: any) => pushToast(false, e?.message || "Nie udało się pobrać projektów"));
  }, []);

  useEffect(() => {
    if (!projectId) { setBranches([]); return; }
    api.get<{ branches: Branch[] }>("/api/projects/" + projectId + "/branches")
      .then((d) => setBranches(d.branches))
      .catch(() => {});
  }, [projectId]);

  async function submit() {
    setErr("");
    if (!projectId) { setErr("Wybierz projekt"); return; }
    setBusy(true);
    const description = [
      product.reason,
      product.price ? "Cena: " + fmtMoney(product.price) : "",
      product.supplier ? "Dostawca: " + product.supplier : "",
      product.url ? "Link: " + product.url : "",
    ].filter(Boolean).join("\n");
    try {
      const res = await api.post<{ task: Task }>("/api/projects/" + projectId + "/tasks", {
        title: "[AI] " + product.name,
        description,
        branchId: branchId || null,
        status,
        priority: "medium",
        aiSource: { type: "product", product },
      });
      pushToast(true, "Zadanie utworzone: „" + res.task.title + "”");
      onDone();
    } catch (e: any) {
      setErr(e?.message || "Nie udało się utworzyć zadania");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h2>📋 Przenieś do zadań</h2>
        <p className="muted-text" style={{ fontSize: 13 }}>„{product.name}” · {fmtMoney(product.price)}</p>
        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
          <label className="field">
            Projekt
            <select className="input" value={projectId} onChange={(e) => { setProjectId(e.target.value); setBranchId(""); }}>
              <option value="">— wybierz projekt —</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>)}
            </select>
          </label>
          <div className="row">
            <label className="field">
              Gałąź
              <select className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">— bez gałęzi —</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            <label className="field">
              Status
              <select className="input" value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
                {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.emoji} {s.label}</option>)}
              </select>
            </label>
          </div>
        </div>
        {err && <div className="login-error" style={{ marginTop: 12 }}>⚠️ {err}</div>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>Anuluj</button>
          <button className="btn accent" disabled={busy} onClick={submit}>{busy ? "Tworzenie…" : "Utwórz zadanie"}</button>
        </div>
      </div>
    </div>
  );
}

// ===== Modal: dodaj do koszyka =====
function ToCartModal({ product, onClose, onDone }: { product: AiProduct; onClose: () => void; onDone: () => void }) {
  const [carts, setCarts] = useState<CartSummary[]>([]);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [cartId, setCartId] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.get<CartSummary[]>("/api/carts")
      .then((cs) => { setCarts(cs); if (cs[0]) setCartId(cs[0].id); })
      .catch((e: any) => pushToast(false, e?.message || "Nie udało się pobrać koszyków"));
  }, []);

  async function submit() {
    setErr("");
    setBusy(true);
    try {
      let target = cartId;
      if (mode === "new") {
        const name = newName.trim() || "Zakupy: " + product.name.slice(0, 40);
        const res = await api.post<{ cart: CartSummary }>("/api/carts", { name });
        target = res.cart.id;
      }
      if (!target) { setErr("Wybierz koszyk lub utwórz nowy"); setBusy(false); return; }
      await api.post("/api/carts/" + target + "/items", {
        name: product.name,
        price: product.price,
        quantity: 1,
        url: product.url || undefined,
        supplier: product.supplier || undefined,
      });
      pushToast(true, "Dodano do koszyka: " + product.name);
      onDone();
    } catch (e: any) {
      setErr(e?.message || "Nie udało się dodać do koszyka");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h2>🛒 Dodaj do koszyka</h2>
        <p className="muted-text" style={{ fontSize: 13 }}>„{product.name}” · {fmtMoney(product.price)}</p>
        <div className="seg" style={{ marginTop: 12 }}>
          <button className={"seg-btn" + (mode === "existing" ? " active" : "")} onClick={() => setMode("existing")}>📦 Istniejący</button>
          <button className={"seg-btn" + (mode === "new" ? " active" : "")} onClick={() => setMode("new")}>＋ Nowy koszyk</button>
        </div>
        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
          {mode === "existing" ? (
            <label className="field">
              Koszyk
              <select className="input" value={cartId} onChange={(e) => setCartId(e.target.value)}>
                <option value="">— wybierz koszyk —</option>
                {carts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} · {c.itemCount} poz. · {fmtMoney(c.total)}</option>
                ))}
              </select>
            </label>
          ) : (
            <label className="field">
              Nazwa nowego koszyka
              <input className="input" autoFocus value={newName} maxLength={200} placeholder={"np. " + product.name.slice(0, 40)}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
            </label>
          )}
        </div>
        {err && <div className="login-error" style={{ marginTop: 12 }}>⚠️ {err}</div>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>Anuluj</button>
          <button className="btn accent" disabled={busy} onClick={submit}>{busy ? "Dodawanie…" : "Dodaj"}</button>
        </div>
      </div>
    </div>
  );
}
