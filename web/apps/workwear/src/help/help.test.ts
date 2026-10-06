import type { RoleKey as Role } from '@ppe/api-client'
import { describe, expect, it } from 'vitest'

import { type Block, type Device, type Guide, type Item, deviceFor, forReader, guides, helpAudiences, inline, shotPath } from './index'

/** A guide's shape without its words: what must match across languages. */
function shape(g: Guide) {
  const item = (i: Item): unknown => (typeof i === 'string' ? 'text' : { roles: i.roles, devices: i.devices, items: i.items?.map(item) })
  const block = (b: Block): unknown => {
    const who = { roles: b.roles, devices: b.devices }
    if ('p' in b) return { p: true, ...who }
    if ('ol' in b) return { ol: b.ol.map(item), ...who }
    if ('ul' in b) return { ul: b.ul.map(item), ...who }
    if ('keys' in b) return { keys: b.keys.length, ...who }
    return { shots: b.shots.map((s) => [s.name, s.phone ?? false]), ...who }
  }
  return g.sections.map((s) => ({ id: s.id, roles: s.roles, titleOn: Object.keys(s.titleOn ?? {}), blocks: s.blocks.map(block) }))
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
      ...Object.values(s.titleOn ?? {}),
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

describe('forReader', () => {
  const ids = (g: Guide) => g.sections.map((s) => s.id)
  const words = (g: Guide) => texts(g).join('\n')
  const forRoles = (g: Guide, roles: readonly Role[]) => forReader(g, { roles, device: 'desktop' })

  it('keeps Users, Backups and the Dashboard tour for administrators only', () => {
    expect(ids(forRoles(guides.en, ['admin']))).toEqual(expect.arrayContaining(['users', 'backups']))
    expect(ids(forRoles(guides.en, ['manager']))).not.toContain('users')
    expect(ids(forRoles(guides.en, ['manager']))).not.toContain('backups')
    expect(words(forRoles(guides.en, ['manager']))).not.toContain('Backups')
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

describe('devices', () => {
  const words = (device: Device) => texts(forReader(guides.en, { roles: ['admin'], device })).join('\n')

  it('follow the app’s layout: the bar below 768px, the rail up to 1279px, then the sidebar', () => {
    expect([375, 767, 768, 1279, 1280, 1920].map(deviceFor)).toEqual(['phone', 'phone', 'tablet', 'tablet', 'desktop', 'desktop'])
  })

  it('keep keyboard parts for the desktop, and name each device’s way round', () => {
    expect(words('desktop')).toContain('`J` and `K`')
    expect(words('phone')).not.toContain('`J`')
    expect(words('tablet')).not.toContain('⌘/Ctrl')
    expect(words('phone')).toContain('**More** holds the rest')
    expect(words('tablet')).toContain('The rail on the left')
    expect(words('desktop')).toContain('The sidebar holds')
  })

  it('retitle Search and shortcuts where there is no keyboard', () => {
    const title = (device: Device) => forReader(guides.en, { device }).sections.find((s) => s.id === 'shortcuts')!.title
    expect([title('phone'), title('tablet'), title('desktop')]).toEqual(['Search', 'Search', 'Search and shortcuts'])
  })

  it('show each device’s screenshots, and the phone’s for phone-only ones', () => {
    expect(shotPath('lt', 'tablet', { name: 'history' })).toBe('help-img/lt/tablet/history.png')
    expect(shotPath('ru', 'desktop', { name: 'sign-in', phone: true })).toBe('help-img/ru/phone/sign-in.png')
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

describe('helpAudiences', () => {
  const reader = (...perms: string[]) => ({ can: (p: string) => perms.includes(p) })
  it("reads each built-in role's parts for the permissions that set it apart", () => {
    expect(helpAudiences(reader('users.read', 'users.manage', 'dashboard.overview'))).toEqual(['admin'])
    expect(helpAudiences(reader('users.read', 'orders.delete', 'dashboard.manager'))).toEqual(['manager'])
    expect(helpAudiences(reader('dashboard.employee'))).toEqual(['employee'])
    expect(helpAudiences(reader('catalogue.manage'))).toEqual([])
  })
})
