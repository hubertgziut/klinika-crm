import { io, type Socket } from "socket.io-client";
import { useApp } from "./store";

let socket: Socket | null = null;

export function connectSocket(): Socket | null {
  const token = useApp.getState().token;
  if (!token) return null;
  if (socket?.connected) return socket;
  socket = io("/", {
    auth: { sid: token },
    transports: ["websocket"],
  });
  socket.on("notif:new", () => {
    useApp.getState().refreshNotifications();
  });
  socket.on("chat:message", () => {
    // nowa wiadomość — odśwież listę kanałów i licznik nieprzeczytanych (dzwonek)
    useApp.getState().refreshChannels();
  });
  socket.on("presence:update", (data) => {
    const d = data as { userId?: string; online?: boolean };
    if (d?.userId) useApp.getState().setPresence(d.userId, !!d.online);
  });
  socket.on("connect_error", () => {
    // brak połączenia — spróbujemy ponownie przy kolejnej akcji
  });
  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
