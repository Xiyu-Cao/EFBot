/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
const isTauri = !!process.env.TAURI_ENV_PLATFORM

export default defineConfig({
  plugins: [
    vue(),
  ],
  base: '/',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  server: {
    host: '0.0.0.0',
    port: 1420,
    strictPort: true,
    watch: {
      usePolling: true,
      interval: 500,
    },
    proxy: {
      '/api': {
        target: 'http://python-app:8000',
        changeOrigin: true,
      },
    },
  },
  clearScreen: false,
  optimizeDeps: {
    force: false,
  },
  test: {}
})
