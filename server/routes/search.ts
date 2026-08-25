import { Router } from "express";
import { db } from "../db";
import { requireAuth } from "../auth";

export const searchRouter = Router();
searchRouter.use(requireAuth);

searchRouter.get("/", (req, res) => {
  const q = String(req.query.q || "").trim();
  const empty = { tasks: [], projects: [], products: [], documents: [], messages: [] };
  if (!q) { res.json(empty); return; }
  const like = `%${q}%`;
  const tasks = db.prepare("SELECT id, title, status, project_id FROM tasks WHERE title LIKE ? ORDER BY updated_at DESC LIMIT 10").all(like);
  const projects = db.prepare("SELECT id, name, emoji FROM projects WHERE name LIKE ? LIMIT 10").all(like);
  const products = db.prepare("SELECT id, name, price, supplier FROM products WHERE name LIKE ? LIMIT 10").all(like);
  const documents = db.prepare("SELECT id, title FROM documents WHERE title LIKE ? LIMIT 10").all(like);
  const messages = db.prepare("SELECT id, body, channel_id FROM messages WHERE body LIKE ? LIMIT 10").all(like);
  res.json({ tasks, projects, products, documents, messages });
});
