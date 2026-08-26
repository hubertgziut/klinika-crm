# PLAN — Aplikacja CRM dla Kliniki („Klinika CRM”)

> Wersja: 1.0 · Data: sierpień 2025 · Status: **MVP zbudowane i zweryfikowane (Fazy 0–10)**
> Język interfejsu: **polski** · Dostęp: **sieć lokalna (LAN)** · Skala: **5–20 osób**
> Zakres: **wewnętrzny workspace zespołu** (bez modułu pacjentów) · AI: **OpenAI API**
> Wybrany interfejs: **Wariant 4 — Kolorowy (styl Notion/Asana)** → design/wariant-4-kolorowy.png
> Dokumentacja: README.md (uruchomienie) i docs/ZESPOL.md (przewodnik zespołu)

---

## 1. Cel i wizja

Aplikacja ma być **jednym, holistycznym miejscem pracy zespołu kliniki**: CRM do komunikacji,
projektów, dokumentów, inwentarza i zakupów — wzorowany na Attio, Pipedrive, Notion, Asanie i Slacku,
działający **szybko i responsywnie w przeglądarce**, uruchomiony **lokalnie na komputerze** jako serwer,
dostępny dla zespołu w sieci LAN.

### Cele biznesowe (C)
- **C1** — Szybka, responsywna aplikacja webowa działająca na lokalnym komputerze (serwer LAN).
- **C2** — Logowanie **e-mail + hasło**; kilka kont zespołu z rolami; zarządzanie kontami przez admina.
- **C3** — **Projekty z gałęziami**, zadania, tablice kanban, osie czasu (timeline).
- **C4** — **Komunikator zespołu** (kanały + czaty prywatne) w czasie rzeczywistym (WebSocket).
- **C5** — **Tabele (jak Excel)** i **dokumenty (jak Word)** w przeglądarce.
- **C6** — **Inwentarz kliniki** (produkty, stany magazynowe, alerty niskiego stanu) + **koszyki zakupowe**
  z linkami do hurtowni/sklepów + **zamówienia**.
- **C7** — **Asystent AI (OpenAI)**: zadawanie pytań, wyszukiwanie produktów, automatyczne
  porządkowanie/ segregacja danych, przeciąganie wyników AI do zadań (drag & drop).
- **C8** — **Powiadomienia e-mail** (SMTP) i powiadomienia w aplikacji.
- **C9** — Bezpieczeństwo (uwierzytelnianie, sesje, hasła hashowane), backup bazy, dokumentacja zespołu.

### Decyzje użytkownika (zebrane 25.08.2025)
| Pytanie | Decyzja |
|---|---|
| Integracja AI („Kodex”) | **OpenAI (ChatGPT / API)** — klucz podany później |
| Dostęp | **Sieć lokalna (LAN)** na start |
| Skala | **5–20 osób** |
| Zakres | **Wewnętrzny workspace** — bez modułu pacjentów |
| Język | **Polski** |
| E-mail powiadomienia | **Własny SMTP** (dane podane później) |
| Priorytety MVP | Wszystkie moduły (logowanie, projekty/zadania, komunikator, tabele/dokumenty, inwentarz/koszyki, AI, e-mail) |
| Interfejs | **Wariant 4 · Kolorowy (Notion/Asana)** |
| OpenAI | Klucz API jest — zostanie podany później |

---

## 2. Inspiracje (analiza wzorcowa)

| Produkt | Co zapożyczamy |
|---|---|
| **Attio** (attio.com) | Czystość danych, relacje, workspace, zarządzanie obiektami |
| **Pipedrive** (pipedrive.com) | Pipeline/kanban zakupów, gęstość informacji, etapy procesu |
| **Notion / Asana** | Przyjazny, kolorowy interfejs (Wariant 4), strony/workspace, tabele i dokumenty w jednym miejscu |
| **Slack** | Komunikacja kanałowa, wzmianki, reakcje, statusy online |
| **Linear** | Szybkość, skróty klawiszowe, płynność kanban |

---

## 3. Użytkownicy i role

- **Administrator** — zarządza kontami zespołu, ustawieniami (SMTP, OpenAI, dane kliniki),
  ma pełny dostęp do wszystkich modułów.
- **Manager** — tworzy projekty, przypisuje zadania, zatwierdza koszyki i zamówienia,
  zarządza inwentarzem.
