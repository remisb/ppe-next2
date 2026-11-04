import { readdirSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// Tailwind scans this app's own files and @ppe/ui (its styles.css says @source).
// A class used only in another package's components is silently left out of the
// built CSS unless index.css names that package with @source: this test names it.
const url = (path: string) => new URL(path, import.meta.url)
const indexCss = readFileSync(url('index.css'), 'utf8')
const files = (dir: URL) => readdirSync(dir, { recursive: true, encoding: 'utf8' })
const appSource = files(url('.'))
  .filter((f) => /\.tsx?$/.test(f))
  .map((f) => readFileSync(url(f), 'utf8'))
  .join('\n')

const packages = readdirSync(url('../../../packages'))
  .filter((dir) => dir !== 'ui')
  .map((dir) => ({
    dir,
    name: (JSON.parse(readFileSync(url(`../../../packages/${dir}/package.json`), 'utf8')) as { name: string }).name,
    hasComponents: files(url(`../../../packages/${dir}/src/`)).some((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx')),
  }))
  .filter((p) => p.hasComponents && appSource.includes(`'${p.name}`))

describe('Tailwind sources', () => {
  it.each(packages)("names $name's components in index.css", ({ dir }) => {
    expect(indexCss).toContain(`@source '../../../packages/${dir}/src';`)
  })
})
