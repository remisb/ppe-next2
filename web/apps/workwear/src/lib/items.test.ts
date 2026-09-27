import type { CatalogueItem } from '@ppe/api-client'
import { describe, expect, it } from 'vitest'

import { guessIcon, matchItems } from './items'

const item = (name: string, details: string) => ({ id: name, name, details }) as CatalogueItem
const items = [item('Safety shoes', 'S3 SRC, steel toe cap'), item('Work jacket', 'Polyester/cotton'), item('Safety helmet', 'EN 397')]

describe('Add Item search', () => {
  it('lists everything, in catalogue order, for an empty search', () => {
    expect(matchItems(items, '  ').map((i) => i.name)).toEqual(['Safety shoes', 'Work jacket', 'Safety helmet'])
  })
  it('matches every word in the name or manufacturer/model, ignoring case', () => {
    expect(matchItems(items, 'safety').map((i) => i.name)).toEqual(['Safety shoes', 'Safety helmet'])
    expect(matchItems(items, 'SAFETY 397').map((i) => i.name)).toEqual(['Safety helmet'])
    expect(matchItems(items, 'steel').map((i) => i.name)).toEqual(['Safety shoes'])
    expect(matchItems(items, 'gloves')).toEqual([])
  })
})

describe('a new item\'s pictogram', () => {
  it('is suggested by its name', () => {
    expect(guessIcon('Safety shoes')).toBe('shoes')
    expect(guessIcon('Winter JACKET')).toBe('jacket')
    expect(guessIcon('Hi-vis vest')).toBe('vest')
    expect(guessIcon('Ear defenders')).toBe('ear')
    expect(guessIcon('FFP3 respirator')).toBe('mask')
    expect(guessIcon('First aid kit')).toBe('other')
  })
})
