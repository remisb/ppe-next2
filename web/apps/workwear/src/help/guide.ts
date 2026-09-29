import type { Role } from '@ppe/api-client'

/**
 * The user guide as data, one Guide per language (help/en.ts, lt.ts, ru.ts):
 * the Help screen renders it for the signed-in user's roles, and `pnpm guide`
 * in web/e2e writes docs/guide from it with every section and takes the
 * screenshots it names. help.test.ts keeps the three languages in step.
 *
 * Text may hold **bold** (a control's name, as the app shows it) and `keys`
 * (a key, or a value as typed); `inline` splits it.
 */
export interface Guide {
  /** The guide's own words around the sections, in its language. */
  title: string
  lede: string
  /** The language switch's label, the contents' label and the shortcuts table's columns. */
  language: string
  contents: string
  key: string
  does: string
  /** Who a part is for, where the guide shows every part (docs/guide). */
  onlyFor: (roles: readonly Role[]) => string
  sections: Section[]
  footer: string
}

export interface Section {
  /** The section's address on the Help screen and in the docs: /help#history. */
  id: SectionId
  title: string
  roles?: readonly Role[]
  blocks: Block[]
}

export type SectionId =
  | 'sign-in'
  | 'dashboard'
  | 'create'
  | 'review'
  | 'confirm'
  | 'history'
  | 'record'
  | 'employees'
  | 'catalogue'
  | 'users'
  | 'account'
  | 'shortcuts'

/** A part of a section; roles limits it to users with any of them. */
export type Block = (
  | { p: string }
  | { ol: Item[] }
  | { ul: Item[] }
  /** Keyboard shortcuts: the keys, then what they do. */
  | { keys: [string, string][] }
  /** One screenshot, or two side by side. */
  | { shots: Shot[] }
) & { roles?: readonly Role[] }

export type Item = string | { text: string; items?: Item[]; roles?: readonly Role[] }

/** The screenshots `pnpm guide` takes, in each language. */
export type ShotName =
  | 'sign-in'
  | 'dashboard'
  | 'create-order'
  | 'review'
  | 'ordered'
  | 'confirm-phone'
  | 'history'
  | 'record'
  | 'employees'
  | 'employee'
  | 'catalogue'
  | 'item-sets'
  | 'users'
  | 'account'
  | 'palette'

export interface Shot {
  name: ShotName
  alt: string
  /** A phone screen, shown narrower. */
  phone?: boolean
}

/** Whether a part limited to `roles` is for a user with `user`. */
export function isFor(roles: readonly Role[] | undefined, user: readonly Role[]): boolean {
  return !roles || roles.some((r) => user.includes(r))
}

/** The guide as a user with these roles sees it: what their roles cannot do left out. */
export function forRoles(guide: Guide, user: readonly Role[]): Guide {
  const items = (list: Item[]): Item[] =>
    list
      .filter((i) => typeof i === 'string' || isFor(i.roles, user))
      .map((i) => (typeof i === 'string' || !i.items ? i : { ...i, items: items(i.items) }))
  const blocks = (list: Block[]): Block[] =>
    list
      .filter((b) => isFor(b.roles, user))
      .map((b) => ('ol' in b ? { ...b, ol: items(b.ol) } : 'ul' in b ? { ...b, ul: items(b.ul) } : b))
  return {
    ...guide,
    sections: guide.sections.filter((s) => isFor(s.roles, user)).map((s) => ({ ...s, blocks: blocks(s.blocks) })),
  }
}

export type Span = { kind: 'text' | 'bold' | 'keys'; text: string }

/** Splits a guide text into plain text, **bold** and `keys`. */
export function inline(text: string): Span[] {
  const spans: Span[] = []
  for (const part of text.split(/(\*\*[^*]+\*\*|`[^`]+`)/)) {
    if (!part) continue
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) spans.push({ kind: 'bold', text: part.slice(2, -2) })
    else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) spans.push({ kind: 'keys', text: part.slice(1, -1) })
    else spans.push({ kind: 'text', text: part })
  }
  return spans
}

/** Where a screenshot is served from: the app's public/help-img/<lang>/<name>.png. */
export function shotPath(lang: string, name: ShotName): string {
  return `help-img/${lang}/${name}.png`
}
