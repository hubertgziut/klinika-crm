import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { hashPassword, nowISO, sha256, verifyPassword } from "../util";
import { createSession, destroySession, isLoginAllowed, requireAuth, resetLoginLimit, SESSION_COOKIE } from "../auth";

export const authRouter = Router();

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

authRouter.post("/login", (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Nieprawidłowe dane logowania" }); return; }
  const { email, password } = parsed.data;
  const key = `${req.ip}:${email.toLowerCase()}`;
  if (!isLoginAllowed(key)) {
    res.status(429).json({ error: "Zbyt wiele prób logowania. Spróbuj za 15 minut." });
    return;
  }
  const user = db.prepare("SELECT * FROM users WHERE email = ? AND active = 1").get(email.toLowerCase()) as any;
  if (!user || !verifyPassword(password, user.password_hash)) {
    res.status(401).json({ error: "Nieprawidłowy e-mail lub hasło" });
    return;
  }
  resetLoginLimit(key);
  const { token, expiresAt } = createSession(user.id);
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", expires: new Date(expiresAt), path: "/" });
  res.json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role, avatarColor: user.avatar_color },
    token,
  });
});

authRouter.post("/logout", (req, res) => {
  const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
  if (token) destroySession(token);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user, token: req.token });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

authRouter.post("/change-password", requireAuth, (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Nowe hasło musi mieć co najmniej 8 znaków" });
    return;
  }
  const { currentPassword, newPassword } = parsed.data;
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user!.id) as any;
  if (!user || !verifyPassword(currentPassword, user.password_hash)) {
    res.status(401).json({ error: "Nieprawidłowe obecne hasło" });
    return;
  }
  db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
    .run(hashPassword(newPassword), nowISO(), user.id);
  if (req.token) {
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?")
      .run(user.id, sha256(req.token));
  }
  res.json({ ok: true });
});