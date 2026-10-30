import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { readFileSync } from "node:fs";

// This app's jimbo-ui.json, for the jimbo-ui config section's About tab. The
// Dockerfile copies it next to web/; without it, About shows the release only.
let jimboUi: Record<string, unknown> = {};
try {
  jimboUi = JSON.parse(readFileSync(path.resolve(__dirname, "../jimbo-ui.json"), "utf8"));
} catch { /* not available in this build */ }

export default defineConfig({
  plugins: [react()],
  define: {
    __JIMBO_APP__: JSON.stringify({ name: "jimbo-backup", ...jimboUi }),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  // `npm run dev` against a running dashboard: the API stays on the real server.
  server: {
    proxy: {
      "/api": { target: process.env.API_URL ?? "http://localhost:4343", changeOrigin: true },
    },
  },
});
