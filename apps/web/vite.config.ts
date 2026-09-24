import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      "/api": process.env.AGENTER_API_TARGET ?? "http://localhost:3000",
    },
  },
});
