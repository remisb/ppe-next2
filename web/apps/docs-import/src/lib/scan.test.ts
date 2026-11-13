import { parseMrz } from '@ppe/mrz'
import type { PhotoReading } from '@ppe/mrz/reader'

import {
  archiveName,
  detailsAgreed,
  detailsOf,
  emptyBatch,
  MAX_PAGES,
  readPageOf,
  scanBatch,
  scanBlockers,
  type ScanAction,
  type ScanBatch,
} from './scan'

const today = '2026-11-05'
// testdata/mrz/vectors.json's made-up Lithuanian passport.
const passport = parseMrz(['P<LTUPAVYZDYS<<JONAS<<<<<<<<<<<<<<<<<<<<<<<<', '91234567<9LTU3309243M310515733309240064<<<42'], { today })!

const reading = (agreed: boolean): PhotoReading => ({ found: true, agreed, mrz: passport })
const corners = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 7 },
  { x: 0, y: 7 },
] as const

const done = (source: string, page: string, r?: PhotoReading): ScanAction => ({
  type: 'done',
  source,
  page,
  turn: 0,
  corners: [...corners] as never,
  size: { width: 10, height: 7 },
  confidence: 0.9,
  ...(r ? { reading: r } : {}),
})

const run = (...actions: ScanAction[]) => actions.reduce<ScanBatch>(scanBatch, emptyBatch)

describe('scanBatch', () => {
  it('adds photos as pages being made, up to MAX_PAGES; the rest are let go', () => {
    const sources = Array.from({ length: MAX_PAGES + 2 }, (_, i) => `s${i}`)
    const s = run({ type: 'add', sources })
    expect(s.pages).toHaveLength(MAX_PAGES)
    expect(s.pages.every((p) => p.status === 'working')).toBe(true)
    expect(s.notice).toBe('too_many')
    expect(s.released).toEqual(['s10', 's11'])
  })

  it('takes a made page, and lets the earlier one go when it is made again', () => {
    const s = run({ type: 'add', sources: ['a'] }, done('a', 'p1'), { type: 'working', source: 'a', turn: 90 }, done('a', 'p2'))
    expect(s.pages[0]).toMatchObject({ source: 'a', page: 'p2', status: 'done' })
    expect(s.released).toEqual(['p1'])
  })

  it('lets a page made after its removal go at once', () => {
    const s = run({ type: 'add', sources: ['a'] }, { type: 'remove', source: 'a' }, done('a', 'p1'))
    expect(s.pages).toEqual([])
    expect(s.released).toEqual(['a', 'p1'])
  })

  it('clears every picture, and forgets what the screen has let go', () => {
    const s = run({ type: 'add', sources: ['a', 'b'] }, done('a', 'p1'), { type: 'clear' })
    expect(s.pages).toEqual([])
    expect(s.released).toEqual(['a', 'p1', 'b'])
    expect(scanBatch(s, { type: 'released', ids: ['a', 'b'] }).released).toEqual(['p1'])
  })
})

describe('details', () => {
  it('names the document from the agreed reading, the user’s typing over it', () => {
    const s = run({ type: 'add', sources: ['a', 'b'] }, done('a', 'p1', reading(false)), done('b', 'p2', reading(true)))
    expect(readPageOf(s.pages)?.source).toBe('b')
    expect(detailsAgreed(s.pages)).toBe(true)
    expect(detailsOf(s)).toEqual({ surname: 'Pavyzdys', givenNames: 'Jonas', kind: 'passport', number: '91234567' })
    const typed = scanBatch(s, { type: 'typed', details: { surname: 'Pavyzdė' } })
    expect(detailsOf(typed).surname).toBe('Pavyzdė')
  })

  it('names the archive after the person and the kind, as the API does', () => {
    expect(archiveName({ surname: 'Žukauskaitė', givenNames: ' Ona  Marija ', kind: 'id_card', number: '' })).toBe('Žukauskaitė_Ona_Marija_id-card.zip')
    expect(archiveName({ surname: "O'Neil-Smith", givenNames: 'Ann_Lee', kind: 'residence_permit', number: '' })).toBe('ONeil-Smith_Ann_Lee_residence-permit.zip')
    expect(archiveName({ surname: 'Pavyzdys', givenNames: '', kind: 'passport', number: '' })).toBe('Pavyzdys_passport.zip')
  })
})

describe('scanBlockers', () => {
  it('waits for a page, for every page to be made, and for a surname', () => {
    expect(scanBlockers(emptyBatch)).toEqual(['no_pages'])
    const working = run({ type: 'add', sources: ['a', 'b'] }, done('a', 'p1'))
    expect(scanBlockers(working)).toEqual(['working', 'surname'])
    const ready = run({ type: 'add', sources: ['a'] }, done('a', 'p1', reading(true)))
    expect(scanBlockers(ready)).toEqual([])
  })
})
