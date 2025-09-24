import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(() => {
  const plugins = [react()]

  // WebSocket proxy remains enabled for development
  const proxy = {
    '/ws': {
      target: 'wss://api-rs.dexcelerate.com',
      changeOrigin: true,
      secure: true,
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
