import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { defineConfig, devices } from '@playwright/test'

import { apiEnv, apiPort, repoRoot, webPort, webURL } from './env.ts'

// E2E_WEB_SERVER=caddy serves the production bundle through deploy/Caddyfile,
// as in a deployment (CI does this); the default is the Vite dev server.
const webRoot = join(repoRoot, 'web/apps/workwear/dist')
const caddy = process.env['E2E_WEB_SERVER'] === 'caddy'
if (caddy && !existsSync(join(webRoot, 'index.html'))) {
  throw new Error(`E2E_WEB_SERVER=caddy needs a web build at ${webRoot}: run pnpm build first`)
}
const webServerCommand = caddy
  ? `caddy run --adapter caddyfile --config ${join(repoRoot, 'deploy/Caddyfile')}`
  : `pnpm --dir ../apps/workwear exec vite --port ${webPort} --strictPort`
const webServerEnv: Record<string, string> = caddy
  ? { SITE_ADDRESS: webURL, API_UPSTREAM: `localhost:${apiPort}`, WEB_ROOT: webRoot }
  : { VITE_API_TARGET: `http://localhost:${apiPort}` }

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
      command: webServerCommand,
      env: { ...(process.env as Record<string, string>), ...webServerEnv },
      url: webURL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
