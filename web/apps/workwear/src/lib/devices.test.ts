import type { SignedInDevice } from '@ppe/api-client'
import { describe, expect, it } from 'vitest'

import { sortDevices } from './devices'

describe('sortDevices', () => {
  it('puts this device first and keeps the order of the rest', () => {
    const d = (id: string, current = false) => ({ id, current }) as SignedInDevice
    expect(sortDevices([d('a'), d('b', true), d('c')]).map((x) => x.id)).toEqual(['b', 'a', 'c'])
  })
})
