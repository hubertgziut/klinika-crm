import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type User } from "../api";
import { getSocket } from "../socket";
import { useApp } from "../store";
import Avatar from "../components/Avatar";
import Toasts from "../components/Toasts";
import { pushToast } from "../toast";
import type { Channel, ChatMessage } from "../types";

export default function Chat() {
  const user = useApp((s) => s.user)!;
  const channels = useApp((s) => s.channels);
  const presence = useApp((s) => s.presence);
  const refreshChannels = useApp((s) => s.refreshChannels);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState<Record<string, string>>({});
  const [showChannelModal, setShowChannelModal] = useState(false);
  const [showDmModal, setShowDmModal] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef<string | null>(null);
  const typingTimers = useRef<Record<string, number>>({});
  const lastTypingEmit = useRef(0);

  // pierwsze ładowanie: kanały + lista użytkowników (do DM)
  useEffect(() => {
    refreshChannels();
    api.get<User[]>("/api/users").then(setUsers).catch(() => {});
  }, [refreshChannels]);

  // wybierz pierwszy kanał, gdy lista jest pusta
  useEffect(() => {
    if (!activeId && channels.length > 0) setActiveId(channels[0].id);
  }, [channels, activeId]);

  const active = useMemo(() => channels.find((c) => c.id === activeId) ?? null, [channels, activeId]);

  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  const appendMessage = useCallback((m: ChatMessage) => {
    setMessages((prev) => {
      const cur = prev[m.channelId] ?? [];
      if (cur.some((x) => x.id === m.id)) return prev;
      return { ...prev, [m.channelId]: [...cur, m] };
    });
  }, []);

  const markRead = useCallback((channelId: string) => {
    api.post("/api/channels/" + channelId + "/read")
      .then(() => useApp.getState().refreshChannels())
      .catch(() => {});
  }, []);

  const loadMessages = useCallback(async (channelId: string) => {
    setLoadingMsgs(true);
    try {
      const msgs = await api.get<ChatMessage[]>("/api/channels/" + channelId + "/messages?limit=60");
      setMessages((prev) => ({ ...prev, [channelId]: msgs }));
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się pobrać wiadomości");
    } finally {
      setLoadingMsgs(false);
    }
  }, []);

  // otwarcie kanału: pobierz wiadomości + oznacz przeczytane (tylko dla członka)
  useEffect(() => {
    if (!activeId) return;
    if (active && active.isMember === false) return;
    loadMessages(activeId);
    markRead(activeId);
  }, [activeId, active, loadMessages, markRead]);

  // realtime: chat:message (dodawaj do aktywnego kanału) i chat:typing (wskaźnik pisania)
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onMessage = (data: unknown) => {
      const m = (data as { message?: ChatMessage })?.message;
      if (!m?.id) return;
      appendMessage(m);
      if (m.channelId === activeIdRef.current) markRead(m.channelId);
    };
    const onTyping = (data: unknown) => {
      const d = data as { channelId?: string; name?: string };
      const channelId = d?.channelId;
      if (!channelId) return;
      setTyping((prev) => ({ ...prev, [channelId]: d.name ?? "Ktoś" }));
      if (typingTimers.current[channelId]) window.clearTimeout(typingTimers.current[channelId]);
      typingTimers.current[channelId] = window.setTimeout(() => {
        setTyping((prev) => {
          const next = { ...prev };
          delete next[channelId];
          return next;
        });
      }, 3500);
    };
    socket.on("chat:message", onMessage);
    socket.on("chat:typing", onTyping);
    return () => {
      socket.off("chat:message", onMessage);
      socket.off("chat:typing", onTyping);
    };
  }, [appendMessage, markRead]);

  // autoprzewijanie na dół przy nowych wiadomościach
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, activeId]);

  function onInputChange(v: string) {
    setInput(v);
    const now = Date.now();
    if (activeId && now - lastTypingEmit.current > 2000) {
      lastTypingEmit.current = now;
      getSocket()?.emit("chat:typing", { channelId: activeId });
    }
  }

  async function send() {
    const body = input.trim();
    if (!body || !activeId) return;
    setInput("");
    try {
      const res = await api.post<{ message: ChatMessage }>("/api/channels/" + activeId + "/messages", { body });
      appendMessage(res.message);
      markRead(activeId);
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się wysłać wiadomości");
      setInput(body);
    }
  }

  function selectChannel(id: string) {
    setActiveId(id);
    setTyping((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  async function joinChannel() {
    if (!active || active.isMember !== false) return;
    try {
      const res = await api.post<{ channel: Channel }>("/api/channels/" + active.id + "/join");
      pushToast(true, "Dołączono do #" + active.name);
      const joined = res.channel;
      setMessages((prev) => ({ ...prev, [joined.id]: prev[joined.id] ?? [] }));
      await useApp.getState().refreshChannels();
      setActiveId(joined.id);
      loadMessages(joined.id);
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się dołączyć do kanału");
    }
  }

  const channelList = channels.filter((c) => c.kind === "channel");
  const dmList = channels.filter((c) => c.kind === "dm");
  const activeMsgs = activeId ? messages[activeId] ?? [] : [];
  const typingName = activeId ? typing[activeId] : undefined;
  const onlineCount = active ? active.members.filter((m) => presence[m.id]).length : 0;

  return (
    <div className="page chat-page">
      <div className="chat">
        {/* ===== Lewa kolumna: kanały + DM ===== */}
        <aside className="chat-side">
          <div className="chat-side-head">
            <h2>Komunikator</h2>
            <button className="btn ghost small" title="Nowy kanał" aria-label="Nowy kanał" onClick={() => setShowChannelModal(true)}>＋</button>
            <button className="btn ghost small" title="Nowa wiadomość prywatna" aria-label="Nowa wiadomość prywatna" onClick={() => setShowDmModal(true)}>✉️</button>
          </div>
          <div className="chat-scroll">
            <div className="chat-sec">Kanały</div>
            {channelList.map((c) => (
              <ChannelItem key={c.id} channel={c} active={c.id === activeId} onClick={() => selectChannel(c.id)} />
            ))}
            <div className="chat-sec">Wiadomości prywatne</div>
            {dmList.map((c) => (
              <DmItem key={c.id} channel={c} active={c.id === activeId} online={presence[c.members[0]?.id ?? ""]} onClick={() => selectChannel(c.id)} />
            ))}
            {channels.length === 0 && (
              <div className="chat-empty">
                <div className="big">💬</div>
                <p>Brak rozmów. Utwórz kanał lub napisz wiadomość prywatną.</p>
                <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12 }}>
                  <button className="btn accent small" onClick={() => setShowChannelModal(true)}>＋ Kanał</button>
                  <button className="btn small" onClick={() => setShowDmModal(true)}>✉️ DM</button>
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* ===== Prawa: nagłówek + wiadomości + wejście ===== */}
        <section className="chat-main">
          {!active ? (
            <div className="chat-empty" style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <div className="big">💬</div>
              <p>Wybierz kanał lub rozpocznij nową rozmowę.</p>
            </div>
          ) : active.kind === "channel" && !active.isMember ? (
            <div className="chat-join" style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 30, textAlign: "center" }}>
              <span className="ch-item-icon" style={{ width: 52, height: 52, fontSize: 24, borderRadius: 14 }}>#</span>
              <h3 style={{ fontSize: 18, fontWeight: 800 }}>{active.name}</h3>
              {active.topic && <p style={{ color: "var(--muted)", maxWidth: 420, lineHeight: 1.5 }}>{active.topic}</p>}
              <p style={{ color: "var(--muted)", fontSize: 13 }}>Nie jesteś członkiem tego kanału. Dołącz, aby czytać i pisać wiadomości.</p>
              <button className="btn accent" style={{ marginTop: 10 }} onClick={joinChannel}>＋ Dołącz do kanału</button>
            </div>
          ) : (
            <>
              <header className="chat-head">
                {active.kind === "dm" ? (
                  <h3>
                    <Avatar name={active.members[0]?.name ?? "?"} color={active.members[0]?.avatarColor ?? "#ff6b5e"} size={30} />
                    {active.name}
                    <span className={"presence-dot" + (presence[active.members[0]?.id ?? ""] ? " on" : "")} />
                  </h3>
                ) : (
                  <h3><span className="ch-item-icon">#</span>{active.name}</h3>
                )}
                {active.kind === "channel" && active.topic && <span className="topic">{active.topic}</span>}
                <span className="spacer" style={{ flex: 1 }} />
                <span className="members">
                  {active.kind === "channel" ? (
                    <>
                      <span className="avatar-stack">
                        {active.members.slice(0, 5).map((m) => (
                          <span key={m.id} title={m.name}>
                            <Avatar name={m.name} color={m.avatarColor} size={24} />
                          </span>
                        ))}
                        {active.members.length > 5 && <span className="avatar more">+{active.members.length - 5}</span>}
                      </span>
                      <span>{active.members.length} czł. · <span className={"presence-dot" + (onlineCount > 0 ? " on" : "")} /> {onlineCount} online</span>
                    </>
                  ) : (
                    <span>{active.members.length} czł.</span>
                  )}
                </span>
              </header>

              <div className="chat-msgs" ref={listRef}>
                {activeMsgs.length === 0 && !loadingMsgs && (
                  <div className="chat-empty" style={{ padding: "30px 10px" }}>
                    <p>Brak wiadomości — napisz pierwszą!</p>
                  </div>
                )}
                {loadingMsgs && activeMsgs.length === 0 && (
                  <div className="chat-empty" style={{ padding: "30px 10px" }}><p>Ładowanie…</p></div>
                )}
                {activeMsgs.map((m) => (
                  <MessageRow key={m.id} m={m} mine={m.userId === user.id} />
                ))}
              </div>

              {typingName && <div className="chat-typing">{typingName} pisze…</div>}

              <div className="chat-input">
                <textarea
                  className="input"
                  rows={1}
                  placeholder={active.kind === "dm" ? ("Napisz do " + active.name + "…") : ("Napisz do #" + active.name + "…")}
                  value={input}
                  maxLength={10000}
                  onChange={(e) => onInputChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                  }}
                />
                <button className="btn accent" disabled={!input.trim()} onClick={send}>Wyślij</button>
              </div>
            </>
          )}
        </section>
      </div>

      {showChannelModal && (
        <ChannelFormModal
          onClose={() => setShowChannelModal(false)}
          onCreated={(c) => { setShowChannelModal(false); selectChannel(c.id); refreshChannels(); }}
        />
      )}
      {showDmModal && (
        <DmModal
          users={users}
          onClose={() => setShowDmModal(false)}
          onCreated={(c) => { setShowDmModal(false); selectChannel(c.id); refreshChannels(); }}
        />
      )}
      <Toasts />
    </div>
  );
}