- **Członek zespołu** — pracuje na zadaniach, komunikuje się, edytuje dokumenty/tabele,
  dodaje produkty do koszyków.
- (później) **Gość/Widz** — podgląd bez edycji.

Role sprawdzane po stronie serwera (autoryzacja w API), nie tylko w UI.

---

## 4. Architektura techniczna

### Wybór stosu (uzasadnienie)
| Warstwa | Technologia | Uzasadnienie |
|---|---|---|
| Runtime | **Node.js 24 + TypeScript** | Zainstalowany (v24.15), szybki, jeden język dla całości |
| Serwer HTTP | **Express 4** | Dojrzały, prosty, wystarczający dla LAN |
| Baza danych | **SQLite (node:sqlite)** | Zero konfiguracji, plik lokalny, WAL — idealne dla 5–20 użytkowników i backupu |
| Realtime | **Socket.IO** | Kanały/rogi, automatyczne ponawianie połączeń, kompatybilne z LAN |
| Frontend | **React 18 + Vite + TS + Zustand + React Router** | SPA serwowane statycznie przez ten sam serwer; szybkie HMR w dev |
| Drag & drop | **natywne HTML5 DnD** | Zero zależności; kanban + przeciąganie wyników AI do zadań |
| Dokumenty | **TipTap (ProseMirror)** | Dojrzały edytor WYSIWYG (MIT) |
| Tabele | **własny komponent grid** | Lekki edytowalny arkusz (komórki, kolumny, wiersze, proste formuły =, sumy) |
| E-mail | **nodemailer** | Standard SMTP + kolejka w bazie |
| Hasła | **scrypt (node:crypto)** | Wbudowane, bezpieczne hashowanie |
| AI | **OpenAI API (fetch)** | Czat + JSON tools; tryb demo (mock) bez klucza |

### Struktura repozytorium
~~~
CRM_clinic/
├── PLAN.md                  ← ten plan
├── README.md                ← uruchomienie i konfiguracja
├── docs/                    ← ZESPOL.md (przewodnik zespołu), cron.example.txt
├── design/                  ← mockupy (4 warianty) + zrzuty ekranu aplikacji
├── package.json             ← skrypty: dev, build, start, backup, seed, test:email
├── server/                  ← backend TypeScript (Express + SQLite + Socket.IO)
│   ├── index.ts             ← bootstrap serwera (HTTP + Socket.IO + statyka)
│   ├── db.ts / schema.sql   ← baza i migracje
│   ├── auth.ts / util.ts    ← sesje, role, hasła
│   ├── mailer.ts            ← nodemailer + kolejka e-mail
│   ├── ai.ts                ← OpenAI + tryb demo
│   ├── ws.ts                ← Socket.IO: czat, powiadomienia, obecność
│   └── routes/              ← auth, users, projects, tasks, chat, tables, docs,
│                              inventory/carts/orders (shop), ai, notifications, settings, search
├── web/                     ← frontend React (Vite)
│   └── src/ (pages, components, layout, store, api, socket, theme.css)
├── data/                    ← clinic.db, uploads/, backups/, logs/
└── dist/                    ← zbudowany frontend (serwowany przez serwer)
~~~

---

## 5. Modele danych (SQLite — server/schema.sql)

> Konwencje: id TEXT (UUID) lub INTEGER AUTOINCREMENT · created_at, updated_at ISO ·
> miękkie usuwanie deleted_at gdzie potrzebne · klucze obce z ON DELETE CASCADE gdzie sensowne.

### Tożsamość i dostęp
- **users** — id, email (UNIQUE), password_hash (scrypt), name, role (admin|manager|member),
  avatar_color, email_notifications (BOOL), active, created_at.
- **sessions** — id, user_id, token_hash, created_at, expires_at, last_seen_at.

### Projekty i zadania
- **projects** — id, name, description, color, emoji, status, owner_id, created_by, timestamps.
- **branches** — id, project_id, parent_id (NULL = główna), name, created_by, created_at.
  (Gałęzie = równoległe wersje pracy nad projektem, jak w git.)
- **tasks** — id, project_id, branch_id, title, description, status (todo|in_progress|review|done),
  priority, assignee_id, created_by, due_date, start_date, position, ai_source (JSON — skąd przyszło
  zadanie, np. wynik AI z linkiem produktu), timestamps.
- **task_comments** — id, task_id, user_id, body, created_at.
- **task_activity** — id, task_id, user_id, action, meta (JSON), created_at (historia/audyt).

