import "dotenv/config";
import { sendEmailNow, smtpConfigured } from "../mailer";

const to = process.argv[2];
if (!to) {
  console.error("Użycie: npm run test:email -- adres@email.pl");
  process.exit(1);
}
if (!smtpConfigured()) {
  console.error("SMTP nie jest skonfigurowane (brak hosta/użytkownika w ustawieniach lub .env).");
  process.exit(1);
}
const ok = await sendEmailNow(
  to,
  "Test powiadomień — Klinika CRM",
  "<p>To jest <b>testowa</b> wiadomość z Klinika CRM. Jeśli ją widzisz, e-mail działa.</p>",
  "To jest testowa wiadomość z Klinika CRM. Jeśli ją widzisz, e-mail działa."
);
console.log(ok ? "✅ E-mail wysłany" : "❌ Błąd wysyłki");
process.exit(ok ? 0 : 1);
