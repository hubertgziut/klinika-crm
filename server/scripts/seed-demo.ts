import "dotenv/config";
import { db } from "../db";
import { newId, nowISO } from "../util";

// ===== Dane demo (Faza 2): projekty, gałęzie, zadania =====
// Idempotentne: uruchamia się tylko, gdy baza nie zawiera żadnych projektów.

const iso = (d: Date) => d.toISOString().slice(0, 10);
const days = (offset: number) => iso(new Date(Date.now() + offset * 86400e3));

interface SeedBranch { name: string; parent?: string; tasks: SeedTask[] }
interface SeedTask {
  title: string; branch?: string; status: string; priority: string;
  assignee?: string; start?: string; due?: string; description?: string;
}

const PROJECTS: { name: string; emoji: string; color: string; description: string; branches: SeedBranch[] }[] = [
  {
    name: "Zakupy do pralni",
    emoji: "📦",
    color: "#0ea5e9",
    description: "Wyposażenie i zaopatrzenie pralni kliniki — sprzęt, środki i akcesoria.",
    branches: [
      {
        name: "Główna",
        tasks: [
          { title: "Wybrać pralkę przemysłową", status: "in_progress", priority: "high", due: days(7), description: "Porównać modele o wsadzie 20–30 kg oraz koszty serwisu." },
          { title: "Porównać ceny w 3 hurtowniach", status: "review", priority: "medium", due: days(3), description: "Zebrać oferty na proszek i płyn do zmiękczania." },
          { title: "Zamówić proszek i płyn do zmiękczania", status: "todo", priority: "low", due: days(10) },
          { title: "Sprawdzić stan techniczny suszarek", status: "todo", priority: "medium", due: days(5) },
          { title: "Odebrać nowe wieszaki", status: "done", priority: "low", due: days(-2) },
        ],
      },
      {
        name: "Wariant budżetowy",
        tasks: [
          { title: "Kalkulacja: pralka używana vs nowa", status: "in_progress", priority: "urgent", due: days(4), start: days(-1), description: "Zestawienie kosztów zakupu, serwisu i gwarancji." },
        ],
      },
    ],
  },
  {
    name: "Aranżacja recepcji",
    emoji: "🛋️",
    color: "#8b5cf6",
    description: "Nowy wygląd strefy wejścia i poczekalni — meble, oświetlenie, rośliny.",
    branches: [
      {
        name: "Główna",
        tasks: [
          { title: "Wybrać kanapę do poczekalni", status: "todo", priority: "medium", due: days(14), description: "Materiał łatwy do czyszczenia, wymiary do niszy przy oknie." },
          { title: "Zamówić oświetlenie LED", status: "in_progress", priority: "high", due: days(5), start: days(-2) },
          { title: "Zaprojektować układ lady recepcyjnej", status: "review", priority: "medium", due: days(2), description: "Projekt dostępny dla osób na wózkach." },
          { title: "Rośliny do strefy wejścia", status: "todo", priority: "low", start: days(3), due: days(20) },
          { title: "Wymienić wykładzinę", status: "done", priority: "low", start: days(-12), due: days(-4) },
        ],
      },
      {
        name: "Wariant budżetowy",
        tasks: [
          { title: "Wybór farby zamiast tapety", status: "todo", priority: "low", due: days(9) },
        ],
      },
    ],
  },
];

