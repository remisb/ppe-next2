/**
 * The published apps in this workspace (ADR 0006, phase 3): every
 * web/apps/<slug>/ with a public/ppe-app.json. The build, the deploy, the
 * staff app's dev proxy and the e2e servers all find them here, so a new
 * published app needs no edit outside its own folder (the handbook's
 * improvement 2). Node only: for vite.config.ts files, the e2e config and
 * tests, imported by path.
 *
 * The manifest's slug and profile (standard, or device for WebAssembly,
 * workers and the camera) go to the API with each build;
 * devPort is its Vite server's in development (the API ignores it), and its
 * e2e server takes the next port, as Administration (5182, 5183) and App
 * Launcher (5186, 5187) do.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export interface PublishedApp {
  slug: string
  /** Its folder: web/apps/<slug>. */
  dir: string
  profile: string
  devPort: number
  e2ePort: number
}

/**
 * The dev ports of the apps that are not published, declared here alone: the
 * Vite configs, the staff app's proxy defaults, the e2e servers (each on the
 * next port, as published apps' are), make new-app and .claude/launch.json
 * (a test compares it) read them. A published app's is its manifest's devPort.
 */
export const fixedApps = { workwear: 5180, admin: 5182, launcher: 5186 } as const

/** Every port the fixed apps use, in development and in e2e. */
export const fixedPorts = (): number[] => Object.values(fixedApps).flatMap((p) => [p, p + 1])

/** The manifest at web/apps/<slug>/public/ppe-app.json. */
interface Manifest {
  slug?: unknown
  profile?: unknown
  devPort?: unknown
}

/** Every published app under webDir/apps, by slug; a manifest that does not fit throws. */
export function publishedApps(webDir: string): PublishedApp[] {
  const apps = join(webDir, 'apps')
  const out: PublishedApp[] = []
  for (const slug of readdirSync(apps).sort()) {
    const file = join(apps, slug, 'public', 'ppe-app.json')
    if (!existsSync(file)) continue
    const m = JSON.parse(readFileSync(file, 'utf8')) as Manifest
    if (m.slug !== slug) throw new Error(`${file}: its slug must be its folder's name, ${slug}`)
    if (typeof m.profile !== 'string' || m.profile === '') throw new Error(`${file}: profile must name its policy, standard or device`)
    if (typeof m.devPort !== 'number' || !Number.isInteger(m.devPort) || m.devPort < 1024) {
      throw new Error(`${file}: devPort must be its dev server's port, such as 5184`)
    }
    out.push({ slug, dir: join(apps, slug), profile: m.profile, devPort: m.devPort, e2ePort: m.devPort + 1 })
  }
  const ports = [...fixedPorts(), ...out.flatMap((a) => [a.devPort, a.e2ePort])]
  if (new Set(ports).size !== ports.length) {
    throw new Error(`published apps share a port, with each other or the fixed apps (${fixedPorts().join(', ')}): ${out.map((a) => `${a.slug} ${a.devPort}`).join(', ')}`)
  }
  return out
}

/** The env variable that points the staff app's dev proxy for /apps/<slug> elsewhere: VITE_APP_SIM_SCAN_TARGET. */
export const targetEnv = (slug: string) => `VITE_APP_${slug.toUpperCase().replace(/-/g, '_')}_TARGET`
