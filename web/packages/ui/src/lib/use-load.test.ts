import { ApiError } from '@ppe/api-client'
import { describe, expect, it } from 'vitest'

import { type Loaded, combineLoads, errorText } from './use-load.ts'

describe('errorText', () => {
  it('words a server error for people, with its reference', () => {
    expect(errorText(new ApiError(500, 'internal error', '9f2c1a7e-0000-4000-8000-000000000000'))).toBe(
      'The server could not do this. Try again; if it happens again, tell an administrator. Reference: 9f2c1a7e',
    )
    expect(errorText(new ApiError(503, 'request timeout'))).toBe(
      'The server could not do this. Try again; if it happens again, tell an administrator.',
    )
  })

  it('keeps the API\'s words for a refusal', () => {
    expect(errorText(new ApiError(409, 'email already in use'))).toBe('email already in use')
  })
})

describe('combineLoads', () => {
  const load = <T,>(data: T | undefined, error?: unknown) => {
    const l = { data, error, loading: data === undefined && error === undefined, reloads: 0, reload: () => void l.reloads++ }
    return l satisfies Loaded<T>
  }

  it('has data once every load has', () => {
    expect(combineLoads(load([1]), load('a')).data).toEqual([[1], 'a'])
    const waiting = combineLoads(load([1]), load<string>(undefined))
    expect([waiting.data, waiting.loading]).toEqual([undefined, true])
  })

  it('shows the first error and loads again only what failed', () => {
    const ok = load([1])
    const failed = load<string>(undefined, new Error('no'))
    const both = combineLoads(ok, failed)
    expect(both.error).toEqual(new Error('no'))
    both.reload()
    expect([ok.reloads, failed.reloads]).toEqual([0, 1])
  })
})
