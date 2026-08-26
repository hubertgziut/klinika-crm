import { create } from "zustand";
import { api, type User } from "./api";
import type { Channel } from "./types";

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string;
  readAt: string | null;
  createdAt: string;
}

interface AppState {
  user: User | null;
  token: string | null;
  booted: boolean;
  notifications: AppNotification[];
  unread: number;
  presence: Record<string, boolean>;
  unreadCount: number;
  mailUnread: number;
  channels: Channel[];
  refreshMailUnread: () => Promise<void>;
  boot: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (u: User | null) => void;
  setToken: (t: string | null) => void;
  refreshNotifications: () => Promise<void>;
  setPresence: (userId: string, online: boolean) => void;
  setUnread: (n: number) => void;
  refreshChannels: () => Promise<void>;
}

export const useApp = create<AppState>((set, get) => ({
  user: null,
  token: null,
  booted: false,
  notifications: [],
  unread: 0,
  presence: {},
  unreadCount: 0,
  mailUnread: 0,
  channels: [],

  refreshMailUnread: async () => {
    try {
      const d = await api.get<{ unread: number }>("/api/mail/unread");
      set({ mailUnread: d.unread });
    } catch { /* IMAP nieskonfigurowane */ }
  },

  boot: async () => {
    try {
      const { user, token } = await api.get<{ user: User; token: string }>("/api/auth/me");
      set({ user, token, booted: true });
      get().refreshNotifications();
      get().refreshChannels();
      get().refreshMailUnread();
    } catch {
      set({ booted: true });
    }
  },

  login: async (email: string, password: string) => {
    const { user, token } = await api.post<{ user: User; token: string }>("/api/auth/login", { email, password });
    set({ user, token });
    get().refreshNotifications();
    get().refreshChannels();
    get().refreshMailUnread();
  },

  logout: async () => {
    try { await api.post("/api/auth/logout"); } catch { /* ignore */ }
    set({ user: null, token: null, presence: {}, channels: [], unreadCount: 0, mailUnread: 0 });
  },

  setUser: (u) => set({ user: u }),
  setToken: (t) => set({ token: t }),

  refreshNotifications: async () => {
    try {
      const data = await api.get<{ items: AppNotification[]; unread: number }>("/api/notifications");
      set({ notifications: data.items, unread: data.unread });
    } catch {
      // moduł powiadomień pojawi się w późniejszej fazie
    }
  },

  setPresence: (userId, online) =>
    set((s) => ({ presence: { ...s.presence, [userId]: online } })),

  setUnread: (n) => set({ unreadCount: n }),

  refreshChannels: async () => {
    try {
      const channels = await api.get<Channel[]>("/api/channels");
      set({
        channels,
        unreadCount: channels.reduce((sum, c) => sum + (c.unread || 0), 0),
      });
    } catch {
      // serwer niedostępny — spróbujemy przy kolejnej akcji
    }
  },
}));
