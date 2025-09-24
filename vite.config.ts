import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import { createScannerMockPlugin } from './src/scanner.endpoint.js'

// https://vite.dev/config/
export default defineConfig(() => {
  const env = (process as unknown as { env: Record<string, string | undefined> }).env
  const enableLocalScanner = env.LOCAL_SCANNER === '1' || env.VITE_USE_LOCAL_SCANNER === '1'
  const plugins: PluginOption[] = [react()]
  const getMockPlugin: () => PluginOption = createScannerMockPlugin as unknown as () => PluginOption
  if (enableLocalScanner) plugins.push(getMockPlugin())
  return {
    plugins,
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
