import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Pinned; see ~/Documents/Dev/ports.md. strictPort so a clash fails loudly
    // instead of drifting onto another project's port.
    port: 4250,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8050",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["src/test-setup.ts"],
  },
  fmt: {},
  lint: { options: { typeAware: true, typeCheck: true } },
});