### Komunikator
- **channels** — id, name, topic, kind (channel|dm), created_by, created_at.
- **channel_members** — channel_id, user_id, joined_at.
- **messages** — id, channel_id, user_id, body, reply_to_id, edited_at, created_at.
- **message_reads** — message_id, user_id, read_at (do licznika nieprzeczytanych).

### Tabele i dokumenty
- **tables** — id, project_id (nullable), name, columns_json, created_by, timestamps.
- **table_rows** — id, table_id, position, created_by, timestamps.
- **table_cells** — id, row_id, column_id, value (TEXT/JSON), created_at, updated_at.
- **documents** — id, project_id (nullable), title, content (HTML), created_by, updated_by, timestamps.
- **uploads** — id, user_id, document_id (nullable), filename, stored_name, mime, size, created_at.

### Inwentarz, koszyki, zamówienia
- **products** — id, name, category, unit, supplier, supplier_url, price, sku (UNIQUE), created_by.
- **inventory** — id, product_id (UNIQUE), quantity, min_quantity, location, updated_by, updated_at
  (alert „niski stan”, gdy quantity < min_quantity).
- **carts** — id, name, supplier, status (new|in_progress|ordered|delivered), created_by, timestamps.
- **cart_items** — id, cart_id, product_id (nullable), name, price, quantity, url, supplier,
  created_by, position.
- **orders** — id, cart_id, number (np. ZAM-0001), status (placed|shipped|delivered|cancelled),
  total, placed_by, timestamps.
- **order_items** — id, order_id, product_id (nullable), name, price, quantity.

### Powiadomienia, AI, ustawienia
- **notifications** — id, user_id, type, title, body, link, read_at, created_at.
- **email_queue** — id, to, subject, body, status (pending|sent|failed), attempts, last_error,
  created_at, sent_at.
- **ai_threads** — id, user_id, title, created_at.
- **ai_messages** — id, thread_id, role (user|assistant|tool), content (JSON), created_at.
- **settings** — key (UNIQUE), value (TEXT/JSON) — np. clinic_name, smtp_*, openai_key (szyfrowane).

---

## 6. API (REST) i zdarzenia Socket.IO

### REST (wszystko po /api, auth przez cookie sesji)
| Grupa | Endpointy |
|---|---|
| Auth | POST /api/auth/login · POST /api/auth/logout · GET /api/auth/me · POST /api/auth/change-password |
| Users (admin) | GET/POST /api/users · PATCH/DELETE /api/users/:id · POST /api/users/:id/reset-password |
| Projects | GET/POST /api/projects · GET/PATCH/DELETE /api/projects/:id |
| Branches | GET/POST /api/projects/:id/branches · PATCH/DELETE /api/branches/:id |
| Tasks | GET/POST /api/projects/:id/tasks · PATCH/DELETE /api/tasks/:id · POST /api/tasks/:id/move · GET/POST /api/tasks/:id/comments · GET /api/projects/:id/timeline |
| Chat | GET/POST /api/channels · POST /api/channels/dm · POST /api/channels/:id/join · GET/POST /api/channels/:id/messages · POST /api/channels/:id/read · GET /api/channels/:id/members · PATCH /api/channels/:id |
| Tables | GET/POST /api/tables · GET/PATCH/DELETE /api/tables/:id · POST /api/tables/:id/rows · PATCH/DELETE /api/tables/:id/rows/:rid · POST /api/tables/:id/columns |
| Documents | GET/POST /api/documents · GET/PATCH/DELETE /api/documents/:id · POST /api/documents/:id/upload · DELETE /api/uploads/:id |
| Inventory | GET/POST /api/products · PATCH/DELETE /api/products/:id · PATCH /api/inventory/:productId · GET /api/inventory/low |
| Carts | GET/POST /api/carts · GET/PATCH/DELETE /api/carts/:id · POST /api/carts/:id/items · PATCH/DELETE /api/carts/:id/items/:iid |
| Orders | POST /api/carts/:id/order · GET /api/orders · GET/PATCH /api/orders/:id |
| AI | POST /api/ai/chat · POST /api/ai/organize · GET /api/ai/threads · GET /api/ai/threads/:id |
| Notifications | GET /api/notifications · POST /api/notifications/read-all |
| Settings | GET /api/settings · GET/PATCH /api/settings/admin · POST /api/settings/test-email · GET /api/settings/email-queue · POST /api/settings/email-queue/retry |
| Search | GET /api/search?q= |

