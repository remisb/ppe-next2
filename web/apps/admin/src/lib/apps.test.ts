import { tile } from '@ppe/launcher/testing'
import { describe, expect, it } from 'vitest'

import { SWATCHES, draftOf, inputOf, moveTarget, newInputOf, readableOnWhite, slugFrom, validateApp } from './apps'

const filled = () => {
  const d = draftOf(undefined)
  d.slug = 'size-helper'
  d.names = { en: 'Size Helper', lt: 'Dydžių pagalbininkas', ru: 'Помощник по размерам' }
  d.href = '/apps/size-helper/'
  d.anyOf = ['assets.manage']
  return d
}

describe('validateApp', () => {
  it('passes a filled-in app', () => {
    expect(validateApp(filled(), true)).toEqual({})
  })

  it('names each problem, by field', () => {
    const d = filled()
    d.slug = 'Size Helper!'
    d.names.lt = ' '
    d.href = '//elsewhere.example/'
    d.color = '#f5c518'
    d.anyOf = []
    expect(Object.keys(validateApp(d, true)).sort()).toEqual(['audience', 'color', 'href', 'names', 'slug'])
    // The slug is set once: editing does not check it.
    expect(validateApp({ ...filled(), slug: '' }, false)).toEqual({})
  })

  it('wants an https address for a linked site, and an app for a shortcut', () => {
    expect(validateApp({ ...filled(), tier: 'linked', href: 'http://crew.example.org/' }, true).href).toBeTruthy()
    expect(validateApp({ ...filled(), tier: 'linked', href: 'https://crew.example.org/' }, true)).toEqual({})
    expect(validateApp({ ...filled(), kind: 'shortcut' }, true).parent).toBeTruthy()
  })
})

describe('inputOf', () => {
  it('sends everyone as no permissions, and a shortcut as here with its app', () => {
    const d = { ...filled(), kind: 'shortcut' as const, parent: 'workwear', tier: 'linked' as const, everyone: true, color: ' #1C2060 ' }
    expect(inputOf(d)).toMatchObject({ parent: 'workwear', tier: 'here', any_of: [], color: '#1c2060' })
    expect(newInputOf(filled())).toMatchObject({ slug: 'size-helper', kind: 'app', parent: '', any_of: ['assets.manage'] })
  })

  it('reads a tile back as a draft', () => {
    const d = draftOf(tile('crew', { tier: 'linked', any_of: ['dashboard.manager'] }))
    expect(d).toMatchObject({ slug: 'crew', tier: 'linked', everyone: false, anyOf: ['dashboard.manager'] })
    expect(draftOf(tile('workwear')).everyone).toBe(true)
  })
})

describe('colours and slugs', () => {
  it('offers only swatches that pass with white text', () => {
    for (const c of SWATCHES) expect(readableOnWhite(c)).toBe(true)
    expect(readableOnWhite('#ffffff')).toBe(false)
    expect(readableOnWhite('navy')).toBe(false)
  })

  it('makes a slug from a name', () => {
    expect(slugFrom('Size Helper')).toBe('size-helper')
    expect(slugFrom('Įrangos patikra')).toBe('irangos-patikra')
    expect(slugFrom('3D Viewer')).toBe('d-viewer')
  })
})

describe('moveTarget', () => {
  const order = ['a', 'b', 'c', 'd']
  it('puts a tile before the one above, or after the one below', () => {
    expect(moveTarget(order, 'c', -1)).toBe('b')
    expect(moveTarget(order, 'b', 1)).toBe('d')
    expect(moveTarget(order, 'c', 1)).toBe('')
    expect(moveTarget(order, 'a', -1)).toBeNull()
    expect(moveTarget(order, 'd', 1)).toBeNull()
  })
})
