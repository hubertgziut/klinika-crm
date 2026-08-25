import { getSetting, db } from "./db";

// ===== Faza 6+ — Asystent AI (OpenAI / DeepSeek): narzędzia, czat (function calling), organizacja danych =====

export function getOpenAIKey(): string {
  return getSetting("openai_key") || process.env.OPENAI_API_KEY || "";
}
export function getDeepSeekKey(): string {
  return getSetting("deepseek_key") || process.env.DEEPSEEK_API_KEY || "";
}
export function getDeepSeekModel(): string {
  return getSetting("deepseek_model") || process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
}

export type AiProvider = "openai" | "deepseek";
export interface AiStatus {
  demo: boolean;
  provider: AiProvider | "demo";
  model: string | null;
}

/** Który dostawca AI jest aktywny (auto → DeepSeek, gdy jest klucz; potem OpenAI). */
export function getAiProvider(): AiProvider | null {
  const pref = (getSetting("ai_provider") || process.env.AI_PROVIDER || "auto").toLowerCase();
  if (pref === "openai" && getOpenAIKey()) return "openai";
  if (pref === "deepseek" && getDeepSeekKey()) return "deepseek";
  if (pref !== "openai" && pref !== "deepseek") {
    if (getDeepSeekKey()) return "deepseek";
    if (getOpenAIKey()) return "openai";
  }
  return null;
}
export function isDemoMode(): boolean {
  return getAiProvider() === null;
}
export function getAiStatus(): AiStatus {
  const p = getAiProvider();
  if (p === "deepseek") return { demo: false, provider: "deepseek", model: getDeepSeekModel() };
  if (p === "openai") return { demo: false, provider: "openai", model: OPENAI_MODEL };
  return { demo: true, provider: "demo", model: null };
}

export interface AiMessage { role: "system" | "user" | "assistant"; content: string }

// ===== System prompt (polski) =====
export const SYSTEM_PROMPT =
  "Jesteś Asystentem AI kliniki w aplikacji Klinika CRM. Pomagasz zespołowi kliniki: " +
  "wyszukujesz produkty z inwentarza i koszyków, podsumowujesz zadania i projekty, proponujesz zakupy. " +
  "Odpowiadaj zwięźle po polsku. Gdy znajdziesz produkty, odpowiedz JSON-em: " +
  '{type:"products", answer:"...", products:[{name, price (liczba), url, supplier, reason}]}. ' +
  'Gdy odpowiadasz tekstem: {type:"text", answer:"..."}. Nie wymyślaj cen produktów spoza danych.';

// ===== Typy odpowiedzi =====
export interface AiProduct {
  name: string;
  price: number;
  url: string;
  supplier: string;
  reason?: string;
  quantity?: number;
}
export interface AiChatResult {
  type: "products" | "text";
  answer: string;
  products?: AiProduct[];
}

const OPENAI_MODEL = "gpt-4o-mini";
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

// ===== Narzędzia — wykonanie na bazie danych =====

const PRODUCT_SELECT =
  "SELECT p.*, i.quantity, i.min_quantity FROM products p LEFT JOIN inventory i ON i.product_id = p.id";

const mapProductRow = (r: any): AiProduct => ({
  name: r.name,
  price: round2(r.price),
  url: r.supplier_url ?? "",
  supplier: r.supplier ?? "",
  quantity: Number(r.quantity ?? 0),
  reason: productReason(r),
});

function queryProducts(like: string): any[] {
  return db.prepare(
    PRODUCT_SELECT +
    " WHERE (p.name LIKE ? COLLATE NOCASE OR p.category LIKE ? COLLATE NOCASE OR p.supplier LIKE ? COLLATE NOCASE OR p.sku LIKE ? COLLATE NOCASE)" +
    " ORDER BY p.name COLLATE NOCASE ASC LIMIT 12"
  ).all(like, like, like, like) as any[];
}

