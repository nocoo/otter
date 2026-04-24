import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import pkg from "./package.json" with { type: "json" };

// biome-ignore lint/style/useNamingConvention: Vite config factory
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "OTTER_");
  const target = env.OTTER_API_URL ?? "https://otter.nocoo.workers.dev";
  const devToken = env.OTTER_DEV_API_TOKEN ?? "";

  return {
    plugins: [react(), tailwindcss()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    resolve: {
      alias: {
        "@": resolve(__dirname, "./src"),
      },
    },
    server: {
      port: 7019,
      strictPort: true,
      proxy: {
        "/api": {
          target,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              if (devToken && !proxyReq.getHeader("authorization")) {
                proxyReq.setHeader("authorization", `Bearer ${devToken}`);
              }
            });
          },
        },
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };
});
