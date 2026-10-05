import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// The Content-Security-Policy Caddy sends (deploy/Caddyfile) allows index.html's
// inline scripts by their hashes. Editing one, even its whitespace, changes the
// hash and the browser then refuses to run it: this test names the new hash.
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const indexHtml = read('../index.html')
const caddyfile = read('../../../../deploy/Caddyfile')

const policy = /Content-Security-Policy "([^"]+)"/.exec(caddyfile)?.[1] ?? ''
const directive = (name: string) =>
  policy
    .split(';')
    .map((d) => d.trim().split(/\s+/))
    .find(([n]) => n === name)
    ?.slice(1) ?? []

const inlineScripts = [...indexHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!)
const hash = (s: string) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`

describe('Content-Security-Policy', () => {
  it('is sent by Caddy', () => {
    expect(policy).not.toBe('')
    expect(directive('default-src')).toEqual(["'self'"])
  })

  it("allows each of index.html's inline scripts by its hash", () => {
    expect(inlineScripts.length).toBeGreaterThan(0)
    for (const s of inlineScripts) expect(directive('script-src')).toContain(hash(s))
  })

  it('allows no other inline script, eval or outside host', () => {
    const scripts = directive('script-src')
    expect(scripts).not.toContain("'unsafe-inline'")
    expect(scripts).not.toContain("'unsafe-eval'")
    expect(scripts.filter((s) => !s.startsWith("'sha256-"))).toEqual(["'self'"])
    expect(directive('connect-src')).toEqual(["'self'"])
    expect(directive('frame-ancestors')).toEqual(["'none'"])
  })
})
