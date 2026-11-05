/**
 * Phase 1's measurements (docs-import plan, NFR-4 and NFR-5): every model in
 * .models/ over every photo and live frame in .photos/ (scripts/photos.ts),
 * in Chromium and WebKit (Playwright's, on this machine). chromium-x4 adds
 * DevTools' 4× CPU slowdown, which is no stand-in for a phone: it slows only
 * the page's main thread, and the image work and the OCR run in workers
 * (measured: 140 ms of OCR became 143). Each model is
 * loaded in a fresh page with no cache, so the first use's download is what
 * the readers fetched. Writes .results/<browser>-<model>.json and prints a
 * table. Nothing read is printed: counts, times and sizes only.
 *
 *   node --experimental-strip-types scripts/measure.ts [models…] [--browsers=chromium,webkit] [--second]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { chromium, webkit, type Browser, type Page } from '@playwright/test'
import { createServer } from 'vite'

import type { Summary } from '../src/main.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}`))
const browsers = (flag('browsers')?.split('=')[1] ?? 'chromium,webkit').split(',')
const second = !!flag('second')
const allModels = ['eng', 'mrz', 'ocrb', 'ppe_ocrb'].filter((m) => existsSync(`${root}.models/${m}.traineddata.gz`))
const models = args.filter((a) => !a.startsWith('--')).length ? args.filter((a) => !a.startsWith('--')) : allModels

interface Photo {
  file: string
  doc: string
  side: string
  truth: string[]
  outcome: 'read' | 'rejected' | 'none'
}
interface Live {
  file: string
  doc: string
  truth: string[]
  outcome: 'read' | 'rejected'
  strip: { x: number; y: number; w: number; h: number }
}
const index = JSON.parse(readFileSync(`${root}.photos/index.json`, 'utf8')) as { photos: Photo[]; live: Live[] }

const server = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error', server: { port: 5189, hmr: false, watch: null } })
// No reloads while measuring: an edit elsewhere in the tree must not reload the page mid-run.
await server.listen()
const base = 'http://localhost:5189/'
mkdirSync(`${root}.results`, { recursive: true })

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)} %` : '–')
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))]!) : NaN
}

const rows: string[] = []
for (const name of browsers) {
  const engine = name.startsWith('webkit') ? webkit : chromium
  const browser: Browser = await engine.launch()
  for (const model of models) {
    const context = await browser.newContext()
    const page: Page = await context.newPage()
    // What the readers cost the first time: every byte fetched from /readers/.
    const fetched = new Map<string, number>()
    page.on('response', async (r) => {
      const u = new URL(r.url())
      if (u.pathname.startsWith('/readers/')) fetched.set(u.pathname.slice(9), (await r.body().catch(() => Buffer.alloc(0))).length)
    })
    await page.goto(base)
    await page.waitForFunction(() => window.spike?.ready)
    if (name.endsWith('-x4')) {
      const cdp = await context.newCDPSession(page)
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    }
    const load = await page.evaluate((m) => window.spike.load(m), model)
    const results: (Summary & { file: string; outcome: string; right: boolean })[] = []
    for (const p of index.photos) {
      const s = await page.evaluate(([f, sec]) => window.spike.readUrl(`/photos/${f}`, sec as boolean), [p.file, second] as const)
      results.push({ ...s, file: p.file, outcome: p.outcome, right: s.valid && s.lines?.join('\n') === p.truth.join('\n') })
    }
    const lives: (Summary & { file: string; outcome: string; right: boolean })[] = []
    for (const l of index.live) {
      const s = await page.evaluate(([f, strip]) => window.spike.readLive(`/photos/${f}`, strip as Live['strip']), [l.file, l.strip] as const)
      lives.push({ ...s, file: l.file, outcome: l.outcome, right: s.valid && s.lines?.join('\n') === l.truth.join('\n') })
    }
    await context.close()

    const good = results.filter((r) => r.outcome === 'read')
    const read = good.filter((r) => r.right)
    const wrong = results.filter((r) => r.valid && !r.right)
    // With FR-5's rule: a reading a look-alike search chose is accepted only when a second read agrees.
    const wrongAfterRule = wrong.filter((r) => !r.needsSecondRead || (r.second?.same ?? false))
    const planted = results.filter((r) => r.outcome === 'rejected')
    const fronts = results.filter((r) => r.outcome === 'none')
    const found = good.filter((r) => r.found)
    const liveGood = lives.filter((r) => r.outcome === 'read')
    // The policies: a photo accepted once valid; once valid and, if flagged, confirmed by a second read;
    // only when two reads agree. Live: Steady, two consecutive frames of a document giving the same lines.
    const policy = (accept: (r: (typeof results)[number]) => boolean) => ({
      read: good.filter((r) => accept(r) && r.right).length,
      wrong: results.filter((r) => accept(r) && !r.right).length,
    })
    const truthOf = new Map(index.live.map((l) => [l.file, l.truth.join('\n')]))
    const pairs = lives.slice(1).flatMap((b, i) => {
      const a = lives[i]!
      const doc = (f: string) => f.replace(/-\d+\.jpg$/, '')
      return doc(a.file) === doc(b.file) ? [[a, b] as const] : []
    })
    const steady = pairs.filter(([a, b]) => a.valid && b.valid && a.lines!.join('\n') === b.lines!.join('\n'))
    const summary = {
      browser: name,
      model,
      loadMs: Math.round(load.ms),
      download: Object.fromEntries(fetched),
      downloadBytes: [...fetched.values()].reduce((a, b) => a + b, 0),
      photos: {
        good: good.length,
        bandFound: found.length,
        read: read.length,
        wrong: wrong.length,
        wrongAfterSecondReadRule: second ? wrongAfterRule.length : null,
        policies: second
          ? {
              once: policy((r) => r.valid),
              flaggedConfirmed: policy((r) => r.valid && (!r.needsSecondRead || !!r.second?.same)),
              twice: policy((r) => r.valid && !!r.second?.same),
            }
          : null,
        msTwiceMedian: quantile(results.map((r) => (r.times['total'] ?? 0) + (r.times['second'] ?? 0)), 0.5),
        plantedRefused: planted.filter((r) => !r.valid).length,
        planted: planted.length,
        frontsWithoutMrz: fronts.filter((r) => !r.valid).length,
        fronts: fronts.length,
        corrected: read.filter((r) => r.corrections.length > 0).length,
        fitted: read.filter((r) => r.fitted).length,
        msMedian: quantile(results.map((r) => r.times['total'] ?? 0), 0.5),
        ms90: quantile(results.map((r) => r.times['total'] ?? 0), 0.9),
        imageMsMedian: quantile(results.map((r) => r.times['image'] ?? 0), 0.5),
        ocrMsMedian: quantile(results.filter((r) => r.found).map((r) => r.times['ocr'] ?? 0), 0.5),
        failures: good.filter((r) => !r.right).map((r) => ({ file: r.file, found: r.found, problems: r.problems })),
      },
      live: {
        frames: liveGood.length,
        read: liveGood.filter((r) => r.right).length,
        wrong: lives.filter((r) => r.valid && !r.right).length,
        msMedian: quantile(lives.map((r) => r.times['total'] ?? 0), 0.5),
        ms90: quantile(lives.map((r) => r.times['total'] ?? 0), 0.9),
        steadyPairs: pairs.filter(([a]) => a.outcome === 'read').length,
        steadyRead: steady.filter(([a]) => a.lines!.join('\n') === truthOf.get(a.file)).length,
        steadyWrong: steady.filter(([a]) => a.lines!.join('\n') !== truthOf.get(a.file)).length,
      },
    }
    writeFileSync(`${root}.results/${name}-${model}.json`, JSON.stringify({ summary, results, lives }, null, 1))
    const s = summary.photos
    rows.push(
      `| ${name} | ${model} | ${s.read}/${s.good} (${pct(s.read, s.good)})${s.policies ? `; twice ${s.policies.twice.read} (${pct(s.policies.twice.read, s.good)})` : ''} | ${s.wrong}${s.policies ? `; flagged confirmed ${s.policies.flaggedConfirmed.wrong}; twice ${s.policies.twice.wrong}` : ''} | ${s.plantedRefused}/${s.planted} | ${s.frontsWithoutMrz}/${s.fronts} | ${s.msMedian} / ${s.ms90} | ${s.imageMsMedian} + ${s.ocrMsMedian} | ${summary.live.read}/${summary.live.frames}, wrong ${summary.live.wrong}; Steady ${summary.live.steadyRead}/${summary.live.steadyPairs}, wrong ${summary.live.steadyWrong} | ${summary.live.msMedian} / ${summary.live.ms90} | ${(summary.downloadBytes / 1e6).toFixed(2)} MB | ${summary.loadMs} |`,
    )
    console.log(rows.at(-1))
  }
  await browser.close()
}
await server.close()
console.log(
  [
    '| Browser | Model | Photos read, every check passing | Wrong accepted (one read; flagged confirmed; twice) | Planted errors refused | Fronts: no MRZ | ms a photo, median / 90th | image + OCR, median ms | Live frames read (single; Steady pairs) | ms a live attempt, median / 90th | First-use download | Load ms |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n'),
)
