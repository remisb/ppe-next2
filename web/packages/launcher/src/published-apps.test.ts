// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { publishedApps, targetEnv } from './published-apps.ts'

const web = fileURLToPath(new URL('../../..', import.meta.url))

/** A workspace with these apps, each with its manifest (or none). */
function workspace(apps: Record<string, object | null>): string {
  const dir = mkdtempSync(join(tmpdir(), 'published-apps-'))
  for (const [slug, manifest] of Object.entries(apps)) {
    mkdirSync(join(dir, 'apps', slug, 'public'), { recursive: true })
    if (manifest) writeFileSync(join(dir, 'apps', slug, 'public', 'ppe-app.json'), JSON.stringify(manifest))
  }
  return dir
}

describe('published apps', () => {
  it('are the apps with a manifest: Scan SIMs today', () => {
    expect(publishedApps(web).map((a) => [a.slug, a.devPort, a.e2ePort])).toEqual([['sim-scan', 5184, 5185]])
  })

  it('are found by folder, the others left out', () => {
    const dir = workspace({ workwear: null, 'size-helper': { slug: 'size-helper', capabilities: [], devPort: 5188 } })
    expect(publishedApps(dir)).toEqual([{ slug: 'size-helper', dir: join(dir, 'apps', 'size-helper'), capabilities: [], devPort: 5188, e2ePort: 5189 }])
  })

  it('refuse a manifest that does not fit', () => {
    expect(() => publishedApps(workspace({ a1: { slug: 'other', capabilities: [], devPort: 5188 } }))).toThrow(/folder's name/)
    expect(() => publishedApps(workspace({ a1: { slug: 'a1', devPort: 5188 } }))).toThrow(/capabilities/)
    expect(() => publishedApps(workspace({ a1: { slug: 'a1', capabilities: [] } }))).toThrow(/devPort/)
    expect(() =>
      publishedApps(workspace({ a1: { slug: 'a1', capabilities: [], devPort: 5188 }, a2: { slug: 'a2', capabilities: [], devPort: 5189 } })),
    ).toThrow(/share a port/)
  })

  it('name the dev proxy target by slug', () => {
    expect(targetEnv('sim-scan')).toBe('VITE_APP_SIM_SCAN_TARGET')
  })
})
