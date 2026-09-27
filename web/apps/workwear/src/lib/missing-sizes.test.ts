import { describe, expect, it } from 'vitest'

import { isMissingASize, missingSizes } from './missing-sizes'

describe('missing sizes', () => {
  it('flags a shoe size always, a clothing size only without a height to suggest one from', () => {
    expect(missingSizes({ clothing_size: 'M', shoe_size: '42', height_cm: null })).toEqual({ clothing: false, shoes: false })
    expect(missingSizes({ clothing_size: null, shoe_size: '42', height_cm: 180 })).toEqual({ clothing: false, shoes: false })
    expect(missingSizes({ clothing_size: null, shoe_size: '42', height_cm: null })).toEqual({ clothing: true, shoes: false })
    expect(missingSizes({ clothing_size: 'M', shoe_size: null, height_cm: 180 })).toEqual({ clothing: false, shoes: true })
  })

  it('says whether any size is missing', () => {
    expect(isMissingASize({ clothing_size: 'S', shoe_size: '39', height_cm: 165 })).toBe(false)
    expect(isMissingASize({ clothing_size: 'M', shoe_size: null, height_cm: 171 })).toBe(true)
  })
})
