import { type PlaywrightTestConfig, defineConfig } from '@playwright/test'

import { tsaURL } from './guide/lang.ts'
import base from './playwright.config.ts'

// The API's server (the one with API_ADDR) timestamps the seals, as production does.
type WebServer = Extract<NonNullable<PlaywrightTestConfig['webServer']>, readonly unknown[]>[number]
const servers = ([] as WebServer[]).concat(base.webServer ?? []).map((s) =>
  s.env?.['API_ADDR'] ? { ...s, env: { ...s.env, API_AUDIT_TSA_URL: tsaURL } } : s,
)

// Screenshots for the Help screen and docs/guide: the e2e servers and
// database, filled with the demo data (guide/setup.ts). `pnpm guide` takes
// them on each device in each language; the window is the device's
// (guide/lang.ts), set on the page each run opens.
export default defineConfig({
  ...base,
  webServer: servers,
  testDir: './guide',
  globalSetup: './guide/setup.ts',
  retries: 0,
  reporter: 'list',
  projects: [{ name: 'chromium' }],
})
