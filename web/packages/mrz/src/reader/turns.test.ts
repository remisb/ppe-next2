import { describe, expect, it } from 'vitest'

import { firstTurn, type Turn } from './turns.ts'

describe('firstTurn', () => {
  const run = async (results: Partial<Record<Turn, 'good' | 'usable'>>) => {
    const tried: Turn[] = []
    const r = await firstTurn(
      async (turn) => {
        tried.push(turn)
        return results[turn]
      },
      (r) => r === 'good',
      (r) => r === 'usable',
    )
    return { tried, r }
  }

  it('reads the photo as it is first and stops there when it reads', async () => {
    const { tried, r } = await run({ 0: 'good', 90: 'good' })
    expect(tried).toEqual([0])
    expect(r).toEqual({ turn: 0, result: 'good' })
  })

  it('tries upside down before sideways', async () => {
    const { tried, r } = await run({ 180: 'good', 90: 'good' })
    expect(tried).toEqual([0, 180])
    expect(r?.turn).toBe(180)
  })

  it('takes a valid reading on a side over a band found earlier', async () => {
    const { tried, r } = await run({ 0: 'usable', 270: 'good' })
    expect(tried).toEqual([0, 180, 90, 270])
    expect(r?.turn).toBe(270)
  })

  it('falls back to the first turn a band was found at, else nothing', async () => {
    expect((await run({ 90: 'usable', 270: 'usable' })).r).toEqual({ turn: 90, result: 'usable' })
    expect((await run({})).r).toBeUndefined()
  })
})
