import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", sourcemap: false },
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": "http://127.0.0.1:8080",
      "/frontend-config.json": "http://127.0.0.1:8080",
    },
  },
  test: { include: ["tests/**/*.test.{ts,tsx}"], environment: "jsdom", setupFiles: ["./tests/setup.ts"], restoreMocks: true },
});
