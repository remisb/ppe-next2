/**
 * The bare reading page (docs-import plan, phase 1): a photo, or the whole
 * specimen set (scripts/photos.ts), read with the chosen model, and the
 * figures phase 1 asks for. scripts/measure.ts drives it through
 * window.spike; on a phone, Run the specimen photos does the same by hand.
 *
 * A photo the user chooses is shown as counts and checks only: its lines
 * stay hidden unless asked for, and nothing is kept.
 */
import { todayUTC } from '@ppe/mrz'

import { MODELS, MRZ_CHARACTERS } from './models.ts'
import { createTextReader, PSM, type TextReader } from './ocr.ts'
import { canvasOf, readCanvas, readPhoto, type Reading } from './reader.ts'

const base = `${import.meta.env.BASE_URL}readers/`
const today = todayUTC()

let reader: { lang: string; r: TextReader } | undefined

async function load(lang: string): Promise<{ ms: number }> {
  if (reader?.lang === lang) return { ms: 0 }
  await reader?.r.stop()
  reader = undefined
  const t0 = performance.now()
  const r = await createTextReader({ lang, base, whitelist: MRZ_CHARACTERS, psm: PSM.SINGLE_BLOCK })
  reader = { lang, r }
  return { ms: performance.now() - t0 }
}

/** What a reading says, without the pictures: what measure.ts and the table need. */
function summary(r: Reading) {
  return {
    found: r.found,
    valid: !!r.mrz?.valid,
    lines: r.mrz?.lines ?? null,
    text: r.text ?? null,
    fitted: !!r.fitted,
    needsSecondRead: !!r.mrz?.needsSecondRead,
    corrections: r.mrz?.corrections ?? [],
    problems: (r.mrz?.problems ?? []).map((p) => `${p.code}${p.field ? `:${p.field}` : ''}`),
    second: r.second ?? null,
    times: r.times,
  }
}
export type Summary = ReturnType<typeof summary>

async function readUrl(url: string, second = false) {
  const blob = await (await fetch(url, { cache: 'no-store' })).blob()
  return summary(await readPhoto(blob, reader!.r, { today, second }))
}

/**
 * A live-sized attempt: a 1280-pixel frame, of which only the guide's strip
 * where the MRZ is expected (its bottom part) is read.
 */
async function readLive(url: string, strip: { x: number; y: number; w: number; h: number }) {
  const blob = await (await fetch(url, { cache: 'no-store' })).blob()
  const bitmap = await createImageBitmap(blob)
  const t0 = performance.now()
  const canvas = canvasOf(bitmap, 1280, strip)
  bitmap.close()
  const r = await readCanvas(canvas, reader!.r, { today })
  r.times['total'] = performance.now() - t0
  return summary(r)
}

declare global {
  interface Window {
    spike: {
      models: typeof MODELS
      load: typeof load
      readUrl: typeof readUrl
      readLive: typeof readLive
      ready: boolean
    }
  }
}
window.spike = { models: MODELS, load, readUrl, readLive, ready: true }

// The page by hand.
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const select = $<HTMLSelectElement>('model')
for (const m of MODELS) select.add(new Option(`${m.label}${m.shippable ? '' : ' (not shippable)'}`, m.lang))
const status = $('status')
const out = $('out')

$<HTMLInputElement>('file').addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  status.textContent = 'Reading…'
  await load(select.value)
  const r = await readPhoto(file, reader!.r, { today, second: $<HTMLInputElement>('second').checked })
  const s = summary(r)
  out.replaceChildren()
  const p = document.createElement('p')
  p.innerHTML = `<b class="${s.valid ? 'ok' : 'bad'}">${s.valid ? 'Every check digit passes' : s.found ? 'Not accepted' : 'No MRZ found'}</b>
    · ${r.mrz?.format ?? ''} · corrections ${s.corrections.length} · problems ${s.problems.join(', ') || 'none'}
    · ${Math.round(s.times['total'] ?? 0)} ms (image ${Math.round(s.times['image'] ?? 0)}, OCR ${Math.round(s.times['ocr'] ?? 0)})`
  out.append(p)
  if (r.band) out.append(r.band)
  const show = document.createElement('button')
  show.textContent = 'Show the lines read'
  show.onclick = () => {
    const pre = document.createElement('pre')
    pre.textContent = (s.lines ?? [s.text ?? '']).join('\n')
    show.replaceWith(pre)
  }
  out.append(document.createElement('br'), show)
  status.textContent = ''
})

$('run').addEventListener('click', async () => {
  const index = (await (await fetch(`${import.meta.env.BASE_URL}photos/index.json`, { cache: 'no-store' })).json()) as {
    photos: { file: string; truth: string[]; outcome: 'read' | 'rejected' }[]
  }
  status.textContent = 'Loading the model…'
  const { ms } = await load(select.value)
  let read = 0
  let wrong = 0
  let rejectedRight = 0
  const times: number[] = []
  for (const [i, p] of index.photos.entries()) {
    status.textContent = `${i + 1} / ${index.photos.length}`
    const s = await readUrl(`${import.meta.env.BASE_URL}photos/${p.file}`)
    times.push(s.times['total'] ?? 0)
    const right = s.valid && s.lines?.join('\n') === p.truth.join('\n')
    if (s.valid && !right) wrong++
    else if (p.outcome === 'read' && right) read++
    else if (p.outcome === 'rejected' && !s.valid) rejectedRight++
  }
  const good = index.photos.filter((p) => p.outcome === 'read').length
  times.sort((a, b) => a - b)
  status.textContent = ''
  out.innerHTML = `<table><tr><th>Model</th><td>${select.value}</td></tr>
    <tr><th>Loaded in</th><td>${Math.round(ms)} ms</td></tr>
    <tr><th>Read, every check passing</th><td>${read} / ${good} (${((100 * read) / good).toFixed(1)} %)</td></tr>
    <tr><th>Wrong values accepted</th><td class="${wrong ? 'bad' : 'ok'}">${wrong}</td></tr>
    <tr><th>Planted errors refused</th><td>${rejectedRight} / ${index.photos.length - good}</td></tr>
    <tr><th>Time a photo, median / 90th</th><td>${Math.round(times[Math.floor(times.length / 2)]!)} / ${Math.round(times[Math.floor(times.length * 0.9)]!)} ms</td></tr>
    <tr><th>Browser</th><td>${navigator.userAgent}</td></tr></table>`
})
