import { MAX_CARDS, type ScanCard } from '@ppe/sim-scan'
import { describe, expect, it } from 'vitest'

import { type ScanList, type ScanListAction, emptyScanList, marksOf, scanList } from './scan-list'

// Made-up SIM numbers whose check digits check; none is a real card.
const A = '8937099000000000015'
const B = '8937099000000000023'

const card = (key: string, simNo = '', pictures: { front?: string; back?: string } = { front: `${key}f`, back: `${key}b` }): ScanCard => ({
  key,
  simNo,
  pin: '',
  puk: '',
  ...pictures,
})
const run = (...actions: ScanListAction[]): ScanList => actions.reduce(scanList, emptyScanList)
const keys = (s: ScanList) => s.cards.map((c) => c.key)

describe('the scan list', () => {
  it('adds cards in order and clears a notice once one fits', () => {
    const s = run({ type: 'too_many' }, { type: 'add', cards: [card('a', A), card('b', B)] })
    expect(keys(s)).toEqual(['a', 'b'])
    expect(s.notice).toBeNull()
    expect(s.released).toEqual([])
  })

  it('keeps what fits in a batch, lets the rest’s pictures go and says so', () => {
    const full = Array.from({ length: MAX_CARDS - 1 }, (_, i) => card(`c${i}`))
    const s = run({ type: 'add', cards: full }, { type: 'add', cards: [card('x'), card('y'), card('z', '', { front: 'zf' })] })
    expect(s.cards).toHaveLength(MAX_CARDS)
    expect(s.cards.at(-1)!.key).toBe('x')
    expect(s.released).toEqual(['yf', 'yb', 'zf'])
    expect(s.notice).toBe('too_many')
  })

  it('says so when photos were left unread, though every card read fits', () => {
    expect(run({ type: 'add', cards: [card('a')], more: true }).notice).toBe('too_many')
  })

  it('a full list takes no card from the camera, and lets its pictures go', () => {
    const full = run({ type: 'add', cards: Array.from({ length: MAX_CARDS }, (_, i) => card(`c${i}`)) })
    const s = scanList(full, { type: 'add', cards: [card('late')] })
    expect(s.cards).toBe(full.cards)
    expect(s.released).toEqual(['latef', 'lateb'])
    expect(s.notice).toBe('too_many')
  })

  it('removes a row with its pictures; an index that is gone changes nothing', () => {
    const two = run({ type: 'add', cards: [card('a', A), card('b', B)] })
    const s = scanList(two, { type: 'remove', index: 0 })
    expect(keys(s)).toEqual(['b'])
    expect(s.released).toEqual(['af', 'ab'])
    expect(scanList(two, { type: 'remove', index: 5 })).toBe(two)
  })

  it('clears the list, its registered cards and the notice, letting every picture go', () => {
    const s = run(
      { type: 'add', cards: [card('a', A)], more: true },
      { type: 'checked', sent: [{ sim_no: A, pin: '', puk: '' }], problems: [{ index: 0, field: 'sim_no', code: 'registered', existing_id: 'id-a' }] },
      { type: 'clear' },
    )
    expect(s.cards).toEqual([])
    expect(s.registered.size).toBe(0)
    expect(s.notice).toBeNull()
    expect(s.released).toEqual(['af', 'ab'])
  })

  it('forgets released pictures once the screen let them go, keeping any released since', () => {
    const s = run({ type: 'add', cards: [card('a'), card('b')] }, { type: 'remove', index: 0 }, { type: 'remove', index: 0 })
    expect(scanList(s, { type: 'released', ids: ['af', 'ab'] }).released).toEqual(['bf', 'bb'])
  })

  it('marks a registered card by its SIM No., wherever its row is now', () => {
    const s = run(
      { type: 'add', cards: [card('b', B), card('a', A)] },
      { type: 'checked', sent: [B, A].map((sim_no) => ({ sim_no, pin: '', puk: '' })), problems: [{ index: 1, field: 'sim_no', code: 'registered', existing_id: 'id-a' }] },
      { type: 'remove', index: 0 },
    )
    expect(marksOf(s)[0]).toContainEqual({ field: 'sim_no', code: 'registered', existingId: 'id-a' })
    // No check applies any more (or it failed): nothing is marked registered.
    expect(marksOf(scanList(s, { type: 'unchecked' }))[0]!.map((m) => m.code)).not.toContain('registered')
  })
})
