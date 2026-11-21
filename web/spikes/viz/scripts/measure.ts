/**
 * Reads every side of the test set (scripts/pages.ts) with tesseract.js, its MRZ lines left out,
 * for each language set, takes the printed fields with src/viz.ts at several confidence
 * bars, and counts, per field: taken and right, taken and wrong (the number that must be
 * 0), offered to check (right or wrong), and missed. Node's tesseract.js is the same
 * engine the browser runs (WebAssembly), so the counts hold there; the times are this
 * machine's, for comparing language sets, not a phone's.
 *
 *   node --experimental-strip-types scripts/measure.ts [--langs=eng,lit+eng,lit+eng+rus] [--pages=.pages] [--workers=4]
 *
 * --pages=.private reads the team's own documents the same way (an index.json of the same
 * shape, kept out of git); only counts are printed, never a value.
 */
import { readFileSync } from 'node:fs'
import { cpus, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseMrz } from '@ppe/mrz'
import { createScheduler, createWorker, OEM } from 'tesseract.js'

import { readViz, type MrzFacts, type OcrLine, type Taken } from '../src/viz.ts'
import type { PageEntry } from './pages.ts'

const arg = (name: string, fallback: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const langSets = arg('langs', 'eng,lit+eng,lit+eng+rus').split(',')
const dir = fileURLToPath(new URL(`../${arg('pages', '.pages')}/`, import.meta.url))
const workers = Number(arg('workers', String(Math.max(2, Math.min(6, cpus().length - 2)))))
const models = fileURLToPath(new URL('../.models', import.meta.url))
const bars = (process.argv.find((a) => a.startsWith('--bars='))?.slice(7) ?? '0,85,90,95').split(',').map(Number)

const { entries } = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as { entries: PageEntry[] }

function factsOf(e: PageEntry): MrzFacts {
  const mrz = parseMrz(e.mrz, { today: '2026-11-21' })
  if (!mrz) throw new Error(`${e.file}: the MRZ does not parse`)
  const field = e.mrz.length === 2 ? e.mrz[0]!.slice(5) : e.mrz[2]!
  const facts: MrzFacts = { surname: mrz.surname, givenNames: mrz.givenNames, namesFull: !field.endsWith('<') }
  if (mrz.birthDate) facts.birth = mrz.birthDate
  if (mrz.expiryDate) facts.expiry = mrz.expiryDate
  return facts
}

const norm = (s: string) => s.toLocaleUpperCase('lt').replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim()

type Field = 'surname' | 'givenNames' | 'issued' | 'placeOfBirth' | 'authority'
const FIELDS: Field[] = ['surname', 'givenNames', 'issued', 'placeOfBirth', 'authority']
interface Tally {
  takenRight: number
  takenWrong: number
  checkRight: number
  checkWrong: number
  missed: number
  total: number
}
const empty = (): Tally => ({ takenRight: 0, takenWrong: 0, checkRight: 0, checkWrong: 0, missed: 0, total: 0 })

function count(t: Tally, truth: string, got: Taken | undefined) {
  t.total++
  if (!got) return void t.missed++
  const right = norm(got.value) === norm(truth)
  if (got.source === 'check') right ? t.checkRight++ : t.checkWrong++
  else right ? t.takenRight++ : t.takenWrong++
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : '—')

for (const langs of langSets) {
  const scheduler = createScheduler()
  for (let i = 0; i < workers; i++) {
    scheduler.addWorker(await createWorker(langs.split('+'), OEM.LSTM_ONLY, { langPath: models, cachePath: join(tmpdir(), 'ppe-viz-spike'), gzip: true }))
  }
  const started = Date.now()
  const read = await Promise.all(
    entries.map(async (e) => {
      // The whole side: tesseract.js's `rectangle` read these pages as noise (the app crops its own canvas).
      const { data } = await scheduler.addJob('recognize', join(dir, e.file), {}, { blocks: true })
      const all: OcrLine[] = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.map((l) => ({ words: l.words.map((w) => ({ text: w.text, conf: w.confidence, symbols: w.symbols.map((y) => ({ text: y.text, conf: y.confidence })) })) }))))
      // The MRZ's lines are the MRZ reader's, not this one's.
      const lines = all.filter((l) => !l.words.some((w) => w.text.includes('<<')))
      return { e, lines }
    }),
  )
  await scheduler.terminate()
  const wall = Date.now() - started
  // Jobs wait in the scheduler's queue, so a side's own time is the wall time shared out.
  console.log(`\n## ${langs}: ${entries.length} sides, ${((wall * workers) / entries.length / 1000).toFixed(2)} s a side on this machine (${workers} workers, ${(wall / 1000).toFixed(0)} s in all)`)
  for (const bar of bars) {
    const tallies = Object.fromEntries(FIELDS.map((f) => [f, empty()])) as Record<Field, Tally>
    const wrongs: string[] = []
    for (const { e, lines } of read) {
      const got = readViz(lines, factsOf(e), { minConf: bar })
      for (const f of FIELDS) {
        const truth = e.truth[f]
        if (truth === undefined) continue
        count(tallies[f], truth, got[f])
        const g = got[f]
        if (g && g.source !== 'check' && norm(g.value) !== norm(truth) && dir.endsWith('.pages/')) wrongs.push(`${e.file} ${f}: ${g.value} ≠ ${truth}`)
        if (!g && f === 'surname' && bar === bars[0] && process.argv.includes('--missed')) console.log(`missed ${e.file} trouble ${JSON.stringify(e.trouble)}`)
      }
    }
    console.log(`\n### confidence bar ${bar}\n`)
    console.log('| Field | Taken, right | Taken, WRONG | To check, right | To check, wrong | Missed |')
    console.log('| --- | --- | --- | --- | --- | --- |')
    for (const f of FIELDS) {
      const t = tallies[f]
      console.log(`| ${f} (${t.total}) | ${pct(t.takenRight, t.total)} | ${t.takenWrong} | ${pct(t.checkRight, t.total)} | ${t.checkWrong} | ${pct(t.missed, t.total)} |`)
    }
    if (wrongs.length) console.log(`\nTaken wrong (specimens only):\n${wrongs.slice(0, 12).map((w) => `- ${w}`).join('\n')}`)
  }
}
