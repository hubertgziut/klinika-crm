import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";

export const newId = () => randomBytes(12).toString("hex");
export const nowISO = () => new Date().toISOString();
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }).toString("hex");
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt}$${hash}`;
}
export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [alg, Ns, rs, ps, salt, hash] = stored.split("$");
    if (alg !== "scrypt") return false;
    const candidate = scryptSync(password, salt, SCRYPT.keylen, {
      N: Number(Ns), r: Number(rs), p: Number(ps),
    });
    const expected = Buffer.from(hash, "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

export function camelKeys<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
  }
  return out;
}
export const camelRow = <T>(row: T): T => camelKeys(row as Record<string, unknown>) as T;
export const mapRows = <T extends Record<string, unknown>>(rows: T[]): T[] => rows.map(camelRow);

export function safeParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

export function fmtMoney(n: number): string {
  return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" }).format(n || 0);
}
