import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createScannerMockPlugin } from './src/scanner.endpoint.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const enableLocalScanner = process.env.LOCAL_SCANNER === '1' || process.env.VITE_USE_LOCAL_SCANNER === '1'
  return {
    plugins: [react(), ...(enableLocalScanner ? [createScannerMockPlugin() as any] : [])],
    server: {
      proxy: enableLocalScanner ? undefined : {
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
  }
})
