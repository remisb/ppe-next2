import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { defineConfig, devices } from '@playwright/test'

import { adminPort, apiEnv, apiPort, appsDir, caddyMode, launcherPort, repoRoot, simScanDist, simScanPort, webPort, webURL } from './env.ts'

// E2E_WEB_SERVER=caddy serves the production bundle through deploy/Caddyfile,
// as in a deployment (CI does this); the default is the Vite dev server.
const webRoot = join(repoRoot, 'web/apps/workwear/dist')
const adminRoot = join(repoRoot, 'web/apps/admin/dist')
const launcherRoot = join(repoRoot, 'web/apps/launcher/dist')
const caddy = caddyMode
for (const root of caddy ? [webRoot, adminRoot, simScanDist, launcherRoot] : []) {
  if (!existsSync(join(root, 'index.html'))) throw new Error(`E2E_WEB_SERVER=caddy needs a web build at ${root}: run pnpm build first`)
}
// Scan SIMs is published there by global setup (the API must find the folder at start).
if (caddy) mkdirSync(appsDir, { recursive: true })

/**
 * E2E_CADDY=docker (make e2e-caddy) runs Caddy from its official image instead
 * of a caddy on the PATH: the version CI pins (ci.yml's CADDY_VERSION), or
 * E2E_CADDY_IMAGE. The repository and the published folder are mounted at
 * their own paths, read only, and the API is reached on the host.
 */
const caddyInDocker = caddy && process.env['E2E_CADDY'] === 'docker'
const caddyVersion = /CADDY_VERSION: (\S+)/.exec(readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8'))?.[1]
const caddyImage = process.env['E2E_CADDY_IMAGE'] ?? `caddy:${caddyVersion}-alpine`
const caddyEnvNames = ['SITE_ADDRESS', 'API_UPSTREAM', 'WEB_ROOT', 'ADMIN_ROOT', 'LAUNCHER_ROOT', 'PUBLISHED_ROOT']
const caddyRun = `caddy run --adapter caddyfile --config ${join(repoRoot, 'deploy/Caddyfile')}`
const webServerCommand = caddyInDocker
  ? // A container left by a run that was stopped would hold the port.
    `docker rm -f ppe-e2e-caddy >/dev/null 2>&1; exec docker run --rm --name ppe-e2e-caddy -p ${webPort}:${webPort} ` +
    `--add-host=host.docker.internal:host-gateway ${caddyEnvNames.map((n) => `-e ${n}`).join(' ')} ` +
    `-v ${repoRoot}:${repoRoot}:ro -v ${appsDir}:${appsDir}:ro ${caddyImage} ${caddyRun}`
  : caddy
  ? caddyRun
  : // The app's own vite binary, not `pnpm exec vite`: pnpm 12 starts the
    // child in its own process group and exits, so Playwright's shutdown never
    // reaches vite and the run hangs after the last test.
    `${join(repoRoot, 'web/apps/workwear/node_modules/.bin/vite')} --port ${webPort} --strictPort`
const webServerEnv: Record<string, string> = caddy
  ? {
      SITE_ADDRESS: webURL,
      API_UPSTREAM: `${caddyInDocker ? 'host.docker.internal' : 'localhost'}:${apiPort}`,
      WEB_ROOT: webRoot,
      ADMIN_ROOT: adminRoot,
      LAUNCHER_ROOT: launcherRoot,
      PUBLISHED_ROOT: appsDir,
    }
  : {
      VITE_API_TARGET: `http://localhost:${apiPort}`,
      VITE_ADMIN_TARGET: `http://localhost:${adminPort}`,
      VITE_SIM_SCAN_TARGET: `http://localhost:${simScanPort}`,
      VITE_LAUNCHER_TARGET: `http://localhost:${launcherPort}`,
    }

// With Vite, Administration runs on its own server, which the staff app's proxies /admin to.
const adminServer = {
  command: `${join(repoRoot, 'web/apps/admin/node_modules/.bin/vite')} --port ${adminPort} --strictPort`,
  cwd: join(repoRoot, 'web/apps/admin'),
  env: { ...(process.env as Record<string, string>), VITE_API_TARGET: `http://localhost:${apiPort}` },
  url: `http://localhost:${adminPort}/admin/`,
  reuseExistingServer: false,
  timeout: 120_000,
}

// And so does Scan SIMs, the trial, at /apps/sim-scan (behind Caddy, a published app).
const simScanServer = {
  command: `${join(repoRoot, 'web/apps/sim-scan/node_modules/.bin/vite')} --port ${simScanPort} --strictPort`,
  cwd: join(repoRoot, 'web/apps/sim-scan'),
  env: { ...(process.env as Record<string, string>), VITE_API_TARGET: `http://localhost:${apiPort}` },
  url: `http://localhost:${simScanPort}/apps/sim-scan/`,
  reuseExistingServer: false,
  timeout: 120_000,
}

// And App Launcher, at /apps.
const launcherServer = {
  command: `${join(repoRoot, 'web/apps/launcher/node_modules/.bin/vite')} --port ${launcherPort} --strictPort`,
  cwd: join(repoRoot, 'web/apps/launcher'),
  env: { ...(process.env as Record<string, string>), VITE_API_TARGET: `http://localhost:${apiPort}` },
  url: `http://localhost:${launcherPort}/apps/`,
  reuseExistingServer: false,
  timeout: 120_000,
}

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
      // Empty the database and give ppe_app its password first: the API connects as it (env.ts).
      command: `node --experimental-strip-types --no-warnings ${join(repoRoot, 'web/e2e/prepare-db.ts')} && go run ./cmd/api`,
      cwd: repoRoot,
      env: apiEnv(),
      url: `http://localhost:${apiPort}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: webServerCommand,
      cwd: join(repoRoot, 'web/apps/workwear'),
      env: { ...(process.env as Record<string, string>), ...webServerEnv },
      url: webURL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    ...(caddy ? [] : [adminServer, simScanServer, launcherServer]),
  ],
})
