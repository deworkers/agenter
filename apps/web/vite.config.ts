import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.AGENTER_API_TARGET ?? "http://localhost:3000",
        // The API compares Origin with Host to protect cookie-authenticated writes.
        changeOrigin: false,
      },
    },
  },
});
