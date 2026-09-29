import { defineConfig } from '@playwright/test'

import base from './playwright.config.ts'

// Screenshots for the Help screen and docs/guide: the e2e servers and
// database, filled with the demo data (guide/setup.ts). `pnpm guide` takes
// them on each device in each language; the window is the device's
// (guide/lang.ts), set on the page each run opens.
export default defineConfig({
  ...base,
  testDir: './guide',
  globalSetup: './guide/setup.ts',
  retries: 0,
  reporter: 'list',
  projects: [{ name: 'chromium' }],
})
