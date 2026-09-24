import { defineConfig, devices } from '@playwright/test'

import { apiEnv, apiPort, repoRoot, webPort, webURL } from './env.ts'

export default defineConfig({
  testDir: './tests',
  // One shared database: specs run in order, not in parallel.
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './global-setup.ts',
  use: {
    baseURL: webURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'go run ./cmd/api',
      cwd: repoRoot,
      env: apiEnv(),
      url: `http://localhost:${apiPort}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `pnpm --dir ../apps/workwear exec vite --port ${webPort} --strictPort`,
      env: { ...(process.env as Record<string, string>), VITE_API_TARGET: `http://localhost:${apiPort}` },
      url: webURL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
