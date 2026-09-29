import { defineConfig } from '@playwright/test'

import base from './playwright.config.ts'

// Screenshots for docs/guide: the e2e servers and database, filled with the
// demo data (guide/setup.ts). `pnpm guide` regenerates docs/guide/img.
export default defineConfig({
  ...base,
  testDir: './guide',
  globalSetup: './guide/setup.ts',
  retries: 0,
  reporter: 'list',
  use: { ...base.use, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 },
  projects: [{ name: 'chromium' }],
})
