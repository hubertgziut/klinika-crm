import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Extension, mergeAttributes } from "@tiptap/core";
import { api } from "../api";
import Toasts from "../components/Toasts";
import { pushToast } from "../toast";
import type { DocFull, UploadInfo } from "../types";

// ===== Dokumenty (Faza 4): edytor TipTap + autozapis + załączniki =====

// Minimalna rozszerzenie linku (brak @tiptap/extension-link w zależnościach)
const LinkMark = Extension.create({
  name: "link",
  addAttributes() {
    return {
      href: { default: null },
      target: { default: "_blank" },
      rel: { default: "noopener noreferrer nofollow" },
    };
  },
  parseHTML() {
    return [{
      tag: "a[href]",
      getAttrs: (dom: HTMLElement | string) => {
        const el = dom as HTMLAnchorElement;
        return { href: el.getAttribute("href"), target: el.getAttribute("target"), rel: el.getAttribute("rel") };
      },
    }];
  },
  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, any> }) {
    return ["a", mergeAttributes(HTMLAttributes), 0];
  },
  addCommands() {
    return {
      setLink: (href: string) => ({ commands }) => commands.setMark("link", { href }),
      unsetLink: () => ({ commands }) => commands.unsetMark("link"),
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    link: {
      setLink: (href: string) => ReturnType;
      unsetLink: () => ReturnType;
    };
  }
}

export default function DocEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<DocFull | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.get<{ document: DocFull; uploads: UploadInfo[] }>("/api/documents/" + id);
      setDoc({ ...data.document, uploads: data.uploads });
    } catch {
      pushToast(false, "Nie znaleziono dokumentu");
      setMissing(true);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (missing) {
    return (
      <div className="page">
        <Link to="/dokumenty" className="back-link">← Dokumenty</Link>
        <div className="panel" style={{ marginTop: 14 }}>
          <div className="empty"><div className="big">📄</div><p>Nie znaleziono dokumentu.</p></div>
        </div>
        <Toasts />
      </div>
    );
  }
  if (!doc) {
    return <div className="page"><div className="empty"><div className="big">📄</div><p>Ładowanie…</p></div></div>;
  }
  return <EditorBody key={doc.id} doc={doc} onBack={() => navigate("/dokumenty")} />;
}

