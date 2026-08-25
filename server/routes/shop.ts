import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { newId, nowISO } from "../util";
import { requireAuth } from "../auth";
import { emitToUser } from "../ws";
import { notifyOrderStatus } from "../mailer";

// ===== Faza 5 — Inwentarz, koszyki, zamówienia =====
// Router montowany na /api → obsługuje /api/products, /api/inventory,
// /api/carts (wraz z /items i /order) oraz /api/orders.
export const shopRouter = Router();
shopRouter.use(requireAuth);

const CART_STATUSES = ["new", "in_progress", "ordered", "delivered"] as const;
const ORDER_STATUSES = ["placed", "shipped", "delivered", "cancelled"] as const;

const cartStatusSchema = z.enum(CART_STATUSES);
const orderStatusSchema = z.enum(ORDER_STATUSES);

// ===== Schematy walidacji (zod) =====
const createProductSchema = z.object({
  name: z.string().min(1).max(300),
  category: z.string().max(100).optional(),
  unit: z.string().max(50).optional(),
  supplier: z.string().max(200).optional(),
  supplier_url: z.string().max(1000).optional(),
  supplierUrl: z.string().max(1000).optional(),
  price: z.number().min(0),
  sku: z.string().max(100).nullable().optional(),
  quantity: z.number().min(0).optional(),
  min_quantity: z.number().min(0).optional(),
  minQuantity: z.number().min(0).optional(),
  location: z.string().max(200).optional(),
});
const patchProductSchema = z.object({
  name: z.string().min(1).max(300).optional(),
  category: z.string().max(100).nullable().optional(),
  unit: z.string().max(50).nullable().optional(),
  supplier: z.string().max(200).nullable().optional(),
  supplier_url: z.string().max(1000).nullable().optional(),
  supplierUrl: z.string().max(1000).nullable().optional(),
  price: z.number().min(0).optional(),
  sku: z.string().max(100).nullable().optional(),
});
const inventorySchema = z.object({
  quantity: z.number().min(0).optional(),
  min_quantity: z.number().min(0).optional(),
  minQuantity: z.number().min(0).optional(),
  location: z.string().max(200).nullable().optional(),
});
const cartCreateSchema = z.object({
  name: z.string().min(1).max(200),
  supplier: z.string().max(200).optional(),
});
const cartPatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  supplier: z.string().max(200).nullable().optional(),
  status: cartStatusSchema.optional(),
});
const addItemSchema = z.object({
  product_id: z.string().optional(),
  productId: z.string().optional(),
  name: z.string().min(1).max(300).optional(),
  price: z.number().min(0).optional(),
  quantity: z.number().min(0.001).optional(),
  url: z.string().max(1000).optional(),
  supplier: z.string().max(200).optional(),
});
const patchItemSchema = z.object({
  quantity: z.number().min(0.001).optional(),
  price: z.number().min(0).optional(),
  name: z.string().min(1).max(300).optional(),
  url: z.string().max(1000).nullable().optional(),
  supplier: z.string().max(200).nullable().optional(),
});
const orderPatchSchema = z.object({ status: orderStatusSchema });

// ===== Pomocnicze =====
const PRODUCT_SELECT = "SELECT p.*, i.quantity, i.min_quantity, i.location, i.updated_at AS inventory_updated_at " +
  "FROM products p LEFT JOIN inventory i ON i.product_id = p.id";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

function productRow(r: any) {
  const quantity = Number(r.quantity ?? 0);
  const minQuantity = Number(r.min_quantity ?? 0);
  return {
    id: r.id,
    name: r.name,
    category: r.category ?? "",
    unit: r.unit ?? "szt.",
    supplier: r.supplier ?? "",
    supplierUrl: r.supplier_url ?? "",
    price: round2(r.price),
    sku: r.sku ?? null,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    quantity,
    minQuantity,
    location: r.location ?? "",
    inventoryUpdatedAt: r.inventory_updated_at ?? null,
    low: quantity < minQuantity,
  };
}

function getProductRaw(id: string): any {
  return db.prepare(PRODUCT_SELECT + " WHERE p.id = ?").get(id) as any;
}

