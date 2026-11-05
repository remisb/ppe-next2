/**
 * make new-app (the handbook's improvement 4): starts a published app at
 * web/apps/<slug> from web/templates/published-app (a small app in
 * @ppe/launcher's frame, its manifest with the next free dev port, its words
 * in EN/LT/RU, its policy and Tailwind tests) and adds its tile to
 * internal/domain/launcher/defaults.go in POC, so only Testers see it until
 * an administrator moves it on. The tile is what lets a deploy publish it:
 * the API publishes only a registered app. Nothing else outside its folder
 * changes: the build, the deploy, the dev proxy and e2e find it by its
 * manifest (published-apps.ts).
 *
 * Node only, run with type stripping:
 *   node --experimental-strip-types packages/launcher/src/new-app.ts --slug size-helper --name 'Size Helper' [--name-lt …] [--name-ru …]
 *   node --experimental-strip-types packages/launcher/src/new-app.ts --check
 * --check (CI's web job) starts an app from the template in apps/, without a
 * tile, typechecks, tests and builds it with another app's node_modules, and
 * removes it, so the template cannot rot unnoticed.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// By path: this file runs in Node, beside the workspace's packages.
import { APP_SLUG_PATTERN, RESERVED_APP_SLUGS } from '../../api-client/src/app-slugs.ts'
import { publishedApps } from './published-apps.ts'

export interface NewApp {
  slug: string
  /** Its name in English; Lithuanian and Russian fall back to it, which its i18n test then reports. */
  name: string
  nameLt?: string | undefined
  nameRu?: string | undefined
}

export interface Paths {
  /** The workspace: web/. */
  webDir: string
  /** web/templates/published-app by default. */
  templateDir?: string
  /** internal/domain/launcher/defaults.go, or null for no tile. */
  defaultsFile?: string | null
}

export interface Started {
  dir: string
  devPort: number
  /** Whether Lithuanian or Russian kept the English name. */
  untranslated: boolean
}


/** The dev ports of the apps that are not published (the staff app, Administration, App Launcher) and their e2e ports. */
const fixedPorts = [5180, 5181, 5182, 5183, 5186, 5187]
const marker = '// make new-app adds'

/** The first even port from 5188 that no app uses for development or e2e. */
export function nextDevPort(webDir: string): number {
  const used = new Set([...fixedPorts, ...publishedApps(webDir).flatMap((a) => [a.devPort, a.e2ePort])])
  let port = 5188
  while (used.has(port) || used.has(port + 1)) port += 2
  return port
}

