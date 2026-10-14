import { describe, expect, it } from 'vitest'

import { loadOpen, saveOpen } from './remembered-open.ts'

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  }
}

describe('remembered open sections', () => {
  it('starts as the section does, then as it was left, per key', () => {
    const storage = memoryStorage()
    expect(loadOpen('open.u1.items', false, storage)).toBe(false)
    saveOpen('open.u1.items', true, storage)
    expect(loadOpen('open.u1.items', false, storage)).toBe(true)
    expect(loadOpen('open.u2.items', false, storage)).toBe(false)
    saveOpen('open.u1.items', false, storage)
    expect(loadOpen('open.u1.items', true, storage)).toBe(false)
  })

  it('ignores a value it does not know, and storage that throws', () => {
    const storage = memoryStorage()
    storage.setItem('open.u1.items', 'yes')
    expect(loadOpen('open.u1.items', false, storage)).toBe(false)
    const broken = { ...memoryStorage(), getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(loadOpen('open.u1.items', true, broken)).toBe(true)
    expect(() => saveOpen('open.u1.items', true, broken)).not.toThrow()
  })
})