function cartRow(r: any) {
  return {
    id: r.id,
    name: r.name,
    supplier: r.supplier ?? "",
    status: r.status,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    itemCount: Number(r.item_count ?? 0),
    total: round2(r.total),
  };
}

function cartItemRow(r: any) {
  return {
    id: r.id,
    cartId: r.cart_id,
    productId: r.product_id ?? null,
    name: r.name,
    price: round2(r.price),
    quantity: Number(r.quantity ?? 1),
    url: r.url ?? "",
    supplier: r.supplier ?? "",
    position: Number(r.position ?? 0),
    createdAt: r.created_at,
  };
}

function orderRow(r: any) {
  return {
    id: r.id,
    cartId: r.cart_id ?? null,
    number: r.number,
    status: r.status,
    total: round2(r.total),
    placedBy: r.placed_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    cartName: r.cart_name ?? null,
    placedByName: r.placed_by_name ?? null,
  };
}

function orderItemRow(r: any) {
  return {
    id: r.id,
    orderId: r.order_id,
    productId: r.product_id ?? null,
    name: r.name,
    price: round2(r.price),
    quantity: Number(r.quantity ?? 1),
  };
}

function notify(userId: string, title: string, body: string, link = "") {
  db.prepare(
    "INSERT INTO notifications (id, user_id, type, title, body, link, created_at) VALUES (?,?,?,?,?,?,?)"
  ).run(newId(), userId, "order", title, body, link, nowISO());
  emitToUser(userId, "notif:new", { title, body, link });
}

function nextOrderNumber(): string {
  const row = db.prepare("SELECT COUNT(*) AS c FROM orders").get() as { c: number };
  return "ZAM-" + String(row.c + 1).padStart(4, "0");
}

function getCartRaw(id: string): any {
  return db.prepare("SELECT * FROM carts WHERE id = ?").get(id) as any;
}

// ===== Produkty i inwentarz =====
shopRouter.get("/products", (req, res) => {
  const { q, category } = req.query as Record<string, string | undefined>;
  const where: string[] = [];
  const params: any[] = [];
  if (q) {
    where.push("(p.name LIKE '%' || ? || '%' COLLATE NOCASE OR p.category LIKE '%' || ? || '%' COLLATE NOCASE OR p.supplier LIKE '%' || ? || '%' COLLATE NOCASE OR p.sku LIKE '%' || ? || '%' COLLATE NOCASE)");
    params.push(q, q, q, q);
  }
  if (category) {
    where.push("p.category = ?");
    params.push(category);
  }
  const rows = db.prepare(
    PRODUCT_SELECT + (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY p.name COLLATE NOCASE ASC"
  ).all(...params) as any[];
  res.json(rows.map(productRow));
});

shopRouter.post("/products", (req, res) => {
  const parsed = createProductSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Nieprawidłowe dane produktu", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const supplierUrl = d.supplier_url ?? d.supplierUrl ?? "";
  const minQuantity = d.min_quantity ?? d.minQuantity ?? 0;
  const id = newId();
  const t = nowISO();
  db.exec("BEGIN");
  try {
    db.prepare(
      "INSERT INTO products (id, name, category, unit, supplier, supplier_url, price, sku, created_by, created_at, updated_at) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?)"
    ).run(id, d.name.trim(), d.category ?? "", d.unit ?? "szt.", d.supplier ?? "", supplierUrl,
      d.price, d.sku ?? null, req.user!.id, t, t);
    db.prepare(
      "INSERT INTO inventory (product_id, quantity, min_quantity, location, updated_by, updated_at) VALUES (?,?,?,?,?,?)"
    ).run(id, d.quantity ?? 0, minQuantity, d.location ?? "", req.user!.id, t);
    db.exec("COMMIT");
  } catch (e: any) {
    db.exec("ROLLBACK");
    if (String(e?.message ?? "").includes("UNIQUE")) {
      res.status(400).json({ error: "Produkt z tym SKU już istnieje" });
      return;
    }
    throw e;
  }
  res.status(201).json({ product: productRow(getProductRaw(id)) });
});

shopRouter.patch("/products/:id", (req, res) => {
  const existing = db.prepare("SELECT id FROM products WHERE id = ?").get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: "Nie znaleziono produktu" }); return; }
  const parsed = patchProductSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Nieprawidłowe dane produktu", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const supplierUrl = d.supplier_url !== undefined ? d.supplier_url : d.supplierUrl;
  const sets: string[] = [];
  const params: any[] = [];
  const map: [string, unknown][] = [
    ["name", d.name],
    ["category", d.category],
    ["unit", d.unit],
    ["supplier", d.supplier],
    ["supplier_url", supplierUrl],
    ["price", d.price],
    ["sku", d.sku],
  ];
  for (const [col, v] of map) {
    if (v !== undefined) { sets.push(col + " = ?"); params.push(v); }
  }
  if (sets.length > 0) {
    sets.push("updated_at = ?");
    params.push(nowISO(), req.params.id);
    try {
      db.prepare("UPDATE products SET " + sets.join(", ") + " WHERE id = ?").run(...params);
    } catch (e: any) {
      if (String(e?.message ?? "").includes("UNIQUE")) {
        res.status(400).json({ error: "Produkt z tym SKU już istnieje" });
        return;
      }
      throw e;
    }
  }
  res.json({ product: productRow(getProductRaw(req.params.id)) });
});

