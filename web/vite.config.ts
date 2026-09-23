import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `pnpm dev` proxies the API to a running `KULA_TOKEN=dev kula view --no-open`.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:7420" } },
  build: { outDir: "dist", assetsDir: "assets", chunkSizeWarningLimit: 900 },
});
