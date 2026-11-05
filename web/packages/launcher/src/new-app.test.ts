// @vitest-environment node
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { newApp, nextDevPort } from './new-app.ts'
import { publishedApps } from './published-apps.ts'

const web = fileURLToPath(new URL('../../..', import.meta.url))
const templateDir = join(web, 'templates', 'published-app')
const realDefaults = join(web, '..', 'internal', 'domain', 'launcher', 'defaults.go')

/** A scratch workspace with Scan SIMs' manifest (and these others) and a copy of defaults.go. */
function workspace(others: Record<string, number> = {}) {
  const webDir = mkdtempSync(join(tmpdir(), 'new-app-'))
  for (const [slug, devPort] of Object.entries({ 'sim-scan': 5184, ...others })) {
    mkdirSync(join(webDir, 'apps', slug, 'public'), { recursive: true })
    writeFileSync(join(webDir, 'apps', slug, 'public', 'ppe-app.json'), JSON.stringify({ slug, profile: 'standard', devPort }))
  }
  const defaultsFile = join(webDir, 'defaults.go')
  copyFileSync(realDefaults, defaultsFile)
  const launchFile = join(webDir, 'launch.json')
  copyFileSync(join(web, '..', '.claude', 'launch.json'), launchFile)
  return { webDir, templateDir, defaultsFile, launchFile }
}

const read = (dir: string, file: string) => readFileSync(join(dir, file), 'utf8')

describe('make new-app', () => {
  it('starts a published app from the template, found by its manifest, with its tile in POC', () => {
    const paths = workspace()
    const started = newApp({ slug: 'size-helper', name: 'Size Helper', nameLt: 'Dydžių pagalbininkas', nameRu: 'Помощник по размерам' }, paths)
    expect(started).toEqual({ dir: join(paths.webDir, 'apps', 'size-helper'), devPort: 5188, untranslated: false })
    expect(publishedApps(paths.webDir).map((a) => [a.slug, a.devPort, a.profile])).toEqual([
      ['sim-scan', 5184, 'standard'],
      ['size-helper', 5188, 'standard'],
    ])
    expect(JSON.parse(read(started.dir, 'package.json')).name).toBe('@ppe/size-helper-app')
    expect(read(started.dir, 'src/main.tsx')).toContain('<ApiProvider app="size-helper"')
    expect(read(started.dir, 'src/i18n/lt/index.ts')).toContain("appName: 'Dydžių pagalbininkas'")
    for (const f of readdirSync(started.dir, { recursive: true, encoding: 'utf8' }).filter((f) => /\.\w+$/.test(f))) {
      expect(read(started.dir, f), f).not.toMatch(/__[A-Z_]+__/)
    }
    // Its dev server in launch.json, in the file's own layout, after the others.
    const launch = readFileSync(paths.launchFile, 'utf8')
    expect(launch).toContain('    {\n      "name": "size-helper",\n      "runtimeExecutable": "pnpm",\n      "runtimeArgs": ["--dir", "web/apps/size-helper", "dev"],\n      "port": 5188\n    }\n  ]\n}')
    const defaults = readFileSync(paths.defaultsFile, 'utf8')
    expect(defaults).toContain(
      '\t{Slug: "size-helper", Kind: KindApp, Group: "workwear", Icon: "box", Color: "#3b4256", Href: "/apps/size-helper/", Tier: TierHere, Stage: StagePOC,\n' +
        '\t\tNames: Names{"Size Helper", "Dydžių pagalbininkas", "Помощник по размерам"}},\n\t// make new-app adds',
    )
  })

  it('escapes the name for each file, and says when Lithuanian and Russian kept it', () => {
    const paths = workspace()
    const started = newApp({ slug: 'kims-tools', name: `Kim's <Tools> & "Co"` }, paths)
    expect(started.untranslated).toBe(true)
    expect(read(started.dir, 'src/i18n/en/index.ts')).toContain(`appName: 'Kim\\'s <Tools> & "Co"'`)
    expect(read(started.dir, 'index.html')).toContain('<title>Kim\'s &lt;Tools&gt; &amp; &quot;Co&quot; · Workwear &amp; Equipment</title>')
    expect(JSON.parse(read(started.dir, 'package.json')).description).toMatch(/^Kim's <Tools> & "Co", a published app/)
    expect(readFileSync(paths.defaultsFile, 'utf8')).toContain('Names: Names{"Kim\'s <Tools> & \\"Co\\""')
  })

  it('takes the next even port no app uses', () => {
    expect(nextDevPort(workspace({ a1: 5188, a2: 5192 }).webDir)).toBe(5190)
    expect(nextDevPort(workspace({ a1: 5189 }).webDir)).toBe(5192)
  })

  it('refuses a slug that does not fit or is taken, changing nothing', () => {
    const paths = workspace()
    const before = readFileSync(paths.defaultsFile, 'utf8')
    expect(() => newApp({ slug: 'Size', name: 'Size' }, paths)).toThrow(/lower-case/)
    expect(() => newApp({ slug: 'files', name: 'Files' }, paths)).toThrow(/App Launcher's own path/)
    expect(() => newApp({ slug: 'sim-scan', name: 'Scan' }, paths)).toThrow(/exists already/)
    expect(() => newApp({ slug: 'crew', name: 'Crew' }, paths)).toThrow(/tile with slug crew/)
    expect(() => newApp({ slug: 'size-helper', name: ' ' }, paths)).toThrow(/name/)
    expect(existsSync(join(paths.webDir, 'apps', 'crew'))).toBe(false)
    expect(readFileSync(paths.defaultsFile, 'utf8')).toBe(before)
  })

  it('refuses a template with a placeholder it does not know, leaving no folder', () => {
    const paths = workspace()
    const badTemplate = mkdtempSync(join(tmpdir(), 'template-'))
    mkdirSync(join(badTemplate, 'src'))
    writeFileSync(join(badTemplate, 'package.json'), '{ "name": "@ppe/__SLUG__-app" }')
    writeFileSync(join(badTemplate, 'src', 'main.ts'), "export const owner = '__OWNER__'")
    expect(() => newApp({ slug: 'size-helper', name: 'Size Helper' }, { ...paths, templateDir: badTemplate })).toThrow(/__OWNER__/)
    expect(existsSync(join(paths.webDir, 'apps', 'size-helper'))).toBe(false)
  })
})
