/**
 * In Tauri production builds the frontend is served from local files (tauri://),
 * so there is no Vite dev-server proxy. API calls must go directly to the
 * sidecar's HTTP server.  During development the Vite proxy handles /api -> :8000.
 */
const isTauri = '__TAURI__' in window || '__TAURI_INTERNALS__' in window

export const API_BASE = isTauri
  ? 'http://localhost:8000/api'
  : '/api'