shopRouter.delete("/products/:id", (req, res) => {
  const existing = db.prepare("SELECT id FROM products WHERE id = ?").get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: "Nie znaleziono produktu" }); return; }
  db.prepare("DELETE FROM products WHERE id = ?").run(req.params.id); // kaskada na inventory (schema)
  res.json({ ok: true });
});

shopRouter.get("/inventory/low", (_req, res) => {
  const rows = db.prepare(
    PRODUCT_SELECT + " WHERE i.quantity IS NOT NULL AND i.quantity < i.min_quantity" +
    " ORDER BY (i.min_quantity - i.quantity) DESC"
  ).all() as any[];
  res.json(rows.map(productRow));
});

shopRouter.patch("/inventory/:productId", (req, res) => {
  const product = db.prepare("SELECT id FROM products WHERE id = ?").get(req.params.productId) as any;
  if (!product) { res.status(404).json({ error: "Nie znaleziono produktu" }); return; }
  const parsed = inventorySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Nieprawidłowe dane inwentarza", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const minQuantity = d.min_quantity !== undefined ? d.min_quantity : d.minQuantity;
  const sets: string[] = [];
  const params: any[] = [];
  const map: [string, unknown][] = [
    ["quantity", d.quantity],
    ["min_quantity", minQuantity],
    ["location", d.location],
  ];
  for (const [col, v] of map) {
    if (v !== undefined) { sets.push(col + " = ?"); params.push(v); }
  }
  sets.push("updated_by = ?", "updated_at = ?");
  params.push(req.user!.id, nowISO(), req.params.productId);
  const existingInv = db.prepare("SELECT product_id FROM inventory WHERE product_id = ?").get(req.params.productId) as any;
  if (existingInv) {
    db.prepare("UPDATE inventory SET " + sets.join(", ") + " WHERE product_id = ?").run(...params);
  } else {
    db.prepare(
      "INSERT INTO inventory (product_id, quantity, min_quantity, location, updated_by, updated_at) VALUES (?,?,?,?,?,?)"
    ).run(req.params.productId, d.quantity ?? 0, minQuantity ?? 0, d.location ?? "", req.user!.id, nowISO());
  }
  res.json({ product: productRow(getProductRaw(req.params.productId)) });
});

// ===== Koszyki =====
const CART_LIST_SELECT =
  "SELECT c.*, COUNT(ci.id) AS item_count, COALESCE(SUM(ci.price * ci.quantity), 0) AS total " +
  "FROM carts c LEFT JOIN cart_items ci ON ci.cart_id = c.id";

shopRouter.get("/carts", (_req, res) => {
  const rows = db.prepare(CART_LIST_SELECT + " GROUP BY c.id ORDER BY c.updated_at DESC").all() as any[];
  res.json(rows.map(cartRow));
});

