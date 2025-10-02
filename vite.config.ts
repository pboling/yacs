import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// TEST SETUP EXPLANATION:
// - Vitest (via Vite) runs all .ts, .tsx, .js tests in tests/ (unit/integration)
// - Playwright e2e tests in e2e/ must be run with Playwright, not Vitest
// - tsconfig.tests.json includes all test files for type checking, but only tests/ are run by Vitest
// - This file is the SINGLE SOURCE OF TRUTH for Vitest config

// https://vite.dev/config/
export default defineConfig(() => {
  const plugins = [react()]

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
    base: '/yacs/',
    plugins,
    server: {
      proxy,
    },
    test: {
      bail: 1,
      environment: 'jsdom',
      setupFiles: ['./tests/setup.ts'],
      include: ['tests/**/*.{test,spec}.{ts,tsx,js}'], // Run all .ts, .tsx, .js tests in tests/
      exclude: ['e2e', 'node_modules', 'dist', 'build'], // Exclude e2e tests from Vitest
      globals: true,
      tsconfig: './tsconfig.tests.json',
    },
  }
})
