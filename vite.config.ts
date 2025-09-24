import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // REST API proxy: call fetch('/scanner?...') in dev
      '/scanner': {
        target: 'https://api-rs.dexcelerate.com',
        changeOrigin: true,
        secure: true,
        ws: false,
      },
      // WebSocket proxy: connect to new WebSocket('ws://localhost:5173/ws') in dev
      '/ws': {
        target: 'wss://api-rs.dexcelerate.com',
        changeOrigin: true,
        secure: true,
        ws: true,
      },
    },
  },
})
