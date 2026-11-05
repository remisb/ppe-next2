import { describe, expect, it } from 'vitest'

import { Steady } from './steady.ts'

const A = 'first reading'
const B = 'second reading'

describe('Steady', () => {
  it('takes a reading seen twice in a row', () => {
    const s = new Steady<string>()
    const id = (v: string) => v
    expect(s.see(A, id)).toBeNull()
    expect(s.see(B, id)).toBeNull()
    expect(s.see(B, id)).toBe(B)
    expect(s.see(null, id)).toBeNull()
    expect(s.see(B, id)).toBeNull()
  })
})
