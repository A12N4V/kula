import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// `pnpm dev` proxies the API to a running `KULA_TOKEN=dev kula view --no-open`.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "#own-styles": fileURLToPath(new URL("./src/styles", import.meta.url)),
    },
  },
  server: { proxy: { "/api": "http://localhost:7420" } },
  build: { outDir: "dist", assetsDir: "assets", chunkSizeWarningLimit: 900 },
});