shopRouter.post("/carts", (req, res) => {
  const parsed = cartCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Podaj nazwę koszyka", details: parsed.error.flatten() });
    return;
  }
  const id = newId();
  const t = nowISO();
  db.prepare(
    "INSERT INTO carts (id, name, supplier, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?)"
  ).run(id, parsed.data.name.trim(), parsed.data.supplier ?? "", "new", req.user!.id, t, t);
  const row = db.prepare(CART_LIST_SELECT + " WHERE c.id = ? GROUP BY c.id").get(id) as any;
  res.status(201).json({ cart: cartRow(row) });
});

shopRouter.get("/carts/:id", (req, res) => {
  const cart = getCartRaw(req.params.id);
  if (!cart) { res.status(404).json({ error: "Nie znaleziono koszyka" }); return; }
  const items = db.prepare(
    "SELECT * FROM cart_items WHERE cart_id = ? ORDER BY position ASC, created_at ASC"
  ).all(req.params.id) as any[];
  const total = db.prepare(
    "SELECT COALESCE(SUM(price * quantity), 0) AS t FROM cart_items WHERE cart_id = ?"
  ).get(req.params.id) as { t: number };
  res.json({
    cart: { ...cartRow({ ...cart, item_count: items.length, total: total.t }), items: items.map(cartItemRow) },
  });
});

shopRouter.patch("/carts/:id", (req, res) => {
  const cart = getCartRaw(req.params.id);
  if (!cart) { res.status(404).json({ error: "Nie znaleziono koszyka" }); return; }
  const parsed = cartPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Nieprawidłowe dane koszyka", details: parsed.error.flatten() });
    return;
  }
  const sets: string[] = [];
  const params: any[] = [];
  const map: [string, unknown][] = [
    ["name", parsed.data.name],
    ["supplier", parsed.data.supplier],
    ["status", parsed.data.status],
  ];
  for (const [col, v] of map) {
    if (v !== undefined) { sets.push(col + " = ?"); params.push(v); }
  }
  if (sets.length > 0) {
    sets.push("updated_at = ?");
    params.push(nowISO(), req.params.id);
    db.prepare("UPDATE carts SET " + sets.join(", ") + " WHERE id = ?").run(...params);
  }
  const updated = getCartRaw(req.params.id);
  const items = db.prepare("SELECT COUNT(*) AS c FROM cart_items WHERE cart_id = ?").get(req.params.id) as { c: number };
  const total = db.prepare("SELECT COALESCE(SUM(price * quantity), 0) AS t FROM cart_items WHERE cart_id = ?").get(req.params.id) as { t: number };
  res.json({ cart: cartRow({ ...updated, item_count: items.c, total: total.t }) });
});

shopRouter.delete("/carts/:id", (req, res) => {
  const cart = getCartRaw(req.params.id);
  if (!cart) { res.status(404).json({ error: "Nie znaleziono koszyka" }); return; }
  db.prepare("DELETE FROM carts WHERE id = ?").run(req.params.id); // kaskada na cart_items
  res.json({ ok: true });
});

// ===== Pozycje koszyka =====
shopRouter.post("/carts/:id/items", (req, res) => {
  const cart = getCartRaw(req.params.id);
  if (!cart) { res.status(404).json({ error: "Nie znaleziono koszyka" }); return; }
  const parsed = addItemSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Nieprawidłowe dane pozycji", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const productId = d.product_id ?? d.productId;
  let name: string;
  let price: number;
  let url = "";
  let supplier = "";
  if (productId) {
    const p = db.prepare("SELECT * FROM products WHERE id = ?").get(productId) as any;
    if (!p) { res.status(404).json({ error: "Nie znaleziono produktu" }); return; }
    name = p.name;
    price = Number(p.price);
    url = p.supplier_url ?? "";
    supplier = p.supplier ?? "";
  } else {
    if (!d.name || d.price === undefined) {
      res.status(400).json({ error: "Podaj nazwę i cenę pozycji" });
      return;
    }
    name = d.name.trim();
    price = d.price;
    url = d.url ?? "";
    supplier = d.supplier ?? "";
  }
  const max = db.prepare("SELECT COALESCE(MAX(position), -1) AS m FROM cart_items WHERE cart_id = ?")
    .get(req.params.id) as { m: number };
  const id = newId();
  const t = nowISO();
  db.prepare(
    "INSERT INTO cart_items (id, cart_id, product_id, name, price, quantity, url, supplier, position, created_by, created_at) " +
    "VALUES (?,?,?,?,?,?,?,?,?,?,?)"
  ).run(id, req.params.id, productId ?? null, name, price, d.quantity ?? 1, url, supplier,
    max.m + 1, req.user!.id, t);
  db.prepare("UPDATE carts SET updated_at = ? WHERE id = ?").run(t, req.params.id);
  const created = db.prepare("SELECT * FROM cart_items WHERE id = ?").get(id) as any;
  res.status(201).json({ item: cartItemRow(created) });
});

