import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  // Tauri dev server — must bind to localhost only
  server: {
    port: 1420,
    strictPort: true,
    // Proxy API calls to Python backend container
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  // Prevent Vite from hiding Rust panics
  clearScreen: false,
});
