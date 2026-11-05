import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { defineConfig, devices } from '@playwright/test'

import { targetEnv } from '../packages/launcher/src/published-apps.ts'
import { adminPort, apiEnv, apiPort, appsDir, caddyMode, launcherPort, publishedApps, repoRoot, webPort, webURL } from './env.ts'

// E2E_WEB_SERVER=caddy serves the production bundle through deploy/Caddyfile,
// as in a deployment (CI does this); the default is the Vite dev server.
const webRoot = join(repoRoot, 'web/apps/workwear/dist')
const adminRoot = join(repoRoot, 'web/apps/admin/dist')
const launcherRoot = join(repoRoot, 'web/apps/launcher/dist')
const caddy = caddyMode
for (const root of caddy ? [webRoot, adminRoot, launcherRoot, ...publishedApps.map((a) => join(a.dir, 'dist'))] : []) {
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
      ...Object.fromEntries(publishedApps.map((a) => [targetEnv(a.slug), `http://localhost:${a.e2ePort}`])),
      VITE_LAUNCHER_TARGET: `http://localhost:${launcherPort}`,
    }

// With Vite, each app besides the staff app runs on its own server, which
// the staff app's proxies to, so tests open them on one origin as behind
// Caddy: Administration at /admin, each published app (Scan SIMs) at
// /apps/<slug> (behind Caddy, published instead) and App Launcher at /apps.
// Each is started from the app's own vite (see webServerCommand), on its port.
const viteServer = (dir: string, port: number, path: string) => ({
  command: `${join(dir, 'node_modules/.bin/vite')} --port ${port} --strictPort`,
  cwd: dir,
  env: { ...(process.env as Record<string, string>), VITE_API_TARGET: `http://localhost:${apiPort}` },
  url: `http://localhost:${port}${path}`,
  reuseExistingServer: false,
  timeout: 120_000,
})
const appServers = [
  viteServer(join(repoRoot, 'web/apps/admin'), adminPort, '/admin/'),
  ...publishedApps.map((a) => viteServer(a.dir, a.e2ePort, `/apps/${a.slug}/`)),
  viteServer(join(repoRoot, 'web/apps/launcher'), launcherPort, '/apps/'),
]

export default defineConfig({
  testDir: './tests',
  // One shared database: specs run in order, not in parallel.
  fullyParallel: false,
  workers: 1,
  // No retries: the suite is one serial story over one database, emptied only
  // when the API starts, so a retry would start mid-story on the first run's
  // data, could not pass, and only doubled a failed run's time.
  retries: 0,
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
    ...(caddy ? [] : appServers),
  ],
})
