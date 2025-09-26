import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(() => {
  const plugins = [react()]

  // Always proxy to the local backend in development. No REST fallbacks.
  const proxy = {
    '/ws': {
      target: 'http://localhost:3001',
      changeOrigin: true,
      ws: true,
    },
    '/scanner': {
      target: 'http://localhost:3001',
      changeOrigin: true,
    },
  }

  return {
    plugins,
    server: {
      proxy,
    },
    test: {
      environment: 'jsdom',
      include: ['tests/detailModal.compare.test.tsx'],
      globals: true,
    },
  }
})
