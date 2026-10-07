/**
 * How one recorded change reads: its action, and each changed field with its
 * value before and after, in the language in use.
 */
import { type AuditEntry, type AuditSource, isAuditEvent } from '@ppe/api-client'
import { formatEuro, intlLocale } from '@ppe/i18n'
import { deviceName } from '@ppe/ui/lib/devices'

import { type AuditText, auditText } from './text.ts'

/** Names the app cannot know from the event alone: roles and permissions by id or key. */
export interface DescribeOptions {
  roleName?: (id: string) => string | undefined
  permissionLabel?: (key: string) => string | undefined
}

/** One field of a change; null where it had no value on that side. */
export interface FieldChange {
  key: string
  label: string
  before: string | null
  after: string | null
}

type Format = 'text' | 'money' | 'months' | 'cm' | 'bool' | 'language' | 'sizeGroup' | 'icon' | 'status' | 'method' | 'roles' | 'permissions' | 'lines' | 'date' | 'changed'

/**
 * The fields shown, in the order shown, and how their values read. A field not
 * listed is shown as it is stored; `hidden` ones (ids that name nothing a
 * person reads) are left out.
 */
const fields: [key: keyof AuditText['fields'], format: Format][] = [
  ['first_name', 'text'],
  ['last_name', 'text'],
  ['name', 'text'],
  ['email', 'text'],
  ['code', 'text'],
  ['description', 'text'],
  ['details', 'text'],
  ['preferred_language', 'language'],
  ['language', 'language'],
  ['notes_changed', 'changed'],
  ['height_cm', 'cm'],
  ['clothing_size', 'text'],
  ['shoe_size', 'text'],
  ['size_group', 'sizeGroup'],
  ['icon', 'icon'],
  ['accounting_price_cents', 'money'],
  ['purchase_price_cents', 'money'],
  ['service_period_months', 'months'],
  ['display_rank', 'text'],
  ['active', 'bool'],
  ['is_active', 'bool'],
  ['role_ids', 'roles'],
  ['permissions', 'permissions'],
  ['lines', 'lines'],
  ['record_number', 'text'],
  ['status', 'status'],
  ['total_cents', 'money'],
  ['method', 'method'],
  ['confirmed_name', 'text'],
  ['document_hash', 'text'],
  ['expires_at', 'date'],
  ['link', 'text'],
  ['users', 'text'],
  ['active_users', 'text'],
  ['administrators', 'text'],
  ['dormant', 'text'],
  ['no_sign_in', 'text'],
]

/** Stored with an event but naming nothing a reader needs: ids, and the currency (always EUR). */
const hidden = new Set(['employee_id', 'confirmation_id', 'currency'])

/** Events from before migration 0021 hold the accounting price under this key. */
const legacyKeys: Record<string, string> = { unit_price_cents: 'accounting_price_cents' }

/** The action, "Price changed"; an event this app does not know yet shows as stored. */
export function auditTitle(event: string): string {
  return isAuditEvent(event) ? auditText().events[event] : event
}

/** Where a change was made, or "Not recorded" for one from before that was. */
export function sourceLabel(source: AuditSource | null): string {
  const t = auditText()
  return source ? t.sources[source] : t.notRecorded
}

/** The area's name on the filter; an unknown one as stored. */
export function areaLabel(area: string): string {
  const areas: Record<string, string> = auditText().areas
  return areas[area] ?? area
}

/** "Chrome on Windows" for the sign-in a change was made in. */
export function deviceText(userAgent: string): string {
  const t = auditText()
  const { browser, system } = deviceName(userAgent)
  if (browser && system) return t.deviceOn(browser, system)
  return browser ?? system ?? t.unknownDevice
}

function format(value: unknown, how: Format, options: DescribeOptions): string | null {
  const t = auditText()
  if (value === null || value === undefined) return null
  switch (how) {
    case 'money':
      return typeof value === 'number' ? formatEuro(value) : String(value)
    case 'months':
      return typeof value === 'number' ? t.months(value) : String(value)
    case 'cm':
      return `${String(value)} cm`
    case 'bool':
      return value === true ? t.yes : value === false ? t.no : String(value)
    case 'changed':
      return value === true ? t.changed : null
    case 'language':
      return typeof value === 'string' ? (new Intl.DisplayNames([intlLocale()], { type: 'language' }).of(value) ?? value) : String(value)
    case 'sizeGroup':
      return t.sizeGroups[String(value)] ?? String(value)
    case 'icon':
      return t.icons[String(value)] ?? String(value)
    case 'status':
      return t.statuses[String(value)] ?? String(value)
    case 'method':
      return t.methods[String(value)] ?? String(value)
    case 'roles':
      if (!Array.isArray(value)) return String(value)
      if (value.length === 0) return t.none
      return options.roleName ? value.map((id) => options.roleName!(String(id)) ?? String(id)).join(', ') : t.roles(value.length)
    case 'permissions':
      if (!Array.isArray(value)) return String(value)
      if (value.length === 0) return t.none
      return options.permissionLabel ? value.map((k) => options.permissionLabel!(String(k)) ?? String(k)).join(', ') : t.permissionCount(value.length)
    case 'lines':
      return Array.isArray(value) ? t.items(value.length) : String(value)
    case 'date':
      return typeof value === 'string' ? new Date(value).toLocaleString(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : String(value)
    case 'text':
      return value === '' ? null : typeof value === 'object' ? JSON.stringify(value) : String(value)
  }
}

/**
 * The fields a change shows, known ones first in a fixed order, then any
 * other stored field as it is. A field equal on both sides is left out unless
 * the change created the record (no before), which shows what it began with.
 */
export function auditChanges(entry: Pick<AuditEntry, 'before' | 'after'>, options: DescribeOptions = {}): FieldChange[] {
  const t = auditText()
  const before = normalise(entry.before)
  const after = normalise(entry.after)
  const created = entry.before === null
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const out: FieldChange[] = []
  const add = (key: string, label: string, how: Format) => {
    const b = format(before[key], how, options)
    const a = format(after[key], how, options)
    if (b === null && a === null) return
    if (!created && b === a) return
    out.push({ key, label, before: b, after: a })
  }
  for (const [key, how] of fields) {
    if (keys.delete(key)) add(key, t.fields[key], how)
  }
  for (const key of keys) {
    if (!hidden.has(key)) add(key, key, 'text')
  }
  return out
}

function normalise(side: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(side ?? {})) out[legacyKeys[k] ?? k] = v
  return out
}
