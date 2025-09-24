import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(() => {
  const plugins = [react()]

  // WebSocket proxy remains enabled for development
  // Note: target must be HTTP for ws upgrades; http-proxy handles the WS upgrade when ws: true
  const proxy = {
    '/ws': {
      target: 'http://localhost:3001',
      changeOrigin: true,
      ws: true,
    },
  }

  return {
    plugins,
    server: {
      proxy,
    },
  }
})