const escapes: Record<string, (s: string) => string> = {
  '.ts': (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'"),
  '.tsx': (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'"),
  '.html': (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  '.json': (s) => JSON.stringify(s).slice(1, -1),
}

/** Starts the app; throws, changing nothing, when the slug or a name does not fit. */
export function newApp(app: NewApp, paths: Paths): Started {
  const webDir = paths.webDir
  const templateDir = paths.templateDir ?? join(webDir, 'templates', 'published-app')
  const defaultsFile = paths.defaultsFile === undefined ? join(webDir, '..', 'internal', 'domain', 'launcher', 'defaults.go') : paths.defaultsFile
  const slug = app.slug.trim()
  const name = app.name.trim()
  const nameLt = app.nameLt?.trim() || name
  const nameRu = app.nameRu?.trim() || name
  if (!APP_SLUG_PATTERN.test(slug)) throw new Error(`slug ${JSON.stringify(slug)}: a lower-case letter, then 2 to 31 lower-case letters, digits or hyphens`)
  if (RESERVED_APP_SLUGS.includes(slug)) throw new Error(`slug ${slug} is App Launcher's own path under /apps/`)
  if (name === '') throw new Error('name: the app needs a name in English')
  const dir = join(webDir, 'apps', slug)
  if (existsSync(dir)) throw new Error(`${dir} exists already`)
  let defaults = ''
  if (defaultsFile) {
    defaults = readFileSync(defaultsFile, 'utf8')
    if (defaults.includes(`Slug: ${JSON.stringify(slug)},`)) throw new Error(`a tile with slug ${slug} exists already in ${defaultsFile}`)
    if (!defaults.includes(marker)) throw new Error(`${defaultsFile} has lost the line "${marker} …" that new tiles go above`)
  }

  const devPort = nextDevPort(webDir)
  const values: Record<string, string> = { __SLUG__: slug, __NAME__: name, __NAME_LT__: nameLt, __NAME_RU__: nameRu, __DEV_PORT__: String(devPort) }
  cpSync(templateDir, dir, { recursive: true })
  for (const file of readdirSync(dir, { recursive: true, encoding: 'utf8' }).map((f) => join(dir, f))) {
    if (!statSync(file).isFile()) continue
    const escape = escapes[extname(file)] ?? ((s: string) => s)
    const text = readFileSync(file, 'utf8').replace(/__[A-Z_]+__/g, (key) => {
      const value = values[key]
      if (value === undefined) throw new Error(`${relative(templateDir, file)}: ${key} is not a placeholder make new-app knows`)
      return key === '__SLUG__' || key === '__DEV_PORT__' ? value : escape(value)
    })
    writeFileSync(file, text)
  }

  if (defaultsFile) {
    const tile =
      `\t{Slug: ${JSON.stringify(slug)}, Kind: KindApp, Group: "workwear", Icon: "box", Color: "#3b4256", Href: "/apps/${slug}/", Tier: TierHere, Stage: StagePOC,\n` +
      `\t\tNames: Names{${[name, nameLt, nameRu].map((n) => JSON.stringify(n)).join(', ')}}},\n`
    const at = defaults.lastIndexOf('\n', defaults.indexOf(marker)) + 1
    writeFileSync(defaultsFile, defaults.slice(0, at) + tile + defaults.slice(at))
  }
  return { dir, devPort, untranslated: nameLt === name || nameRu === name }
}

/** Starts an app from the template, typechecks, tests and builds it, and removes it. */
function check(webDir: string): void {
  const slug = 'new-app-check'
  const template = JSON.parse(readFileSync(join(webDir, 'templates', 'published-app', 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>
    devDependencies: Record<string, string>
  }
  const needs = Object.keys({ ...template.dependencies, ...template.devDependencies })
  // Any app whose installed packages are a superset of the template's.
  const donor = readdirSync(join(webDir, 'apps')).find((a) => needs.every((p) => existsSync(join(webDir, 'apps', a, 'node_modules', p))))
  if (!donor) throw new Error(`no app in apps/ has installed every package the template needs (${needs.join(', ')}): run pnpm install`)
  const started = newApp({ slug, name: 'New App Check', nameLt: 'Naujos programos patikra', nameRu: 'Проверка нового приложения' }, { webDir, defaultsFile: null })
  try {
    symlinkSync(join(webDir, 'apps', donor, 'node_modules'), join(started.dir, 'node_modules'), 'dir')
    for (const [bin, ...args] of [['tsc', '--noEmit'], ['vitest', 'run'], ['vite', 'build', '--logLevel', 'warn']] as const) {
      const run = spawnSync(join(started.dir, 'node_modules', '.bin', bin), args, { cwd: started.dir, stdio: 'inherit' })
      if (run.status !== 0) throw new Error(`the template's app fails ${bin} ${args.join(' ')}`)
    }
    const found = publishedApps(webDir).find((a) => a.slug === slug)
    if (found?.devPort !== started.devPort) throw new Error('the template\'s app is not found as a published app')
    if (!existsSync(join(started.dir, 'dist', 'ppe-app.json'))) throw new Error("the template's build has no ppe-app.json")
    console.log(`make new-app's template starts an app that typechecks, passes its tests and builds (dev port ${started.devPort}).`)
  } finally {
    rmSync(started.dir, { recursive: true, force: true })
  }
}

function main(argv: string[]): void {
  const webDir = fileURLToPath(new URL('../../..', import.meta.url))
  const arg = (flag: string) => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  if (argv.includes('--check')) return check(webDir)
  const slug = arg('--slug') ?? ''
  const name = arg('--name') ?? ''
  if (slug === '' || name === '') {
    console.error("usage: make new-app SLUG=<slug> NAME='<name in English>' [NAME_LT='…'] [NAME_RU='…']")
    process.exit(2)
  }
  const started = newApp({ slug, name, nameLt: arg('--name-lt'), nameRu: arg('--name-ru') }, { webDir })
  const repo = join(webDir, '..')
  console.log(`Started ${name} in ${relative(repo, started.dir)}: dev port ${started.devPort}, e2e ${started.devPort + 1}.`)
  console.log(`Its tile is in internal/domain/launcher/defaults.go, in POC (Testers only), at /apps/${slug}/: set its group, icon and colour there.`)
  if (started.untranslated) console.log('Its Lithuanian or Russian name is still English: translate it in src/i18n and defaults.go (its i18n test fails until then).')
  console.log(`Run it: pnpm --dir web/apps/${slug} dev, and open http://localhost:5180/apps/${slug}/ through the staff app's dev server.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2))
  } catch (e) {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  }
}
