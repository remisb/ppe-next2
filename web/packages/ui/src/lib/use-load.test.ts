import { ApiError } from '@ppe/api-client'
import { describe, expect, it } from 'vitest'

import { errorText } from './use-load.ts'

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
