// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { fixedApps, publishedApps, targetEnv } from './published-apps.ts'

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
  it('are the apps with a manifest: Import Documents and Scan SIMs today', () => {
    expect(publishedApps(web).map((a) => [a.slug, a.devPort, a.e2ePort])).toEqual([
      ['docs-import', 5188, 5189],
      ['sim-scan', 5184, 5185],
    ])
  })

  it('are found by folder, the others left out', () => {
    const dir = workspace({ workwear: null, 'size-helper': { slug: 'size-helper', profile: 'standard', devPort: 5188 } })
    expect(publishedApps(dir)).toEqual([{ slug: 'size-helper', dir: join(dir, 'apps', 'size-helper'), profile: 'standard', devPort: 5188, e2ePort: 5189 }])
  })

  it('refuse a manifest that does not fit', () => {
    expect(() => publishedApps(workspace({ a1: { slug: 'other', profile: 'standard', devPort: 5188 } }))).toThrow(/folder's name/)
    expect(() => publishedApps(workspace({ a1: { slug: 'a1', devPort: 5188 } }))).toThrow(/profile/)
    expect(() => publishedApps(workspace({ a1: { slug: 'a1', profile: 'standard' } }))).toThrow(/devPort/)
    expect(() =>
      publishedApps(workspace({ a1: { slug: 'a1', profile: 'standard', devPort: 5188 }, a2: { slug: 'a2', profile: 'standard', devPort: 5189 } })),
    ).toThrow(/share a port/)
  })

  it("refuse a port a fixed app (the staff app, Administration, App Launcher) uses", () => {
    expect(() => publishedApps(workspace({ a1: { slug: 'a1', profile: 'standard', devPort: 5181 } }))).toThrow(/share a port/)
  })

  it('are in .claude/launch.json on their ports, as the fixed apps are', () => {
    const launch = JSON.parse(readFileSync(join(web, '..', '.claude', 'launch.json'), 'utf8')) as { configurations: { name: string; port: number }[] }
    const port = (name: string) => launch.configurations.find((c) => c.name === name)?.port
    for (const [name, p] of Object.entries(fixedApps)) expect(port(name), name).toBe(p)
    for (const a of publishedApps(web)) expect(port(a.slug), a.slug).toBe(a.devPort)
  })

  it('name the dev proxy target by slug', () => {
    expect(targetEnv('sim-scan')).toBe('VITE_APP_SIM_SCAN_TARGET')
  })
})
