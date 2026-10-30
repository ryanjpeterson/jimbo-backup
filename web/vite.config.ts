import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
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