function EditorBody({ doc, onBack }: { doc: DocFull; onBack: () => void }) {
  const [title, setTitle] = useState(doc.title);
  const [uploads, setUploads] = useState<UploadInfo[]>(doc.uploads);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef(title);
  titleRef.current = title;
  const contentRef = useRef<string | null>(null);

  const persist = useCallback(async (t: string, c: string | null) => {
    const body: { title?: string; content?: string } = {};
    if (t !== doc.title) body.title = t;
    if (c !== null && c !== doc.content) body.content = c;
    if (Object.keys(body).length === 0) { setSaveState("idle"); return; }
    setSaveState("saving");
    try {
      await api.patch("/api/documents/" + doc.id, body);
      setSaveState("saved");
      setLastSaved(new Date().toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" }));
    } catch (e: any) {
      setSaveState("idle");
      pushToast(false, e?.message || "Nie udało się zapisać dokumentu");
    }
  }, [doc.id, doc.title, doc.content]);

  const scheduleSave = useCallback((t: string, c: string | null) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState("saving");
    saveTimer.current = setTimeout(() => { persist(t, c); }, 800);
  }, [persist]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder: "Napisz treść dokumentu…" }),
      LinkMark,
    ],
    content: doc.content || "",
    onUpdate: ({ editor: ed }) => {
      contentRef.current = ed.getHTML();
      scheduleSave(titleRef.current, contentRef.current);
    },
  });

  // przy zamknięciu — zapisz zaległe zmiany
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const body: { title?: string; content?: string } = {};
      if (titleRef.current !== doc.title) body.title = titleRef.current;
      if (contentRef.current !== null && contentRef.current !== doc.content) body.content = contentRef.current;
      if (Object.keys(body).length > 0) {
        api.patch("/api/documents/" + doc.id, body).catch(() => {});
      }
    };
  }, [doc.id, doc.title, doc.content]);

  function onTitleChange(v: string) {
    setTitle(v);
    scheduleSave(v, contentRef.current);
  }

  function setLink() {
    if (!editor) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Adres URL linku:", prev ?? "https://");
    if (url === null) return;
    if (url.trim() === "") { editor.chain().focus().unsetLink().run(); return; }
    editor.chain().focus().setLink(url.trim()).run();
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/documents/" + doc.id + "/upload", { method: "POST", body: fd, credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any).error || "Błąd przesyłania pliku");
      setUploads((prev) => [data.upload as UploadInfo, ...prev]);
      pushToast(true, "Plik dodany");
    } catch (err: any) {
      pushToast(false, err?.message || "Nie udało się przesłać pliku");
    }
  }

  async function removeUpload(u: UploadInfo) {
    if (!window.confirm("Usunąć plik „" + u.filename + "?")) return;
    try {
      await api.del("/api/uploads/" + u.id);
      setUploads((prev) => prev.filter((x) => x.id !== u.id));
      pushToast(true, "Plik usunięty");
    } catch (e: any) {
      pushToast(false, e?.message || "Nie udało się usunąć pliku");
    }
  }

  return (
    <div className="page doc-page">
      <div className="page-head" style={{ marginBottom: 12 }}>
        <button className="btn ghost" onClick={onBack}>← Dokumenty</button>
        <span className="ss-save-ind" style={{ marginLeft: 4 }}>
          {saveState === "saving" ? "Zapisano…" : saveState === "saved" ? "✓ Zapisano" + (lastSaved ? " " + lastSaved : "") : ""}
        </span>
        <span className="spacer" />
        <label className="btn accent small" style={{ cursor: "pointer" }}>
          ⬆ Dodaj plik
          <input type="file" hidden onChange={onUpload} />
        </label>
      </div>

      <div className="panel doc-panel">
        <input
          className="doc-title-input"
          value={title}
          maxLength={300}
          placeholder="Tytuł dokumentu"
          onChange={(e) => onTitleChange(e.target.value)}
        />

        <div className="toolbar">
          <ToolBtn title="Pogrubienie (Ctrl+B)" active={editor?.isActive("bold") ?? false}
            onClick={() => editor?.chain().focus().toggleBold().run()}>
            <b>B</b>
          </ToolBtn>
          <ToolBtn title="Kursywa (Ctrl+I)" active={editor?.isActive("italic") ?? false}
            onClick={() => editor?.chain().focus().toggleItalic().run()}>
            <i>I</i>
          </ToolBtn>
          <ToolBtn title="Przekreślenie" active={editor?.isActive("strike") ?? false}
            onClick={() => editor?.chain().focus().toggleStrike().run()}>
            <s>S</s>
          </ToolBtn>
          <span className="tool-sep" />
          <ToolBtn title="Nagłówek 1" active={editor?.isActive("heading", { level: 1 }) ?? false}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}>H1</ToolBtn>
          <ToolBtn title="Nagłówek 2" active={editor?.isActive("heading", { level: 2 }) ?? false}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>H2</ToolBtn>
          <ToolBtn title="Nagłówek 3" active={editor?.isActive("heading", { level: 3 }) ?? false}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}>H3</ToolBtn>
          <span className="tool-sep" />
          <ToolBtn title="Lista punktowana" active={editor?.isActive("bulletList") ?? false}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}>• Lista</ToolBtn>
          <ToolBtn title="Lista numerowana" active={editor?.isActive("orderedList") ?? false}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}>1. Lista</ToolBtn>
          <ToolBtn title="Cytat" active={editor?.isActive("blockquote") ?? false}
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}>❝ Cytat</ToolBtn>
          <ToolBtn title="Link" active={editor?.isActive("link") ?? false} onClick={setLink}>🔗 Link</ToolBtn>
          <span className="tool-sep" />
          <ToolBtn title="Wyczyść formatowanie"
            onClick={() => editor?.chain().focus().clearNodes().unsetAllMarks().run()}>🧹</ToolBtn>
        </div>

        <div className="doc-editor">
          <EditorContent editor={editor} />
        </div>
      </div>

      <div className="panel doc-uploads">
        <div className="panel-title">📎 Załączniki <span className="badge">{uploads.length}</span></div>
        {uploads.length === 0 ? (
          <p className="muted-text" style={{ fontSize: 13 }}>Brak załączników — dodaj plik przyciskiem „⬆ Dodaj plik”.</p>
        ) : (
          <ul className="up-list">
            {uploads.map((u) => (
              <li key={u.id} className="up-item">
                <span className="up-icon">📄</span>
                <span className="up-meta">
                  <a href={"/uploads/" + encodeURIComponent(u.storedName)} target="_blank" rel="noreferrer" className="up-name">{u.filename}</a>
                  <span className="up-sub">{fmtSize(u.size)} · {fmtDate(u.createdAt)}</span>
                </span>
                <span className="spacer" />
                <a className="btn small" href={"/uploads/" + encodeURIComponent(u.storedName)} download={u.filename} title="Pobierz" aria-label="Pobierz">⬇</a>
                <button className="btn small danger" title="Usuń plik" aria-label="Usuń plik" onClick={() => removeUpload(u)}>🗑</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Toasts />
    </div>
  );
}

function ToolBtn({ active, onClick, title, children }: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={"tool-btn" + (active ? " active" : "")}
      title={title}
      aria-label={title}
      aria-pressed={active ?? undefined}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1).replace(".", ",") + " KB";
  return (bytes / 1024 / 1024).toFixed(1).replace(".", ",") + " MB";
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });
}