// ===== Pozycja kanału na liście =====
function ChannelItem({ channel, active, onClick }: { channel: Channel; active: boolean; onClick: () => void }) {
  const joined = channel.isMember !== false;
  return (
    <button className={"chat-item" + (active ? " active" : "")} onClick={onClick} aria-label={"Kanał " + channel.name}>
      <span className="ch-item-icon">#</span>
      <span className="meta">
        <b>{channel.name}</b>
        <span>{channel.topic || "Brak tematu"}</span>
        {channel.lastMessage && (
          <span className="last-txt">{channel.lastMessage.author.name}: {channel.lastMessage.body}</span>
        )}
      </span>
      {!joined ? (
        <span className="ch-join-badge">Dołącz</span>
      ) : channel.unread > 0 ? (
        <span className="ch-badge">{channel.unread > 99 ? "99+" : channel.unread}</span>
      ) : null}
    </button>
  );
}

// ===== Pozycja DM na liście =====
function DmItem({ channel, active, online, onClick }: { channel: Channel; active: boolean; online?: boolean; onClick: () => void }) {
  const other = channel.members[0];
  return (
    <button className={"chat-item" + (active ? " active" : "")} onClick={onClick}>
      <span className="dm-avatar">
        <Avatar name={other?.name ?? "?"} color={other?.avatarColor ?? "#ff6b5e"} size={32} />
        <span className={"presence-dot" + (online ? " on" : "")} />
      </span>
      <span className="meta">
        <b>{channel.name}</b>
        {channel.lastMessage ? (
          <span className="last-txt">{channel.lastMessage.body}</span>
        ) : (
          <span>Brak wiadomości</span>
        )}
      </span>
      {channel.unread > 0 && <span className="ch-badge">{channel.unread > 99 ? "99+" : channel.unread}</span>}
    </button>
  );
}

