import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initDb } from "./db";
import { authRouter } from "./routes/auth";
import { usersRouter } from "./routes/users";
import { settingsRouter } from "./routes/settings";
import { searchRouter } from "./routes/search";
import { projectsRouter, branchesRouter } from "./routes/projects";
import { projectTasksRouter, tasksRouter } from "./routes/tasks";
import { chatRouter } from "./routes/chat";
import { tablesRouter } from "./routes/tables";
import { docsRouter, uploadsRouter } from "./routes/docs";
import { shopRouter } from "./routes/shop";
import { notificationsRouter } from "./routes/notifications";
import { aiRouter } from "./routes/ai";
import { initWs } from "./ws";
import { startMailWorker } from "./mailer";
import { calendarRouter, startCalendarWorker } from "./routes/calendar";
import { mailRouter } from "./routes/mail";
import { startMailboxWorker } from "./mailbox";
import { whatsappRouter, startWhatsappForwarder } from "./routes/whatsapp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
initDb();

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: "Nieprawidłowy JSON" });
    return;
  }
  next(err);
});
// Błędy nieobsłużone — zawsze JSON (zamiast domyślnej strony HTML)
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[api] błąd:", err?.message ?? err);
  res.status(500).json({ error: "Błąd serwera" });
});
app.use(cookieParser());

app.get("/api/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/search", searchRouter);
app.use("/api/calendar", calendarRouter);
app.use("/api/mail", mailRouter);
app.use("/api/whatsapp", whatsappRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/branches", branchesRouter);
app.use("/api/projects", projectTasksRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/channels", chatRouter);
app.use("/api/tables", tablesRouter);
app.use("/api/documents", docsRouter);
app.use("/api/uploads", uploadsRouter);
app.use("/api", shopRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/ai", aiRouter);

const DATA_DIR = path.join(__dirname, "..", "data");
app.use("/uploads", express.static(path.join(DATA_DIR, "uploads")));

const distDir = path.join(__dirname, "..", "dist");
app.use(express.static(distDir));

app.use((req, res, next) => {
  if (req.path.startsWith("/api")) {
    res.status(404).json({ error: "Nie znaleziono" });
    return;
  }
  next();
});
app.get("*", (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"), (err) => {
    if (err) res.status(404).send("Brak builda frontendu. Uruchom: npm run build");
  });
});

const server = http.createServer(app);
initWs(server);
startMailWorker();
startCalendarWorker();
startMailboxWorker();
startWhatsappForwarder();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
server.listen(PORT, HOST, () => {
  console.log("\n🩺 Klinika CRM — serwer działa");
  console.log(`   Lokalnie:  http://localhost:${PORT}`);
  const ip = lanIp();
  if (ip !== "127.0.0.1") console.log(`   W sieci:   http://${ip}:${PORT}`);
  console.log("");
});

function lanIp(): string {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] ?? []) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "127.0.0.1";
}
