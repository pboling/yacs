import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: {
    timeout: 30_000,
  },
  use: {
    headless: true,
    baseURL: 'http://localhost:5173',
  },
  webServer: [
    {
      command: 'npm run dev:serve',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
})