shopRouter.patch("/carts/:id/items/:iid", (req, res) => {
  const cart = getCartRaw(req.params.id);
  if (!cart) { res.status(404).json({ error: "Nie znaleziono koszyka" }); return; }
  const item = db.prepare("SELECT * FROM cart_items WHERE id = ? AND cart_id = ?").get(req.params.iid, req.params.id) as any;
  if (!item) { res.status(404).json({ error: "Nie znaleziono pozycji" }); return; }
  const parsed = patchItemSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Nieprawidłowe dane pozycji", details: parsed.error.flatten() });
    return;
  }
  const sets: string[] = [];
  const params: any[] = [];
  const map: [string, unknown][] = [
    ["quantity", parsed.data.quantity],
    ["price", parsed.data.price],
    ["name", parsed.data.name],
    ["url", parsed.data.url],
    ["supplier", parsed.data.supplier],
  ];
  for (const [col, v] of map) {
    if (v !== undefined) { sets.push(col + " = ?"); params.push(v); }
  }
  if (sets.length > 0) {
    params.push(req.params.iid, req.params.id);
    db.prepare("UPDATE cart_items SET " + sets.join(", ") + " WHERE id = ? AND cart_id = ?").run(...params);
  }
  const t = nowISO();
  db.prepare("UPDATE carts SET updated_at = ? WHERE id = ?").run(t, req.params.id);
  const updated = db.prepare("SELECT * FROM cart_items WHERE id = ?").get(req.params.iid) as any;
  res.json({ item: cartItemRow(updated) });
});

shopRouter.delete("/carts/:id/items/:iid", (req, res) => {
  const item = db.prepare("SELECT id FROM cart_items WHERE id = ? AND cart_id = ?").get(req.params.iid, req.params.id) as any;
  if (!item) { res.status(404).json({ error: "Nie znaleziono pozycji" }); return; }
  db.prepare("DELETE FROM cart_items WHERE id = ? AND cart_id = ?").run(req.params.iid, req.params.id);
  const t = nowISO();
  db.prepare("UPDATE carts SET updated_at = ? WHERE id = ?").run(t, req.params.id);
  res.json({ ok: true });
});