### Socket.IO (po autoryzacji)
- chat:message (nowa wiadomość), chat:typing (pisanie), chat:read
- notif:new (powiadomienie w aplikacji), presence:update (statusy online)

---

## 7. Interfejs — Wariant 4 (Notion/Asana, kolorowy)

- **Motyw**: ciepły kremowy (bg #fbfaf6), sidebar #f3f0e7, akcent koral #ff6b5e + żółty #ffb03a,
  duże zaokrąglenia (14px), emoji w nawigacji, miękkie cienie. Plik: web/src/theme.css.
- **Layout**: Sidebar (logo, nawigacja z emoji, „Przestrzeń”, karta użytkownika) + Topbar
  (tytuł, wyszukiwarka, dzwonek powiadomień, avatar stack, przycisk „Nowy projekt”).
- **Widoki**: Pulpit, Projekty (+ szczegóły: Tablica/Oś czasu/Gałęzie), Zadania (globalny kanban z filtrami),
  Komunikator (kanały + DM, realtime), Tabele (arkusz z formułami i CSV), Dokumenty (TipTap + załączniki),
  Inwentarz (stany i alerty), Koszyki (pipeline zakupów z linkami do hurtowni), Zamówienia,
  Asystent AI (karty produktów z drag&drop do zadań/koszyka), Ustawienia (konto, SMTP, OpenAI, konta zespołu).
- **Responsywność**: desktop-first (LAN), sidebar zwijany < 1080 px, kanban 2 kolumny < 860 px.

---

## 8. Bezpieczeństwo

- Hasła: **scrypt** (node:crypto) z losową solą, parametrami OWASP.
- Sesje: token losowy, hashowany w DB, cookie **httpOnly + SameSite=Lax**, wygasanie 30 dni.
- **Rate limiting** logowania (10 prób / 15 min na IP+e-mail).
- Autoryzacja na każdym endpointcie (rola + właściciel zasobu).
- Walidacja wejścia (zod), parametryzowane SQL.
- Upload: dozwolone rozszerzenia, limit 20 MB, nazwy losowe.
- Sekret sesji z .env; klucz OpenAI w ustawieniach (maskowany w API).
- **Backup**: npm run backup (VACUUM INTO) + przykład cron/launchd w docs/.
- Logi: data/logs.

---

## 9. Integracja AI (OpenAI)

- **Tryb demo**: bez klucza OPENAI_API_KEY AI odpowiada w trybie mock + wyszukuje w bazie kliniki.
- **Tryb pełny**: POST /api/ai/chat → OpenAI chat.completions (gpt-4o-mini) z narzędziami:
  search_products (inwentarz + koszyki), search_tasks, get_summary; odpowiedzi JSON:
  {type: products|text, answer, products?: [{name, price, url, supplier, reason}]}.
- **Flow „znajdź pralkę”**: pytanie → karty produktów → przeciągnięcie na kanban (zadanie z linkiem)
  lub do koszyka (pozycja), albo przyciski w karcie.
- **Porządkowanie danych**: POST /api/ai/organize — tabela → AI/algorytm sortuje; „✨ Segreguj dane” w arkuszu.
- Wyszukiwanie w sieci: opcjonalny provider przez SEARCH_API_KEY (nieobowiązkowe).

---

## 10. Powiadomienia e-mail (SMTP) — zrealizowane

- Konfiguracja w Ustawieniach (host, port, user, pass, from, TLS) lub .env (SMTP_*).
- Kolejka email_queue; worker co 30 s; retry ×3; statusy w panelu admina; test wysyłki.
- Wyzwalacze: przydzielone zadanie · komentarz w zadaniu · status zamówienia (złożone/wysłane/
  dostarczone/anulowane) · niskie stany (raport + skrypt report:low-stock) · powitanie z hasłem.
- Szablony HTML z brandem kliniki (clinic_name/emoji) + wersja tekstowa.

---

## 11. Fazy wdrożenia (agenty kodu — po kolei)

| Faza | Zadanie | Status |
|---|---|---|
| 0 | Szkielet: serwer + baza + auth + shell React (motyw Wariant 4) | ✅ |
| 1 | Konta i logowanie, role, zarządzanie kontami (Agent 1) | ✅ |
| 2 | Projekty, gałęzie, zadania, kanban, timeline, komentarze (Agent 2) | ✅ |
| 3 | Komunikator (kanały/DM, Socket.IO) (Agent 3) | ✅ |
| 4 | Tabele (arkusz) i dokumenty (TipTap) + uploady (Agent 4) | ✅ |
| 5 | Inwentarz, koszyki, pipeline zakupów, zamówienia (Agent 5) | ✅ |
| 6 | Asystent AI (OpenAI + drag&drop) (Agent 6) | ✅ |
| 7 | Powiadomienia e-mail SMTP (Agent 7) | ✅ |
| 8 | QA — kompletność funkcji (Agent QA: 87/87 testów) | ✅ |
| 9 | UX / wydajność / responsywność (lazy loading, 103 kB main, zrzuty) | ✅ |
| 10 | Uruchomienie LAN + dokumentacja + backup (README, ZESPOL, cron) | ✅ |

---

## 12. Checklista akceptacji (wynik agenta QA)

- [x] Logowanie e-mail+hasło; złe hasło odrzucane; sesja; wylogowanie.
- [x] Admin: tworzenie/edycja/dezaktywacja kont, reset haseł; role w API.
- [x] Projekt: tworzenie, edycja, gałęzie (drzewo), usuwanie.
- [x] Zadanie: edycja, przypisanie, priorytet, terminy, kanban move, komentarze.
- [x] Timeline: zadania z datami na osi czasu projektu.
- [x] Komunikator: kanały + DM realtime, unread, obecność, dołączanie do kanałów.
- [x] Tabele: edycja komórek, kolumny/wiersze, formuły (=SUM), eksport CSV.
- [x] Dokumenty: edycja WYSIWYG, zapis, załączniki.
- [x] Inwentarz: produkty, stany, progi, alerty niskiego stanu.
- [x] Koszyki: pozycje (także z AI), pipeline statusów, suma, linki do sklepów.
- [x] Zamówienia: złożenie z koszyka, zmiana statusu, suma, powiadomienia.
- [x] AI: czat (demo i pełny), karty produktów, drag&drop do zadań/koszyka, organizacja danych.
- [x] Powiadomienia: w aplikacji + e-mail (kolejka, szablony, test wysyłki).
- [x] Wyszukiwarka globalna.
- [x] Backup (npm run backup) — działa.
- [x] Responsywność: 1920/1366/1024/860 (overflows naprawione przez Agenta UX).
- [x] Wydajność: main chunk 103 kB (lazy loading), budowa ~1 s, API < 300 ms.

---

## 13. Wdrożenie na LAN

1. npm install + npm run build + npm run start (port z .env, domyślnie 3030).
2. .env: PORT, ADMIN_EMAIL, ADMIN_PASSWORD, SESSION_SECRET (pierwsze logowanie jako admin).
3. Zespół: http://<IP-komputera>:3030 (serwer wypisuje adres przy starcie).
4. Konta zespołu: Ustawienia → Zarządzanie kontami. Dokumentacja: docs/ZESPOL.md.
5. Backup: npm run backup + przykład launchd w docs/cron.example.txt.
6. (Później) Tunel Cloudflare + HTTPS; Google OAuth jako opcja.

---

## 14. Roadmapa (po MVP)

- Google OAuth (opcjonalne logowanie) — odłożone przez użytkownika na później.
- Dostęp z internetu: Cloudflare Tunnel + domena + HTTPS.
- Moduł pacjentów (karty, wizyty) — świadomie pominięty w MVP.
- Aplikacja mobilna (PWA) / dedykowana.
- Zaawansowane formuły w tabelach, wykresy, raporty zakupów.
- Współpraca w czasie rzeczywistym w dokumentach (Yjs).

---

*MVP zbudowane i zweryfikowane. Kolejny krok: uruchomienie (README.md) i konfiguracja SMTP/OpenAI przez admina.*


---

# PLAN — Moduły v2 (kalendarz, powiadomienia, poczta, WhatsApp, AI-centrum, panel AI + Whisper)

> Status: **zaplanowane — w realizacji** · Zakres: rozszerzenie MVP (Fazy 0–10 ukończone)

## V2.1 — Kalendarz + powiadomienia o wizytach/zdarzeniach
- **Tabela** `calendar_events`: id, title, type (dyżur|spotkanie|wizyta|zadanie|zamówienie|inne),
  start_at, end_at, all_day, location, notes, project_id (nullable), created_by, created_at, updated_at.
- **Tabela** `calendar_participants`: event_id, user_id, notify_minutes (5|15|30|60|1440), reminded_at.
- **API**: GET /api/calendar?from=&to= · GET /api/calendar/upcoming (najbliższe 14 dni) ·
  POST/PATCH/DELETE /api/calendar/:id · POST /api/calendar/:id/participants.
- **Powiadomienia**: worker co 60 s — wydarzenia zaczynające się za notify_minutes minut
  → powiadomienie in-app (dzwonek) + e-mail (kolejka SMTP) do uczestników; oznaczanie reminded_at.
- **UI**: /kalendarz — widok miesiąca (siatka, kolory wg typu), lista nadchodzących,
  modal tworzenia/edycji (tytuł, typ, daty, uczestnicy, przypomnienie, lokalizacja, notatki).

## V2.2 — Integracja ze skrzynkami e-mail (IMAP)
- **Ustawienia IMAP** (admin): host, port, user, pass, TLS + istniejący SMTP (wysyłka).
- **Backend** (`imapflow`): worker co 60 s pobiera INBOX → tabela `emails`
  (uid, folder, from, to, subject, body_text, body_html, date, seen, message_id);
  załączniki → uploads. Endpointy: GET /api/mail (folder, stronicowanie) · GET /api/mail/:id ·
  POST /api/mail/:id/seen · GET /api/mail/unread · POST /api/mail/send (kompozytor przez SMTP) ·
  POST /api/mail/:id/task (utwórz zadanie z maila).
- **UI**: /poczta — lista, podgląd, odpowiedź/nowa, badge nieprzeczytanych, „utwórz zadanie z maila”.
- Bez skonfigurowanego IMAP moduł pokazuje stan „nieskonfigurowane” (bez błędów).

## V2.3 — WhatsApp (integracja przez mostek WhatsApp Web)
- **Mostek** (istniejący, Baileys): /Users/hubert/.hermes/hermes-agent/scripts/whatsapp-bridge
  (API: POST /send {chatId, message}, GET /health, GET /messages long-poll, GET /chat/:id).
- **Ustawienia**: adres mostka (domyślnie http://127.0.0.1:3001) + status połączenia.
- **Integracja**: wysyłka z CRM (formularz numer+w treść), odbieranie → powiadomienia
  (long-poll /messages), AI tool send_whatsapp. Instrukcja uruchomienia mostka i logowania QR.
- Bez działającego mostka — moduł pokazuje status offline (bez błędów).

## V2.4 — DeepSeek jako „centrum dowodzenia” (agentic)
- Rozszerzenie narzędzi AI (function calling): create_task, create_event (kalendarz),
  list_calendar, send_email (kompozytor), get_inbox_summary, send_whatsapp,
  get_low_stock, get_orders, get_summary (istnieje). AI może zarządzać wszystkimi modułami
  przez czat (DeepSeek v4 flash / OpenAI).

## V2.5 — Panel AI po prawej (styl mobilnego ChatGPT) + mikrofon (Whisper lokalnie)
- **Layout**: lewy sidebar (menu) · środek (pole robocze) · prawy panel AI (stały, zwijany ~380 px).
- **Panel**: nagłówek „Asystent AI”, przełącznik wątków/nowy wątek, bąbelki jak w ChatGPT,
  input na dole z przyciskiem mikrofonu 🎤 i wysyłką; **pod inputem selektor LLM**
  (DeepSeek v4 flash / OpenAI / tryb demo — z /api/ai/status).
- **Mikrofon**: MediaRecorder (webm) → POST /api/ai/transcribe → serwer: ffmpeg → 16 kHz wav →
  `whisper-cli -m ggml-large-v3.bin` (ścieżka z Ustawień, domyślnie
  /Users/hubert/Library/Application Support/Hermes Control/Models/Whisper/ggml-large-v3.bin, język pl)
  → tekst do pola czatu.
- **API**: POST /api/ai/transcribe (multipart audio) · GET /api/ai/status (istnieje) rozszerzony.

## V2.6 — Weryfikacja i uruchomienie
- typecheck + build + testy API (kalendarz, poczta, transcribe, narzędzia AI, WhatsApp status),
- uruchomienie serwera (port 3030) do testów użytkownika + opcjonalny tunel.
