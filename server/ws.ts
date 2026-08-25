import { Server as SocketIOServer } from "socket.io";
import type { Server } from "node:http";
import { getUserBySessionToken } from "./auth";
import { db } from "./db";

export let io: SocketIOServer | null = null;

export function initWs(server: Server) {
  io = new SocketIOServer(server, { cors: { origin: true, credentials: true } });
  io.use((socket, next) => {
    const sid = (socket.handshake.auth as any)?.sid as string | undefined;
    const user = getUserBySessionToken(sid);
    if (!user) return next(new Error("unauthorized"));
    (socket as any).user = user;
    next();
  });
  io.on("connection", (socket) => {
    const user = (socket as any).user;
    socket.join(`user:${user.id}`);
    io?.emit("presence:update", { userId: user.id, online: true });
    // Komunikator: wskaźnik pisania → inni członkowie kanału (bez nadawcy)
    socket.on("chat:typing", (data) => {
      const channelId = (data as any)?.channelId as string | undefined;
      if (!channelId || !user) return;
      const rows = db.prepare("SELECT user_id FROM channel_members WHERE channel_id = ?").all(channelId) as { user_id: string }[];
      if (!rows.some((r) => r.user_id === user.id)) return; // tylko członek kanału
      for (const r of rows) {
        if (r.user_id !== user.id) {
          io?.to(`user:${r.user_id}`).emit("chat:typing", { channelId, userId: user.id, name: user.name });
        }
      }
    });
    socket.on("disconnect", () => {
      io?.emit("presence:update", { userId: user.id, online: false });
    });
  });
  console.log("[ws] Socket.IO uruchomiony");
}

export function emitToUser(userId: string, event: string, data: unknown) {
  io?.to(`user:${userId}`).emit(event, data);
}
