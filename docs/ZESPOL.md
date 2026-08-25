# 👥 Klinika CRM — przewodnik zespołu

Witaj w przestrzeni pracy kliniki! Wszystko w jednym miejscu: zadania, projekty, komunikacja, dokumenty, zakupy i magazyn.

## 1. Logowanie

- Otwórz w przeglądarce: **http://<IP-komputera>:3030** (adres poda administrator).
- Zaloguj się **e-mailem i hasłem**. Pierwsze hasło dostajesz od administratora (tymczasowe) — **zmień je w Ustawienia → Zmień hasło**.
- Nie pamiętasz hasła? Administrator może je zresetować (Ustawienia → Zarządzanie kontami).

## 2. Pierwsze kroki

1. **Pulpit** — przegląd i skróty do modułów.
2. **Projekty** → „＋ Nowy projekt” → otwórz projekt → **Tablica** (przeciągaj karty między kolumnami), **Oś czasu**, **Gałęzie** (równoległe wersje pracy).
3. **Zadania** — globalny kanban z filtrami; zadanie ma priorytet, osobę odpowiedzialną, terminy i komentarze.
4. **Komunikator** — kanały zespołu (# ogólny i inne), czaty prywatne, oznaczanie przeczytanych, statusy online.

## 3. Praca z dokumentami i tabelami

- **Tabele**: kliknij komórkę, pisz; typy: tekst / liczba / data; formuły od „=” np. `=SUM(B2:B6)`; eksport CSV; **„✨ Segreguj dane”** — AI porządkuje wiersze.
- **Dokumenty**: edytor z paskiem narzędzi (pogrubienie, nagłówki, listy, linki); załączniki do dokumentu.

## 4. Zakupy i magazyn

- **Inwentarz**: lista produktów z cenami i stanami; **żółte alerty = niski stan**.
- **Koszyki**: pipeline Nowe → W koszyku → Zamówione → Dostarczone. Dodawaj pozycje z inwentarza lub ręcznie (z linkiem do hurtowni/sklepu). Po skompletowaniu → **„Złóż zamówienie”**.
- **Zamówienia**: statusy (złożone → wysłane → dostarczone / anulowane); o zmianach przyjdą powiadomienia.

## 5. Asystent AI (✨)

- Zapytaj po polsku: „znajdź pralkę do 3 000 zł”, „co mam w koszyku?”, „podsumuj zadania”.
- Wyniki-produkty to **karty** — przeciągnij kartę **na kanban** (utworzy zadanie z linkiem) lub **do koszyka**, albo użyj przycisków.
- Bez klucza API AI działa w trybie demo; po wklejeniu klucza w Ustawieniach (admin) — pełna moc.

## 6. Powiadomienia

- W aplikacji: 🔔 (nieprzeczytane).
- E-mail: przydzielone zadanie, komentarz w Twoim zadaniu, zmiana statusu zamówienia, niskie stany (raport), zaproszenie/witaj. Włącz/wyłącz w Ustawieniach (konto).

## 7. FAQ

- **Gdzie jest baza?** data/clinic.db — backup robi administrator (`npm run backup`).
- **Mogę pracować z telefonu?** Tak, ale aplikacja jest zoptymalizowana pod komputery (LAN); na wąskich ekranach sidebar się zwija.
- **Widzę „Moduł w budowie”?** — nie powinno się zdarzyć; daj znać administratorowi.
