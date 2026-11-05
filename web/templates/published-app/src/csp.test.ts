import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// A published app with the standard profile (ADR 0006) gets the staff app's
// policy, for its page (the API's) and its files (Caddy's
// /apps/files/standard/). Its inline scripts must be the staff app's, byte for
// byte, so the policy's hashes allow them. Another profile in
// public/ppe-app.json (device: WebAssembly, workers, the camera) needs that
// profile's policy tested instead, as Scan SIMs' csp.test.ts does.
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const indexHtml = read('../index.html')
const caddyfile = read('../../../../deploy/Caddyfile')
const staffIndexHtml = read('../../workwear/index.html')
const manifest = JSON.parse(read('../public/ppe-app.json')) as { profile: string }

const staffPolicy = /header @staffpolicy Content-Security-Policy "([^"]+)"/.exec(caddyfile)?.[1] ?? ''
const scriptSrc = staffPolicy.split(';').map((d) => d.trim().split(/\s+/)).find(([n]) => n === 'script-src') ?? []

const inlineScripts = (html: string) => [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!)
const hash = (s: string) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`

describe('Content-Security-Policy', () => {
  it('is the standard profile', () => {
    expect(manifest.profile).toBe('standard')
    expect(staffPolicy).not.toBe('')
  })

  it("runs the staff app's inline scripts, byte for byte, allowed by their hashes", () => {
    expect(inlineScripts(indexHtml)).toEqual(inlineScripts(staffIndexHtml))
    for (const s of inlineScripts(indexHtml)) expect(scriptSrc).toContain(hash(s))
  })
})
