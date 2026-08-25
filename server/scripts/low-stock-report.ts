import "dotenv/config";
import { sendLowStockReport, smtpConfigured } from "../mailer";

// Ręczny raport niskich stanów: npm run report:low-stock
const res = sendLowStockReport();

if (res.count === 0) {
  console.log("✅ Brak produktów poniżej minimalnego stanu.");
  process.exit(0);
}
if (!smtpConfigured()) {
  console.log("⚠️ Znaleziono " + res.count + " produkt(ów) z niskim stanem, ale SMTP nie jest skonfigurowane.");
  console.log("   Skonfiguruj SMTP w Ustawieniach (lub .env) i uruchom raport ponownie.");
  process.exit(1);
}
console.log("✅ Wysłano raport niskich stanów (" + res.count + " produktów) do " + res.recipients + " odbiorców (kolejka e-mail).");
process.exit(0);
