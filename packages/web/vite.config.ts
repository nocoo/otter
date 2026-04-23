import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 7019,
    strictPort: true,
    proxy: {
      "/api": "http://localhost:7020",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
