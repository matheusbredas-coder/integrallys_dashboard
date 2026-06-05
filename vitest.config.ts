import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: { environment: "jsdom", globals: true },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // server-only throws when resolved outside RSC; stub it so server modules are unit-testable
      "server-only": path.resolve(__dirname, "./src/test/server-only-stub.ts"),
    },
  },
});