// ===== Bąbelek wiadomości =====
function MessageRow({ m, mine }: { m: ChatMessage; mine: boolean }) {
  return (
    <div className={"msg-row" + (mine ? " mine" : "")}>
      {!mine && <Avatar name={m.author.name} color={m.author.avatarColor} size={30} />}
      <div className="msg-bubble">
        <div className="m-head">
          {!mine && <b style={{ fontSize: 12, color: "var(--text)" }}>{m.author.name}</b>}
          <span>{fmtTime(m.createdAt)}</span>
        </div>
        <div className="m-body">{m.body}</div>
      </div>
    </div>
  );
}

// ===== Modal: nowy kanał =====
function ChannelFormModal({ onClose, onCreated }: { onClose: () => void; onCreated: (c: Channel) => void }) {
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    setErr("");
    if (!name.trim()) { setErr("Podaj nazwę kanału"); return; }
    setBusy(true);
    try {
      const res = await api.post<{ channel: Channel }>("/api/channels", { name: name.trim(), topic });
      onCreated(res.channel);
    } catch (e: any) {
      setErr(e?.message || "Nie udało się utworzyć kanału");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h2>＋ Nowy kanał</h2>
        <div style={{ display: "grid", gap: 12 }}>
          <label className="field">
            Nazwa
            <input className="input" autoFocus maxLength={120} value={name} placeholder="np. recepcja"
              onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
          </label>
          <label className="field">
            Temat (opcjonalnie)
            <input className="input" maxLength={500} value={topic} placeholder="Do czego służy kanał?"
              onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
          </label>
        </div>
        {err && <div className="login-error" style={{ marginTop: 12 }}>⚠️ {err}</div>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>Anuluj</button>
          <button className="btn accent" disabled={busy} onClick={submit}>{busy ? "Tworzenie…" : "Utwórz kanał"}</button>
        </div>
      </div>
    </div>
  );
}

// ===== Modal: nowa wiadomość prywatna =====
function DmModal({ users, onClose, onCreated }: { users: User[]; onClose: () => void; onCreated: (c: Channel) => void }) {
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    setErr("");
    if (!userId) { setErr("Wybierz osobę"); return; }
    setBusy(true);
    try {
      const res = await api.post<{ channel: Channel }>("/api/channels/dm", { userId });
      onCreated(res.channel);
    } catch (e: any) {
      setErr(e?.message || "Nie udało się utworzyć czatu");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h2>✉️ Nowa wiadomość prywatna</h2>
        <label className="field">
          Osoba
          <select className="input" autoFocus value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">— wybierz —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
            ))}
          </select>
        </label>
        {err && <div className="login-error" style={{ marginTop: 12 }}>⚠️ {err}</div>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>Anuluj</button>
          <button className="btn accent" disabled={busy} onClick={submit}>{busy ? "Tworzenie…" : "Rozpocznij czat"}</button>
        </div>
      </div>
    </div>
  );
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
}
