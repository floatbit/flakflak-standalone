import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    strictPort: true,
    allowedHosts: ["app-flakflak.localhost"],
  },
  build: { rollupOptions: { input: { app: "index.html", demo: "demo.html" } } },
});
