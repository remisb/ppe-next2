import { describe, expect, it } from 'vitest'

import { PictureStore } from './picture-store'

/** Blob URLs as the browser would make them, with the ones revoked counted. */
function fakeUrls() {
  let n = 0
  const revoked: string[] = []
  return { revoked, urls: { create: () => `blob:${++n}`, revoke: (u: string) => void revoked.push(u) } }
}

describe('PictureStore', () => {
  it('keeps a picture by id and revokes it when forgotten', () => {
    const { revoked, urls } = fakeUrls()
    const store = new PictureStore(urls)
    store.keep('a', new Blob())
    store.keep('b', new Blob())
    expect(store.url('a')).toBe('blob:1')
    store.forget(['a', undefined, 'unknown'])
    expect(store.url('a')).toBeUndefined()
    expect(store.url(undefined)).toBeUndefined()
    expect(revoked).toEqual(['blob:1'])
    expect(store.size).toBe(1)
  })

  it('revokes the earlier picture when an id is kept again', () => {
    const { revoked, urls } = fakeUrls()
    const store = new PictureStore(urls)
    store.keep('a', new Blob())
    store.keep('a', new Blob())
    expect(store.url('a')).toBe('blob:2')
    expect(revoked).toEqual(['blob:1'])
  })

  it('forgets every picture when the screen goes', () => {
    const { revoked, urls } = fakeUrls()
    const store = new PictureStore(urls)
    store.keep('a', new Blob())
    store.keep('b', new Blob())
    store.forgetAll()
    expect(store.size).toBe(0)
    expect(revoked).toEqual(['blob:1', 'blob:2'])
  })
})
