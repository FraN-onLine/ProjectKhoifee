import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiTarget = process.env.KHOIFEE_API_TARGET || "http://127.0.0.1:3001";

export default defineConfig({
  plugins: [react()],
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
    proxy: {
      "/api": apiTarget,
      "/uploads": apiTarget,
    },
  },
});