/** Wyszukiwanie produktów w inwentarzu + pozycjach koszyków (nazwa, kategoria, dostawca, SKU). */
export function searchProducts(query: string): AiProduct[] {
  const q = (query || "").trim();
  const like = "%" + q + "%";
  const out: AiProduct[] = queryProducts(like).map(mapProductRow);
  // Gdy pełna fraza nic nie daje — spróbuj pojedynczych słów (np. „środki dezynfekcyjne”)
  if (out.length === 0 && q.split(/\s+/).length > 1) {
    for (const w of q.split(/\s+/).filter((s) => s.length >= 2)) {
      const wl = "%" + w + "%";
      for (const r of queryProducts(wl)) {
        if (!out.some((p) => String(p.name).toLowerCase() === String(r.name).toLowerCase())) {
          out.push(mapProductRow(r));
          if (out.length >= 12) break;
        }
      }
      if (out.length >= 12) break;
    }
  }
  // Dodatkowe trafienia z koszyków (cart_items)
  if (q) {
    const cartHits = db.prepare(
      `SELECT ci.name, ci.price, ci.url, ci.supplier, ci.quantity, c.name AS cart_name
       FROM cart_items ci JOIN carts c ON c.id = ci.cart_id
       WHERE ci.name LIKE ? COLLATE NOCASE
       ORDER BY ci.name COLLATE NOCASE ASC LIMIT 8`
    ).all(like) as any[];
    for (const r of cartHits) {
      if (out.some((p) => String(p.name).toLowerCase() === String(r.name).toLowerCase())) continue;
      out.push({
        name: r.name,
        price: round2(r.price),
        url: r.url ?? "",
        supplier: r.supplier ?? "",
        quantity: Number(r.quantity ?? 0),
        reason: "Pozycja w koszyku „" + r.cart_name + "”",
      });
    }
  }
  return out;
}

function productReason(r: any): string {
  const qty = Number(r.quantity ?? 0);
  const min = Number(r.min_quantity ?? 0);
  if (r.min_quantity !== undefined && min > 0 && qty < min) {
    return "Niski stan w magazynie (zostało " + qty + ") — warto zamówić";
  }
  return qty > 0 ? "W inwentarzu kliniki (stan: " + qty + ")" : "Dostępny u dostawcy";
}

export interface AiTaskHit {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  projectName: string | null;
}

/** Wyszukiwanie zadań po tytule, opisie lub nazwie projektu. */
export function searchTasks(query: string): AiTaskHit[] {
  const q = (query || "").trim();
  const like = "%" + q + "%";
  const rows = db.prepare(
    `SELECT t.id, t.title, t.status, t.priority, t.due_date, p.name AS project_name
     FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
     WHERE (t.title LIKE ? COLLATE NOCASE OR t.description LIKE ? COLLATE NOCASE OR p.name LIKE ? COLLATE NOCASE)
     ORDER BY t.created_at DESC LIMIT 10`
  ).all(like, like, like) as any[];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    priority: r.priority,
    dueDate: r.due_date ?? null,
    projectName: r.project_name ?? null,
  }));
}

export interface AiSummary {
  projects: number;
  tasks: { todo: number; in_progress: number; review: number; done: number };
  totalTasks: number;
  openTasks: number;
  carts: number;
  lowStock: number;
  orders: number;
}

/** Liczniki do podsumowania workspace'u. */
export function getSummary(): AiSummary {
  const count = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
  const tasks: AiSummary["tasks"] = { todo: 0, in_progress: 0, review: 0, done: 0 };
  for (const r of db.prepare("SELECT status, COUNT(*) AS c FROM tasks GROUP BY status").all() as any[]) {
    if (r.status in tasks) tasks[r.status as keyof typeof tasks] = r.c;
  }
  const totalTasks = tasks.todo + tasks.in_progress + tasks.review + tasks.done;
  return {
    projects: count("SELECT COUNT(*) AS c FROM projects"),
    tasks,
    totalTasks,
    openTasks: totalTasks - tasks.done,
    carts: count("SELECT COUNT(*) AS c FROM carts"),
    lowStock: count("SELECT COUNT(*) AS c FROM inventory WHERE quantity < min_quantity"),
    orders: count("SELECT COUNT(*) AS c FROM orders"),
  };
}

// ===== OpenAI — function calling (fetch z timeout 30 s) =====

interface OpenAiMessage {
  role: string;
  content: string | null;
  tool_calls?: unknown;
  tool_call_id?: string;
  name?: string;
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_products",
      description: "Wyszukaj produkty w inwentarzu kliniki i koszykach (nazwa, kategoria, dostawca, SKU). Zwraca listę {name, price, supplier, url, quantity}.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Fraza wyszukiwania, np. „pralka” albo „środki dezynfekcyjne”" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_tasks",
      description: "Wyszukaj zadania po tytule, opisie lub nazwie projektu.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Fraza wyszukiwania, np. „pralka”" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_summary",
      description: "Zwraca liczniki workspace'u: projekty, zadania wg statusu, koszyki, produkty z niskim stanem, zamówienia.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
];