// ===== Zamówienia =====
shopRouter.post("/carts/:id/order", (req, res) => {
  const cart = getCartRaw(req.params.id);
  if (!cart) { res.status(404).json({ error: "Nie znaleziono koszyka" }); return; }
  const items = db.prepare("SELECT * FROM cart_items WHERE cart_id = ? ORDER BY position ASC").all(req.params.id) as any[];
  if (items.length === 0) { res.status(400).json({ error: "Koszyk jest pusty — dodaj pozycje przed złożeniem zamówienia" }); return; }
  const number = nextOrderNumber();
  const total = items.reduce((sum, it) => sum + Number(it.price) * Number(it.quantity), 0);
  const id = newId();
  const t = nowISO();
  db.exec("BEGIN");
  try {
    db.prepare(
      "INSERT INTO orders (id, cart_id, number, status, total, placed_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)"
    ).run(id, req.params.id, number, "placed", round2(total), req.user!.id, t, t);
    for (const it of items) {
      db.prepare(
        "INSERT INTO order_items (id, order_id, product_id, name, price, quantity) VALUES (?,?,?,?,?,?)"
      ).run(newId(), id, it.product_id ?? null, it.name, it.price, it.quantity);
    }
    db.prepare("UPDATE carts SET status = 'ordered', updated_at = ? WHERE id = ?").run(t, req.params.id);
    notify(cart.created_by, "Zamówienie złożone", "Zamówienie " + number + " złożone", "/zamowienia");
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  // E-mail: osoba składająca zamówienie + twórca koszyka (deduplikacja)
  {
    const mailOrder = { id, number, status: "placed" as const };
    const mailRecipients = new Set<string>([req.user!.id, cart.created_by]);
    for (const uid of mailRecipients) {
      const u = db.prepare("SELECT * FROM users WHERE id = ?").get(uid) as any;
      if (u) notifyOrderStatus(u, mailOrder, "placed", round2(total));
    }
  }
  const order = db.prepare(
    "SELECT o.*, c.name AS cart_name, u.name AS placed_by_name " +
    "FROM orders o LEFT JOIN carts c ON c.id = o.cart_id LEFT JOIN users u ON u.id = o.placed_by " +
    "WHERE o.id = ?"
  ).get(id) as any;
  const oItems = db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(id) as any[];
  res.status(201).json({ order: { ...orderRow(order), items: oItems.map(orderItemRow) } });
});

shopRouter.get("/orders", (_req, res) => {
  const rows = db.prepare(
    "SELECT o.*, c.name AS cart_name, u.name AS placed_by_name " +
    "FROM orders o LEFT JOIN carts c ON c.id = o.cart_id LEFT JOIN users u ON u.id = o.placed_by " +
    "ORDER BY o.created_at DESC"
  ).all() as any[];
  res.json(rows.map(orderRow));
});

// Liczba zamówień (badge w nawigacji) — przed /orders/:id
shopRouter.get("/orders/count", (_req, res) => {
  const row = db.prepare("SELECT COUNT(*) AS c FROM orders").get() as { c: number };
  res.json({ count: row.c });
});

shopRouter.get("/orders/:id", (req, res) => {
  const order = db.prepare(
    "SELECT o.*, c.name AS cart_name, u.name AS placed_by_name " +
    "FROM orders o LEFT JOIN carts c ON c.id = o.cart_id LEFT JOIN users u ON u.id = o.placed_by " +
    "WHERE o.id = ?"
  ).get(req.params.id) as any;
  if (!order) { res.status(404).json({ error: "Nie znaleziono zamówienia" }); return; }
  const items = db.prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY created_at ASC, id ASC").all(req.params.id) as any[];
  res.json({ order: { ...orderRow(order), items: items.map(orderItemRow) } });
});

shopRouter.patch("/orders/:id", (req, res) => {
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id) as any;
  if (!order) { res.status(404).json({ error: "Nie znaleziono zamówienia" }); return; }
  const parsed = orderPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Nieprawidłowy status zamówienia", details: parsed.error.flatten() });
    return;
  }
  const status = parsed.data.status;
  if (status !== order.status) {
    db.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?").run(status, nowISO(), req.params.id);
    const cart = order.cart_id ? getCartRaw(order.cart_id) : null;
    if (cart) {
      const verb = status === "shipped" ? "wysłane" : status === "delivered" ? "dostarczone" : status === "cancelled" ? "anulowane" : "";
      if (verb) {
        notify(cart.created_by, "Zamówienie " + order.number, "Zamówienie " + order.number + " " + verb, "/zamowienia");
      }
    }
    // E-mail: osoba składająca zamówienie + twórca koszyka (deduplikacja)
    const mailRecipients = new Set<string>([order.placed_by, cart?.created_by].filter((x): x is string => !!x));
    for (const uid of mailRecipients) {
      const u = db.prepare("SELECT * FROM users WHERE id = ?").get(uid) as any;
      if (u) notifyOrderStatus(u, order, status, order.total);
    }
  }
  const updated = db.prepare(
    "SELECT o.*, c.name AS cart_name, u.name AS placed_by_name " +
    "FROM orders o LEFT JOIN carts c ON c.id = o.cart_id LEFT JOIN users u ON u.id = o.placed_by " +
    "WHERE o.id = ?"
  ).get(req.params.id) as any;
  res.json({ order: orderRow(updated) });
});