function seed() {
  const count = db.prepare("SELECT COUNT(*) AS c FROM projects").get() as { c: number };
  if (count.c > 0) {
    console.log("[seed:demo] Baza zawiera już projekty (" + count.c + ") — pomijam.");
    return;
  }
  const me = (db.prepare("SELECT id FROM users ORDER BY created_at LIMIT 1").get() as { id: string } | undefined)?.id ?? "";
  let taskCount = 0;

  for (const p of PROJECTS) {
    const projectId = newId();
    db.prepare(
      "INSERT INTO projects (id, name, description, emoji, color, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)"
    ).run(projectId, p.name, p.description, p.emoji, p.color, "active", me, nowISO(), nowISO());

    const branchIds = new Map<string, string>();
    for (const b of p.branches) {
      const id = newId();
      db.prepare(
        "INSERT INTO branches (id, project_id, parent_id, name, created_by, created_at) VALUES (?,?,?,?,?,?)"
      ).run(id, projectId, b.parent ? branchIds.get(b.parent) ?? null : null, b.name, me, nowISO());
      branchIds.set(b.name, id);
    }

    // pozycje per status
    const positions = new Map<string, number>();
    for (const b of p.branches) {
      for (const t of b.tasks) {
        const branchId = branchIds.get(b.name)!;
        const pos = positions.get(t.status) ?? 0;
        positions.set(t.status, pos + 1);
        const id = newId();
        db.prepare(
          `INSERT INTO tasks (id, project_id, branch_id, title, description, status, priority, assignee_id,
             created_by, start_date, due_date, position, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).run(id, projectId, branchId, t.title, t.description ?? "", t.status, t.priority,
          me, me, t.start ?? null, t.due ?? null, pos, nowISO(), nowISO());
        db.prepare(
          "INSERT INTO task_activity (id, task_id, user_id, action, meta, created_at) VALUES (?,?,?,?,?,?)"
        ).run(newId(), id, me, "created", JSON.stringify({ title: t.title, status: t.status, priority: t.priority }), nowISO());
        taskCount += 1;
      }
    }
    console.log(`[seed:demo] Projekt „${p.name}" ${p.emoji} — gałęzie: ${p.branches.length}, zadania: ${p.branches.reduce((n, b) => n + b.tasks.length, 0)}`);
  }
  console.log(`[seed:demo] Gotowe — utworzono ${PROJECTS.length} projekty, ${taskCount} zadań.`);
}

seed();

// ===== Dane demo (Faza 5): inwentarz, koszyk =====
// Idempotentne: uruchamia się tylko, gdy w bazie nie ma żadnych produktów.

const PRODUCTS: {
  name: string; category: string; unit: string; supplier: string;
  supplier_url: string; price: number; sku: string;
  quantity: number; min_quantity: number; location: string;
}[] = [
  {
    name: "Rękawice nitrylowe L (100 szt.)", category: "Materiały jednorazowe", unit: "opak.",
    supplier: "MedPlus", supplier_url: "https://medplus.pl/rekawice-nitrylowe-l",
    price: 28.9, sku: "RK-NIT-L", quantity: 14, min_quantity: 8, location: "Magazyn A3",
  },
  {
    name: "Płyn dezynfekcyjny 5 l", category: "Środki czystości", unit: "szt.",
    supplier: "Farmacol", supplier_url: "https://farmacol.pl/plyn-dezynfekcyjny-5l",
    price: 64.5, sku: "DEZ-5L", quantity: 3, min_quantity: 6, location: "Magazyn A1",
  },
  {
    name: "Proszek do prania przemysłowego 15 kg", category: "Środki czystości", unit: "opak.",
    supplier: "Ekomed", supplier_url: "https://ekomed.pl/proszek-przemyslowy-15kg",
    price: 89.9, sku: "PRZ-15", quantity: 4, min_quantity: 3, location: "Pralnia",
  },
  {
    name: "Płyn do zmiękczania tkanin 10 l", category: "Środki czystości", unit: "szt.",
    supplier: "Farmacol", supplier_url: "https://farmacol.pl/plyn-zmiekczajacy-10l",
    price: 42.0, sku: "ZM-10L", quantity: 2, min_quantity: 4, location: "Pralnia",
  },
  {
    name: "Worek na odpady medyczne 60 l (100 szt.)", category: "Materiały jednorazowe", unit: "opak.",
    supplier: "MedPlus", supplier_url: "https://medplus.pl/worek-odpady-60l",
    price: 33.4, sku: "WO-60", quantity: 10, min_quantity: 5, location: "Magazyn A2",
  },
  {
    name: "Papier do rejestratorów EKG 50×40", category: "Aparatura i materiały", unit: "rolka",
    supplier: "Ekomed", supplier_url: "https://ekomed.pl/papier-ekg-50x40",
    price: 18.75, sku: "EKG-PAP", quantity: 22, min_quantity: 10, location: "Gabinet 2",
  },
  {
    name: "Fartuchy jednorazowe (50 szt.)", category: "Materiały jednorazowe", unit: "opak.",
    supplier: "MedPlus", supplier_url: "https://medplus.pl/fartuchy-jednorazowe-50",
    price: 51.2, sku: "FART-50", quantity: 6, min_quantity: 4, location: "Magazyn A3",
  },
  {
    name: "Toner do drukarki HP 305A", category: "Biuro", unit: "szt.",
    supplier: "Ekomed", supplier_url: "https://ekomed.pl/toner-hp-305a",
    price: 214.0, sku: "TN-305A", quantity: 1, min_quantity: 2, location: "Recepcja",
  },
];

function seedShop() {
  const count = db.prepare("SELECT COUNT(*) AS c FROM products").get() as { c: number };
  if (count.c > 0) {
    console.log("[seed:demo] Baza zawiera już produkty (" + count.c + ") — pomijam inwentarz i koszyki.");
    return;
  }
  const me = (db.prepare("SELECT id FROM users ORDER BY created_at LIMIT 1").get() as { id: string } | undefined)?.id ?? "";
  const t = nowISO();

  for (const p of PRODUCTS) {
    const id = newId();
    db.prepare(
      "INSERT INTO products (id, name, category, unit, supplier, supplier_url, price, sku, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
    ).run(id, p.name, p.category, p.unit, p.supplier, p.supplier_url, p.price, p.sku, me, t, t);
    db.prepare(
      "INSERT INTO inventory (product_id, quantity, min_quantity, location, updated_by, updated_at) VALUES (?,?,?,?,?,?)"
    ).run(id, p.quantity, p.min_quantity, p.location, me, t);
  }
  console.log("[seed:demo] Inwentarz: " + PRODUCTS.length + " produktów (" + PRODUCTS.filter((p) => p.quantity < p.min_quantity).length + " z niskim stanem).");

  // 1 koszyk z 3 pozycjami (2 z inwentarza, 1 ręczna)
  const cartId = newId();
  db.prepare(
    "INSERT INTO carts (id, name, supplier, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?)"
  ).run(cartId, "Zakupy do pralni", "Farmacol", "in_progress", me, t, t);
  const byName = (name: string) => db.prepare("SELECT * FROM products WHERE name = ?").get(name) as any;
  const items: { name: string; price: number; quantity: number; url: string; supplier: string; product_id: string | null }[] = [
    { name: "Płyn do zmiękczania tkanin 10 l", price: 42.0, quantity: 3, url: "https://farmacol.pl/plyn-zmiekczajacy-10l", supplier: "Farmacol", product_id: byName("Płyn do zmiękczania tkanin 10 l")?.id ?? null },
    { name: "Proszek do prania przemysłowego 15 kg", price: 89.9, quantity: 2, url: "https://ekomed.pl/proszek-przemyslowy-15kg", supplier: "Ekomed", product_id: byName("Proszek do prania przemysłowego 15 kg")?.id ?? null },
    { name: "Worek na odpady medyczne 60 l (100 szt.)", price: 33.4, quantity: 2, url: "https://medplus.pl/worek-odpady-60l", supplier: "MedPlus", product_id: byName("Worek na odpady medyczne 60 l (100 szt.)")?.id ?? null },
  ];
  items.forEach((it, i) => {
    db.prepare(
      "INSERT INTO cart_items (id, cart_id, product_id, name, price, quantity, url, supplier, position, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
    ).run(newId(), cartId, it.product_id, it.name, it.price, it.quantity, it.url, it.supplier, i, me, t);
  });
  console.log("[seed:demo] Koszyk \u201EZakupy do pralni\u201D \u2014 " + items.length + " pozycje, suma " + items.reduce((s, it) => s + it.price * it.quantity, 0).toFixed(2) + " zł.");
}

seedShop();

