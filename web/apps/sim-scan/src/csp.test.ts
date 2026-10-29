import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// Caddy (deploy/Caddyfile) sends Scan SIMs its own Content-Security-Policy:
// the staff app's, word for word, plus what its readers need, WebAssembly and
// a worker from its own files (ADR 0005). Nothing else may differ.
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const indexHtml = read('../index.html')
const caddyfile = read('../../../../deploy/Caddyfile')
const staffIndexHtml = read('../../workwear/index.html')

const staffPolicy = /header @notsimscan Content-Security-Policy "([^"]+)"/.exec(caddyfile)?.[1] ?? ''
const policy = /header @simscan \{\s*Content-Security-Policy "([^"]+)"/.exec(caddyfile)?.[1] ?? ''
const directives = (p: string) => new Map(p.split(';').map((d) => d.trim().split(/\s+/)).map(([n, ...v]) => [n!, v]))

const inlineScripts = (html: string) => [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!)
const hash = (s: string) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`

describe('Content-Security-Policy', () => {
  it("is the staff app's first policy in the Caddyfile, which its csp.test.ts reads", () => {
    expect(staffPolicy).not.toBe('')
    expect(/Content-Security-Policy "([^"]+)"/.exec(caddyfile)?.[1]).toBe(staffPolicy)
  })

  it("is the staff app's, with WebAssembly and its own worker added, and nothing else", () => {
    const mine = directives(policy)
    const staff = directives(staffPolicy)
    expect(mine.get('script-src')).toEqual([...staff.get('script-src')!.slice(0, 1), "'wasm-unsafe-eval'", ...staff.get('script-src')!.slice(1)])
    expect(mine.get('worker-src')).toEqual(["'self'"])
    mine.delete('script-src')
    mine.delete('worker-src')
    staff.delete('script-src')
    expect(mine).toEqual(staff)
    expect(staffPolicy).not.toContain('wasm-unsafe-eval')
  })

  it("runs the staff app's inline scripts, byte for byte, allowed by their hashes", () => {
    expect(inlineScripts(indexHtml)).toEqual(inlineScripts(staffIndexHtml))
    for (const s of inlineScripts(indexHtml)) expect(directives(policy).get('script-src')).toContain(hash(s))
  })
})
