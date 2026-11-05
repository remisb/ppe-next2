import type { AppChannel, AppGroup, AppIcon, AppInput, AppKind, AppStage, AppTier, AppVersion, LauncherApp, NewAppInput, Permission } from '@ppe/api-client'
import { APP_SLUG_PATTERN, RESERVED_APP_SLUGS } from '@ppe/api-client'

import { t } from '@/i18n'

/**
 * Manage apps' form rules. The API enforces them (internal/domain/launcher);
 * these say what is wrong before a round trip, in the language in use.
 */

export interface AppDraft {
  kind: AppKind
  slug: string
  parent: string
  names: { en: string; lt: string; ru: string }
  group: AppGroup
  stage: AppStage
  tier: AppTier
  href: string
  icon: AppIcon
  color: string
  /** Seen by everyone signed in, or by holders of any of anyOf. */
  everyone: boolean
  anyOf: Permission[]
}

export type AppErrors = Partial<Record<'slug' | 'parent' | 'names' | 'href' | 'color' | 'audience', string>>

/** Colours that pass with white text, for the swatches; any other passing one may be typed. */
export const SWATCHES = ['#1c2060', '#3341a8', '#2a5fb4', '#5b4bb3', '#23703f', '#0e7068', '#0f5f8a', '#7a4e14', '#9a4f0a', '#a33a7c', '#3b4256', '#5b6475']

export function draftOf(a: LauncherApp | undefined): AppDraft {
  if (!a) {
    return {
      kind: 'app', slug: '', parent: '', names: { en: '', lt: '', ru: '' }, group: 'workwear', stage: 'poc', tier: 'here', href: '',
      icon: 'box', color: SWATCHES[1]!, everyone: false, anyOf: [],
    }
  }
  return {
    kind: a.kind, slug: a.slug, parent: a.parent, names: { ...a.names }, group: a.group, stage: a.stage, tier: a.tier, href: a.href,
    icon: a.icon, color: a.color, everyone: a.any_of.length === 0, anyOf: [...a.any_of],
  }
}

/** What the API is sent: for a shortcut, the tier is always here. */
export function inputOf(d: AppDraft): AppInput {
  return {
    parent: d.kind === 'shortcut' ? d.parent : '',
    group: d.group,
    icon: d.icon,
    color: d.color.trim().toLowerCase(),
    href: d.href.trim(),
    tier: d.kind === 'shortcut' ? 'here' : d.tier,
    stage: d.stage,
    names: { en: d.names.en.trim(), lt: d.names.lt.trim(), ru: d.names.ru.trim() },
    any_of: d.everyone ? [] : d.anyOf,
  }
}

export const newInputOf = (d: AppDraft): NewAppInput => ({ ...inputOf(d), slug: d.slug.trim().toLowerCase(), kind: d.kind })

/** A slug from an English name: "Size Helper" → "size-helper". */
export function slugFrom(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 31)
}

/** Whether white text on c (#rrggbb) has a contrast of at least 4.5:1, as the API checks. */
export function readableOnWhite(c: string): boolean {
  if (!/^#[0-9a-f]{6}$/i.test(c)) return false
  const channel = (hex: string) => {
    const s = parseInt(hex, 16) / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const l = 0.2126 * channel(c.slice(1, 3)) + 0.7152 * channel(c.slice(3, 5)) + 0.0722 * channel(c.slice(5, 7))
  return 1.05 / (l + 0.05) >= 4.5
}

export function validateApp(d: AppDraft, isNew: boolean): AppErrors {
  const errors: AppErrors = {}
  const input = inputOf(d)
  if (isNew) {
    const slug = d.slug.trim().toLowerCase()
    if (!slug) errors.slug = t.apps.enterSlug
    else if (!APP_SLUG_PATTERN.test(slug) || RESERVED_APP_SLUGS.includes(slug)) errors.slug = t.apps.badSlug
  }
  if (d.kind === 'shortcut' && !d.parent) errors.parent = t.apps.chooseParent
  const names = Object.values(input.names)
  if (names.some((n) => !n)) errors.names = t.apps.enterName
  else if (names.some((n) => [...n].length > 60)) errors.names = t.apps.nameTooLong
  if (!input.href) errors.href = t.apps.enterAddress
  else if (/[\s\\]/.test(input.href) || input.href.length > 300) errors.href = input.tier === 'here' ? t.apps.badHereAddress : t.apps.badLinkedAddress
  else if (input.tier === 'here' && (!input.href.startsWith('/') || input.href.startsWith('//'))) errors.href = t.apps.badHereAddress
  else if (input.tier === 'linked' && !/^https:\/\/[^/\s@]+/.test(input.href)) errors.href = t.apps.badLinkedAddress
  if (!/^#[0-9a-f]{6}$/.test(input.color)) errors.color = t.apps.badColor
  else if (!readableOnWhite(input.color)) errors.color = t.apps.lightColor
  if (!d.everyone && d.anyOf.length === 0) errors.audience = t.apps.chooseAudience
  return errors
}

/**
 * Where a tile goes when moved one place earlier or later: the slug to put it
 * before ('' for last), or null when it is already first or last.
 */
export function moveTarget(order: readonly string[], slug: string, by: -1 | 1): string | null {
  const at = order.indexOf(slug)
  if (at < 0) return null
  if (by === -1) return at === 0 ? null : order[at - 1]!
  if (at === order.length - 1) return null
  return order[at + 2] ?? ''
}

/** A variant channel as Add variant and Edit edit it. */
export interface VariantDraft {
  name: string
  label: { en: string; lt: string; ru: string }
  version: string
  /** Who sees it beside the app's audience; none: testers. */
  anyOf: Permission[]
}

export function variantDraftOf(c: AppChannel | undefined, versions: readonly AppVersion[]): VariantDraft {
  if (c) return { name: c.name, label: { ...c.label }, version: c.version, anyOf: [...c.any_of] }
  return { name: '', label: { en: '', lt: '', ru: '' }, version: versions[0]?.version ?? '', anyOf: [] }
}

/** A variant's name is a slug, not a fixed channel's and not taken; its label is in each language. */
export function validateVariant(d: VariantDraft, taken: readonly string[]): Partial<Record<'name' | 'label' | 'version', string>> {
  const errors: Partial<Record<'name' | 'label' | 'version', string>> = {}
  const name = d.name.trim()
  if (!name) errors.name = t.apps.enterVariantName
  else if (!APP_SLUG_PATTERN.test(name)) errors.name = t.apps.badSlug
  else if (['stable', 'beta', 'preview'].includes(name) || taken.includes(name)) errors.name = t.apps.variantTaken
  if (!d.label.en.trim() || !d.label.lt.trim() || !d.label.ru.trim()) errors.label = t.apps.enterName
  if (!d.version) errors.version = t.apps.chooseVersion
  return errors
}