function runTool(name: string, args: unknown): string {
  const a = (args ?? {}) as Record<string, unknown>;
  switch (name) {
    case "search_products":
      return JSON.stringify(searchProducts(typeof a.query === "string" ? a.query : ""));
    case "search_tasks":
      return JSON.stringify(searchTasks(typeof a.query === "string" ? a.query : ""));
    case "get_summary":
      return JSON.stringify(getSummary());
    default:
      return JSON.stringify({ error: "Nieznane narzędzie: " + name });
  }
}

interface ChatApiConfig {
  label: string;
  baseUrl: string;
  key: string;
  model: string;
}

/** Konfiguracja aktywnego dostawcy AI (DeepSeek / OpenAI) — null = tryb demo. */
function getChatConfig(): ChatApiConfig | null {
  const p = getAiProvider();
  if (p === "deepseek") {
    return { label: "DeepSeek", baseUrl: "https://api.deepseek.com", key: getDeepSeekKey(), model: getDeepSeekModel() };
  }
  if (p === "openai") {
    return { label: "OpenAI", baseUrl: "https://api.openai.com/v1", key: getOpenAIKey(), model: OPENAI_MODEL };
  }
  return null;
}

/** Wywołanie chat/completions (OpenAI-kompatybilne API — działa też dla DeepSeek). */
async function callChatCompletions(cfg: ChatApiConfig, messages: OpenAiMessage[], withTools: boolean): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const body: Record<string, unknown> = { model: cfg.model, messages, temperature: 0.3, max_tokens: 1600 };
    if (withTools) body.tools = TOOLS;
    const res = await fetch(cfg.baseUrl + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`${cfg.label} ${res.status}: ${t.slice(0, 220)}`);
    }
    return await res.json();
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error(`Przekroczono czas odpowiedzi ${cfg.label} (30 s)`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Czat: pełny tryb z function calling (search_products / search_tasks / get_summary);
 * tryb demo — te same narzędzia wykonane lokalnie na bazie + znane przykłady.
 * Zwraca surową treść odpowiedzi (JSON) do sparsowania przez route.
 */
export async function aiChat(messages: AiMessage[]): Promise<string> {
  const cfg = getChatConfig();
  if (!cfg) return demoReply(messages);
  const openAiMessages: OpenAiMessage[] = messages.map((m) => ({ role: m.role, content: m.content }));
  let data: any;
  for (let i = 0; i < 4; i++) {
    data = await callChatCompletions(cfg, openAiMessages, true);
    const msg = data?.choices?.[0]?.message;
    const toolCalls: any[] = Array.isArray(msg?.tool_calls) ? msg.tool_calls : [];
    if (toolCalls.length > 0) {
      openAiMessages.push({ role: "assistant", content: msg?.content ?? null, tool_calls: msg.tool_calls });
      for (const tc of toolCalls) {
        let args: unknown = {};
        try { args = JSON.parse(tc?.function?.arguments ?? "{}"); } catch { /* zignoruj zepsuty JSON */ }
        openAiMessages.push({
          role: "tool",
          tool_call_id: tc?.id ?? "",
          name: tc?.function?.name ?? "",
          content: runTool(tc?.function?.name ?? "", args),
        });
      }
      continue;
    }
    break;
  }
  return data?.choices?.[0]?.message?.content ?? "";
}

// ===== Parsowanie odpowiedzi AI → {type, answer, products?} =====

export function parseAiContent(content: string): AiChatResult {
  const parsed = parseJsonObject(content);
  if (parsed) {
    const type = parsed.type === "products" ? "products" : "text";
    const answer = typeof parsed.answer === "string" ? parsed.answer : "";
    let products: AiProduct[] | undefined;
    if (type === "products" && Array.isArray(parsed.products)) {
      products = parsed.products
        .filter((p: unknown) => p && typeof p === "object")
        .map((p: any) => ({
          name: String(p.name ?? "Produkt"),
          price: Number(p.price) || 0,
          url: String(p.url ?? ""),
          supplier: String(p.supplier ?? ""),
          reason: p.reason !== undefined && p.reason !== null ? String(p.reason) : undefined,
        }));
    }
    return {
      type,
      answer: answer || (type === "products" ? "Znalazłem produkty:" : content),
      products,
    };
  }
  return { type: "text", answer: content.trim() || "…" };
}

function parseJsonObject(content: string): any {
  const trimmed = content.trim();
  const m = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidate = m ? m[1] : trimmed;
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// ===== Organizacja danych („Segreguj dane”) =====

export interface OrganizeColumn { key: string; label: string }
export interface OrganizeRow { id?: string; cells: Record<string, unknown> }

/**
 * Posegregowanie wierszy tabeli: pełny tryb → OpenAI (JSON {order:[...]} lub {rows:[...]});
 * tryb demo → sortowanie po pierwszej kolumnie liczbowej (rosnąco) lub alfabetycznie;
 * błędna odpowiedź AI → dane bez zmian.
 */
export async function organizeData(columns: OrganizeColumn[], rows: OrganizeRow[]): Promise<{ rows: OrganizeRow[] }> {
  if (rows.length < 2) return { rows };
  const cfg = getChatConfig();
  if (!cfg) return { rows: demoOrganize(columns, rows) };
  try {
    const sys =
      "Pomagasz w aplikacji Klinika CRM porządkować dane tabeli. Otrzymasz kolumny i wiersze jako JSON. " +
      "Posegreguj wiersze (posortuj lub pogrupuj sensownie, wybierając kryterium) i zwróć WYŁĄCZNIE obiekt JSON: " +
      '{"order":[indeksy wierszy w nowej kolejności]} LUB {"rows":[te same wiersze w nowej kolejności]}. ' +
      "Nie zmieniaj zawartości komórek ani liczby wierszy.";
    const data = await callChatCompletions(cfg, [
      { role: "system", content: sys },
      { role: "user", content: JSON.stringify({ columns, rows }) },
    ], false);
    const content = data?.choices?.[0]?.message?.content ?? "";
    const parsed = parseJsonObject(content);
    if (parsed && Array.isArray(parsed.order)) {
      const order = parsed.order.map((n: unknown) => Number(n));
      if (isPermutation(order, rows.length)) {
        return { rows: order.map((i: number) => rows[i]) };
      }
    }
    if (parsed && Array.isArray(parsed.rows) && parsed.rows.length === rows.length &&
        parsed.rows.every((r: unknown) => r && typeof r === "object")) {
      return { rows: parsed.rows as OrganizeRow[] };
    }
    return { rows }; // błędna odpowiedź AI — bez zmian
  } catch {
    return { rows }; // błąd AI — bez zmian
  }
}

function isPermutation(order: number[], len: number): boolean {
  if (order.length !== len) return false;
  const seen = new Set<number>();
  for (const n of order) {
    if (!Number.isInteger(n) || n < 0 || n >= len || seen.has(n)) return false;
    seen.add(n);
  }
  return true;
}

function demoOrganize(columns: OrganizeColumn[], rows: OrganizeRow[]): OrganizeRow[] {
  const cell = (r: OrganizeRow, key: string): string => {
    const v = r.cells[key];
    return v === null || v === undefined ? "" : String(v);
  };
  const numericCol = columns.find((c) => rows.some((r) => isNumeric(cell(r, c.key))));
  if (numericCol) {
    return [...rows].sort((a, b) => toNum(cell(a, numericCol.key)) - toNum(cell(b, numericCol.key)));
  }
  const first = columns[0]?.key;
  if (!first) return rows;
  return [...rows].sort((a, b) => cell(a, first).localeCompare(cell(b, first), "pl"));
}

function isNumeric(s: string): boolean {
  return Number.isFinite(toNum(s));
}
function toNum(s: string): number {
  const n = Number(String(s).trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

// ===== Tryb demo — intencje + odpowiedzi na bazie danych =====

const KNOWN_EXAMPLES: AiProduct[] = [
  { name: "Pralka Bosch WGB2440XPL", price: 2899, url: "https://www.mediaexpert.pl/", supplier: "MediaExpert", reason: "9 kg, klasa A, świetne opinie (przykład demo)" },
  { name: "Pralka LG F4WV510PS", price: 2499, url: "https://www.euro.com.pl/", supplier: "Euro AGD", reason: "AI DD 9 kg, o 400 zł taniej (przykład demo)" },
  { name: "Pralka Samsung WF90T5040", price: 2699, url: "https://www.mediaexpert.pl/", supplier: "MediaExpert", reason: "EcoBubble, dobra oferta (przykład demo)" },
];

function demoReply(messages: AiMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const intent = detectIntent(last);
  const q = extractQuery(last);

  if (intent === "products") {
    const found = searchProducts(q);
    const products: AiProduct[] = [...found];
    // Znane przykłady (np. pralki) — gdy baza nie ma trafień albo pytanie dotyczy AGD
    if (products.length === 0 || /pralk|lodowk|zmywar|suszark|zamrażark|zamrazark/.test(q)) {
      const needle = q.toLowerCase();
      for (const ex of KNOWN_EXAMPLES) {
        const match = /pralk/.test(needle) ? ex.name.toLowerCase().includes("pralka") : ex.name.toLowerCase().includes(needle);
        if (match && !products.some((p) => p.name === ex.name)) products.push(ex);
      }
    }
    const answer = products.length > 0
      ? "Znalazłem pasujące produkty (tryb demo — wyszukiwanie w inwentarzu kliniki):"
      : "Nie znalazłem pasujących produktów w inwentarzu (tryb demo). Spróbuj np. „znajdź środki dezynfekcyjne” albo „znajdź pralkę”.";
    return JSON.stringify({ type: "products", answer, products: products.slice(0, 8) });
  }

  if (intent === "summary") {
    const s = getSummary();
    const statuses = [
      "do zrobienia: " + s.tasks.todo,
      "w trakcie: " + s.tasks.in_progress,
      "do weryfikacji: " + s.tasks.review,
      "zrobione: " + s.tasks.done,
    ].join(", ");
    return JSON.stringify({
      type: "text",
      answer:
        "Podsumowanie (tryb demo):\n" +
        "• Projekty: " + s.projects + "\n" +
        "• Zadania: " + s.totalTasks + " (otwarte: " + s.openTasks + " — " + statuses + ")\n" +
        "• Koszyki zakupowe: " + s.carts + "\n" +
        "• Produkty z niskim stanem: " + s.lowStock + "\n" +
        "• Zamówienia: " + s.orders + "\n" +
        "Chcesz szczegóły? Zapytaj np. „znajdź produkty z niskim stanem” albo „wyszukaj zadania”.",
    });
  }

  if (intent === "tasks") {
    const hits = searchTasks(q);
    if (hits.length > 0) {
      const lines = hits.slice(0, 8).map((t) =>
        "• " + t.title + " [" + t.status + "]" + (t.projectName ? " (" + t.projectName + ")" : "")
      );
      return JSON.stringify({
        type: "text",
        answer:
          "Zadania pasujące do „" + (q || "wszystkich") + "” (tryb demo):\n" +
          lines.join("\n") + (hits.length > 8 ? "\n… oraz " + (hits.length - 8) + " więcej." : ""),
      });
    }
    return JSON.stringify({
      type: "text",
      answer: "Nie znalazłem zadań pasujących do „" + (q || "twojego zapytania") + "”. Spróbuj np. „wyszukaj zadania pralka” albo „podsumuj zadania”.",
    });
  }

  return JSON.stringify({
    type: "text",
    answer:
      "Jestem Asystentem AI kliniki (tryb demo). Mogę:\n" +
      "• wyszukać produkty z inwentarza i koszyków — np. „znajdź pralkę” albo „znajdź środki dezynfekcyjne”;\n" +
      "• podsumować projekty, zadania i zakupy — np. „podsumuj”;\n" +
      "• wyszukać zadania — np. „znajdź zadania o pralce”;\n" +
      "• uporządkować dane w tabelach — przycisk „✨ Segreguj dane” w module Tabele.\n" +
      "Dodanie klucza OpenAI lub DeepSeek w Ustawieniach włączy pełny tryb z wyszukiwaniem na żywo.",
  });
}

type Intent = "products" | "tasks" | "summary" | "text";

function detectIntent(text: string): Intent {
  const l = text.toLowerCase();
  if (/(podsumuj|statystyk|raport|ile (mam|mamy|jest|zostal))/.test(l)) return "summary";
  // wyraźne wyszukiwanie zadań: „znajdź zadania o pralce”, „wyszukaj zadania”
  if (/((znajdz|znajdź|wyszukaj|szukaj|szukam|pokaż|wypisz|podaj)[^.]{0,30}(zadan|task))/.test(l)) return "tasks";
  if (/(znajdz|znajdź|szukaj|wyszukaj|szukam|produkt|zakup|kup|koszyk|pralk|inwentarz|cena|dostawca|hurtown|stan magazyn)/.test(l)) return "products";
  if (/(zadan|zadania|task|projekt|termin|delegow)/.test(l)) return "tasks";
  return "text";
}

function extractQuery(text: string): string {
  const l = text.toLowerCase().trim();
  const cleaned = l
    .replace(/^(prosze |poprosze )?((znajdz|znajdź|wyszukaj|szukaj|szukam|pokaż|pokaż mi|wypisz|podaj|daj mi|ile kosztuje|co jest|jakie są|mam pytanie o|poszukaj) )+/i, "")
    .replace(/^(zadania|zadanie|zadan|taski|tasks?)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return cleaned || l;
}
