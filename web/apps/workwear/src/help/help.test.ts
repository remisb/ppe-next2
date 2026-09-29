import { describe, expect, it } from 'vitest'

import { type Block, type Guide, type Item, forRoles, guides, inline } from './index'

/** A guide's shape without its words: what must match across languages. */
function shape(g: Guide) {
  const item = (i: Item): unknown => (typeof i === 'string' ? 'text' : { roles: i.roles, items: i.items?.map(item) })
  const block = (b: Block): unknown => {
    if ('p' in b) return { p: true, roles: b.roles }
    if ('ol' in b) return { ol: b.ol.map(item), roles: b.roles }
    if ('ul' in b) return { ul: b.ul.map(item), roles: b.roles }
    if ('keys' in b) return { keys: b.keys.length, roles: b.roles }
    return { shots: b.shots.map((s) => [s.name, s.phone ?? false]), roles: b.roles }
  }
  return g.sections.map((s) => ({ id: s.id, roles: s.roles, blocks: s.blocks.map(block) }))
}

/** Every text in a guide, markup included. */
function texts(g: Guide): string[] {
  const item = (i: Item): string[] => (typeof i === 'string' ? [i] : [i.text, ...(i.items ?? []).flatMap(item)])
  return [
    g.title,
    g.lede,
    g.footer,
    ...g.sections.flatMap((s) => [
      s.title,
      ...s.blocks.flatMap((b) =>
        'p' in b ? [b.p] : 'ol' in b ? b.ol.flatMap(item) : 'ul' in b ? b.ul.flatMap(item) : 'keys' in b ? b.keys.flat() : b.shots.map((x) => x.alt),
      ),
    ]),
  ]
}

describe('guides', () => {
  it('have the same sections, parts, roles and screenshots in every language', () => {
    expect(shape(guides.lt)).toEqual(shape(guides.en))
    expect(shape(guides.ru)).toEqual(shape(guides.en))
  })

  it('close every ** and `', () => {
    for (const g of Object.values(guides)) {
      const open = texts(g).filter((s) => inline(s).some((span) => span.kind === 'text' && /\*\*|`/.test(span.text)))
      expect(open).toEqual([])
    }
  })

  it('name who a part is for in each language', () => {
    expect(guides.en.onlyFor(['admin', 'manager'])).toBe('Administrators and managers only')
    expect(guides.lt.onlyFor(['manager'])).toBe('Tik vadovams')
    expect(guides.ru.onlyFor(['admin'])).toBe('Только для администраторов')
  })
})

describe('forRoles', () => {
  const ids = (g: Guide) => g.sections.map((s) => s.id)
  const words = (g: Guide) => texts(g).join('\n')

  it('keeps Users and the Dashboard tour for administrators only', () => {
    expect(ids(forRoles(guides.en, ['admin']))).toContain('users')
    expect(ids(forRoles(guides.en, ['manager']))).not.toContain('users')
    expect(words(forRoles(guides.en, ['employee']))).not.toContain('Needs you')
    expect(words(forRoles(guides.en, ['employee']))).toContain('Employee Dashboard')
  })

  it('keeps Delete order for managers only', () => {
    expect(words(forRoles(guides.en, ['manager']))).toContain('Delete order')
    expect(words(forRoles(guides.en, ['admin']))).not.toContain('Delete order')
  })

  it('keeps only the start screens of the user’s roles', () => {
    const signIn = forRoles(guides.en, ['admin', 'manager']).sections[0]!.blocks[0]!
    expect(signIn).toMatchObject({ ol: [expect.any(String), { items: [{ roles: ['admin'] }, { roles: ['manager'] }] }] })
  })
})

describe('inline', () => {
  it('splits bold names and keys from the text', () => {
    expect(inline('Choose **Mark as Ordered**, or press `⌘/Ctrl` `Enter`.')).toEqual([
      { kind: 'text', text: 'Choose ' },
      { kind: 'bold', text: 'Mark as Ordered' },
      { kind: 'text', text: ', or press ' },
      { kind: 'keys', text: '⌘/Ctrl' },
      { kind: 'text', text: ' ' },
      { kind: 'keys', text: 'Enter' },
      { kind: 'text', text: '.' },
    ])
  })
})
