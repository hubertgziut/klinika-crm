# 🩺 Klinika CRM

Wewnętrzny workspace CRM dla kliniki — komunikacja zespołu, projekty i zadania, tabele i dokumenty,
inwentarz, koszyki zakupowe z linkami do hurtowni, zamówienia oraz Asystent AI (OpenAI / DeepSeek).
Działa w przeglądarce, uruchamiany lokalnie na komputerze i dostępny dla zespołu w sieci lokalnej (LAN).

Interfejs: **Wariant 4 — kolorowy (styl Notion/Asana)** · Język: **polski**.

## Wymagania

- Node.js ≥ 22.5 (testowane na 24.x) + npm
- Przeglądarka (Chrome / Safari / Edge / Firefox)
- Do wysyłki e-maili: konto SMTP · Do pełnego AI: klucz API OpenAI (opcjonalnie)

## Szybki start (pierwsze uruchomienie)

```bash
cd CRM_clinic
npm install
cp .env.example .env        # ustaw ADMIN_EMAIL, ADMIN_PASSWORD, SESSION_SECRET (możesz zmienić PORT)
npm run build               # buduje frontend
npm run start               # uruchamia serwer
```

Serwer domyślnie działa na **http://localhost:3030** i jest słyszalny w całej sieci LAN:
- **http://localhost:3030** — na tym komputerze
- **http://<IP-komputera>:3030** — z innych komputerów w tej samej sieci (np. http://192.168.1.105:3030 — serwer wypisze adres przy starcie)

Pierwsze logowanie: konto **administratora** z pliku `.env` (ADMIN_EMAIL / ADMIN_PASSWORD).
Konta zespołu zakłada administrator w **Ustawienia → Zarządzanie kontami** (każde dostaje tymczasowe hasło).

## Moduły

| Moduł | Opis |
|---|---|
| 🏠 Pulpit | Statystyki i skróty |
| 📁 Projekty | Projekty z **gałęziami** (drzewo), zadania, kanban, oś czasu, komentarze |
| ✅ Zadania | Globalna tablica kanban z filtrami |
| 💬 Komunikator | Kanały + czaty prywatne, realtime (WebSocket), nieprzeczytane, obecność |
| 📊 Tabele | Arkusz jak w Excelu: edycja komórek, typy, proste formuły (=SUM), eksport CSV, „Segreguj dane” przez AI |
| 📄 Dokumenty | Edytor WYSIWYG (jak Word) + załączniki |
| 📦 Inwentarz | Produkty, stany, progi minimalne, alerty niskiego stanu |
| 🛒 Koszyki | Pipeline zakupów (Nowe → W koszyku → Zamówione → Dostarczone), linki do hurtowni/sklepów |
| 🚚 Zamówienia | Składanie zamówień z koszyka, statusy, wartości |
| ✨ Asystent AI | Czat z AI (OpenAI), karty produktów, **przeciąganie wyników do zadań i koszyka**, porządkowanie danych |
| ⚙️ Ustawienia | Konto, dane kliniki, SMTP, OpenAI, konta zespołu, kolejka e-mail |

## Konfiguracja

### Powiadomienia e-mail (SMTP)
W **Ustawienia → Powiadomienia e-mail** podaj: host, port, użytkownika, hasło, adres „od”. Możesz też użyć zmiennych .env (SMTP_*). Po zapisie: „✉️ Wyślij e-mail testowy”. Powiadomienia trafiają do kolejki i są wysyłane co 30 s.

### Asystent AI (OpenAI / DeepSeek)
W **Ustawienia → Asystent AI** wybierz dostawcę (Auto / OpenAI / DeepSeek) i wklej klucz API
(OpenAI: `sk-…`, DeepSeek: `sk-…` z platform.deepseek.com; model DeepSeek domyślnie `deepseek-v4-flash`).
**Bez klucza** AI działa w trybie demo (przykładowe odpowiedzi + wyszukiwanie w bazie kliniki).

## Skrypty

| Polecenie | Opis |
|---|---|
| `npm run dev` | Tryb deweloperski (serwer + Vite z HMR) |
| `npm run build` | Buduje frontend do dist/ |
| `npm run start` | Uruchamia serwer produkcyjnie (port z .env) |
| `npm run backup` | Kopia bazy + uploads do data/backups/ |
| `npm run seed:demo` | Wstawia przykładowe dane (tylko gdy baza pusta) |
| `npm run test:email -- adres@example.com` | Testowa wysyłka e-mail |
| `npm run report:low-stock` | Raport niskich stanów do adminów (e-mail) |
| `npm run typecheck` | Sprawdzenie typów TS |

## Backup i przywracanie

- **Backup**: `npm run backup` → `data/backups/clinic-<data>.db` (spójna kopia przez VACUUM INTO).
- **Automat**: co noc przez launchd/cron — przykład w docs/cron.example.txt.
- **Przywracanie**: zatrzymaj serwer, skopiuj `clinic-<data>.db` na `data/clinic.db` (usuń pliki clinic.db-wal/shm), uruchom serwer.

## Struktura

```
CRM_clinic/
├── PLAN.md          ← pełny plan, modele danych, checklista
├── design/          ← mockupy UI (4 warianty) + zrzuty ekranu aplikacji
├── docs/ZESPOL.md   ← przewodnik dla zespołu
├── server/          ← backend (Express + SQLite + Socket.IO)
├── web/             ← frontend (React + Vite)
├── data/            ← baza clinic.db, uploads, backups, logs (tworzone przy starcie)
└── dist/            ← zbudowany frontend (serwowany przez serwer)
```

## Rozwiązywanie problemów

- **Port zajęty**: zmień PORT w .env (np. 3031) albo znajdź proces: `lsof -iTCP:3030 -sTCP:LISTEN`.
- **Nie mogę się zalogować**: sprawdź ADMIN_EMAIL/ADMIN_PASSWORD w .env; inne konta zakłada admin.
- **E-maile nie idą**: sprawdź SMTP w Ustawieniach (host/port/user/pass), stan kolejki w panelu, logi w data/logs/.
- **Logi serwera**: na konsoli + data/logs/.
## ⚠️ Bezpieczeństwo przed publikacją

- **Zmień domyślne hasło administratora** (ADMIN_PASSWORD w `.env`) i **SESSION_SECRET** na losowe wartości.
- Pliki `.env`, baza `data/clinic.db`, uploady i kopie zapasowe **nie są** publikowane (.`gitignore`).
- Domyślne dane demo są przykładowe i fikcyjne.
## 🌐 Dostęp z internetu (Cloudflare Tunnel)

**Szybki (bez konta i domeny)** — publiczny adres, ale zmienia się przy każdym restarcie:
```bash
./scripts/tunnel-quick.sh        # lub: cloudflared tunnel --url http://localhost:3030
```
**Stały adres (polecany do codziennej pracy)** — wymaga konta Cloudflare i domeny:
```bash
cloudflared tunnel login
cloudflared tunnel create klinika
cloudflared tunnel route dns klinika crm.twojadomena.pl
cloudflared tunnel run klinika     # + config.yml wskazujący na http://localhost:3030
```
Więcej: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
