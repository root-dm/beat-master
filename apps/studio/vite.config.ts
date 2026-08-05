import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@beat-master/core": path.resolve(__dirname, "../../packages/beat-core/src")
    }
  },
  server: {
    port: 5173,
    strictPort: false
  }
});

