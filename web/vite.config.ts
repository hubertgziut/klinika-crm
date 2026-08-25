
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: Vite na :5173, proxy do serwera API na :3000
export default defineConfig({
  root: "web",
  plugins: [react()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("@tiptap")) return "tiptap";
            // cały ekosystem React w jednym chunku (react, router, zustand, use-sync-external-store)
            if (id.includes("react") || id.includes("scheduler")
              || id.includes("react-router") || id.includes("@remix-run")
              || id.includes("zustand") || id.includes("use-sync-external-store")) return "react";
            if (id.includes("socket.io-client") || id.includes("engine.io-client")) return "socket";
            return "vendor";
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/socket.io": { target: "http://localhost:3000", ws: true },
      "/uploads": "http://localhost:3000",
    },
  },
});
