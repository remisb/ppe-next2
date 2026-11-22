import { deviceText, sourceLabel } from '@ppe/audit'
import type { Company, ErrorEvent, LauncherApp, LiveSession, Role, Supplier, User } from '@ppe/api-client'
import { languages } from '@ppe/i18n'
import { appName, launcherText } from '@ppe/launcher'
import { type ExportColumn, exportMoment } from '@ppe/ui/lib/table-export'

import { t } from '@/i18n'
import { permissionLabel } from '@/lib/roles'
import { roleName, rolesOf } from '@/lib/users'

/*
 * The columns each Administration list offers to Export, in the file's order,
 * the screen's own ticked (`shown`). Every one of these screens is for whoever
 * may open it at all, so no column needs a permission of its own. Moments are
 * in the organisation's timezone, as the screens show them.
 */

/** Users: name, email, roles and status as the list shows them, then language and the day added. */
export function userExportColumns(roles: readonly Role[], timeZone?: string): ExportColumn<User>[] {
  return [
    { key: 'name', label: t.users.name, value: (u) => u.name, shown: true },
    { key: 'email', label: t.users.email, value: (u) => u.email, shown: true },
    { key: 'roles', label: t.users.roles, value: (u) => rolesOf(u.role_ids, roles).map(roleName).join(', ') || null, shown: true },
    { key: 'status', label: t.users.status, value: (u) => (u.is_active ? t.common.active : t.common.inactive), shown: true },
    { key: 'language', label: t.users.exportColumns.language, value: (u) => languages.find((l) => l.value === u.language)?.label ?? u.language },
    { key: 'added', label: t.users.exportColumns.added, value: (u) => exportMoment(u.created_at, timeZone, false) },
  ]
}

/** Roles & permissions: each role, whether it is built in, what it is for, what it allows and how many hold it. */
export function roleExportColumns(): ExportColumn<Role>[] {
  return [
    { key: 'name', label: t.roles.name, value: (r) => roleName(r), shown: true },
    { key: 'built_in', label: t.roles.builtIn, value: (r) => (r.key ? t.roles.builtIn : null) },
    { key: 'description', label: t.roles.descriptionLabel, value: (r) => r.description || null },
    { key: 'permissions', label: t.roles.permissions, value: (r) => r.permissions.map(permissionLabel).join(', ') || null, shown: true },
    { key: 'users', label: t.roles.users, value: (r) => r.user_count, shown: true },
  ]
}

/** Companies: every field of the record; the list's own (name, code, place, default, employees) ticked. */
export function companyExportColumns(): ExportColumn<Company>[] {
  const text = (v: string) => v || null
  return [
    { key: 'name', label: t.companies.name, value: (c) => c.name, shown: true },
    { key: 'code', label: t.companies.code, value: (c) => text(c.code), shown: true },
    { key: 'default', label: t.companies.defaultBadge, value: (c) => (c.is_default ? t.companies.defaultBadge : null), shown: true },
    { key: 'company_code', label: t.companies.companyCode, value: (c) => text(c.company_code) },
    { key: 'vat_code', label: t.companies.vatCode, value: (c) => text(c.vat_code) },
    { key: 'address', label: t.companies.address, value: (c) => text(c.address) },
    { key: 'city', label: t.companies.city, value: (c) => text(c.city), shown: true },
    { key: 'postal_code', label: t.companies.postalCode, value: (c) => text(c.postal_code) },
    { key: 'country', label: t.companies.country, value: (c) => text(c.country), shown: true },
    { key: 'employees', label: t.companies.employees, value: (c) => c.employee_count, shown: true },
    { key: 'notes', label: t.companies.notes, value: (c) => text(c.notes) },
  ]
}

/** Suppliers: every field of the record; the list's own (code, name, place, items, contact) ticked. */
export function supplierExportColumns(): ExportColumn<Supplier>[] {
  const text = (v: string) => v || null
  return [
    { key: 'code', label: t.suppliers.code, value: (s) => s.code, shown: true },
    { key: 'name', label: t.suppliers.name, value: (s) => s.name, shown: true },
    { key: 'company_code', label: t.suppliers.companyCode, value: (s) => text(s.company_code) },
    { key: 'vat_code', label: t.suppliers.vatCode, value: (s) => text(s.vat_code) },
    { key: 'address', label: t.suppliers.address, value: (s) => text(s.address) },
    { key: 'city', label: t.suppliers.city, value: (s) => text(s.city), shown: true },
    { key: 'postal_code', label: t.suppliers.postalCode, value: (s) => text(s.postal_code) },
    { key: 'country', label: t.suppliers.country, value: (s) => text(s.country), shown: true },
    { key: 'items', label: t.suppliers.items, value: (s) => s.item_count, shown: true },
    { key: 'contact_person', label: t.suppliers.contactPerson, value: (s) => text(s.contact_person), shown: true },
    { key: 'email', label: t.suppliers.email, value: (s) => text(s.email), shown: true },
    { key: 'phone', label: t.suppliers.phone, value: (s) => text(s.phone), shown: true },
    { key: 'website', label: t.suppliers.website, value: (s) => text(s.website) },
    { key: 'bank_account', label: t.suppliers.bankAccount, value: (s) => text(s.bank_account) },
    { key: 'notes', label: t.suppliers.notes, value: (s) => text(s.notes) },
  ]
}

/** Manage apps: each tile in App Launcher's order, where it runs and who sees it. `all` names a shortcut's app. */
export function appExportColumns(all: readonly LauncherApp[]): ExportColumn<LauncherApp>[] {
  const order = (a: LauncherApp) => all.findIndex((x) => x.slug === a.slug) + 1 || null
  const parent = (a: LauncherApp) => {
    if (!a.parent) return null
    const p = all.find((x) => x.slug === a.parent)
    return p ? appName(p) : a.parent
  }
  return [
    { key: 'order', label: t.apps.order, value: order },
    { key: 'name', label: t.apps.names, value: (a) => appName(a), shown: true },
    { key: 'slug', label: t.apps.slug, value: (a) => a.slug, shown: true },
    { key: 'kind', label: t.apps.kind, value: (a) => t.apps.kinds[a.kind], shown: true },
    { key: 'parent', label: t.apps.parent, value: parent },
    { key: 'group', label: t.apps.group, value: (a) => t.apps.groups[a.group], shown: true },
    { key: 'stage', label: t.apps.stage, value: (a) => launcherText().stages[a.stage], shown: true },
    { key: 'tier', label: t.apps.tier, value: (a) => t.apps.tiers[a.tier], shown: true },
    { key: 'address', label: t.apps.address, value: (a) => a.href || null },
    { key: 'audience', label: t.apps.audience, value: (a) => (a.any_of.length ? a.any_of.map(permissionLabel).join(', ') : t.apps.everyone) },
  ]
}

/** Security's Signed-in devices: who, on what and from where, and when. */
export function deviceExportColumns(timeZone?: string): ExportColumn<LiveSession>[] {
  return [
    { key: 'user', label: t.security.name, value: (s) => s.user_name, shown: true },
    { key: 'email', label: t.security.exportColumns.email, value: (s) => s.user_email, shown: true },
    { key: 'device', label: t.security.device, value: (s) => deviceText(s.user_agent), shown: true },
    { key: 'address', label: t.security.where, value: (s) => s.ip || null, shown: true },
    { key: 'sign_in', label: t.security.exportColumns.signIn, value: (s) => (s.keep_signed_in ? t.security.keptSignedIn : t.security.untilBrowserCloses) },
    { key: 'last_used', label: t.security.lastUsed, value: (s) => exportMoment(s.last_used_at, timeZone), shown: true },
    { key: 'signed_in', label: t.security.signedInAt, value: (s) => exportMoment(s.created_at, timeZone), shown: true },
    { key: 'ends', label: t.security.exportColumns.ends, value: (s) => exportMoment(s.expires_at, timeZone) },
  ]
}

/** System's error list: each kind of error, how often and when, and where to look next. */
export function errorExportColumns(timeZone?: string): ExportColumn<ErrorEvent>[] {
  const kind = (k: string) => (k in t.system.kinds ? t.system.kinds[k as ErrorEvent['kind']] : k)
  return [
    { key: 'last_seen', label: t.system.lastSeen, value: (e) => exportMoment(e.last_seen, timeZone), shown: true },
    { key: 'error', label: t.system.error, value: (e) => e.message, shown: true },
    { key: 'route', label: t.system.route, value: (e) => e.route || null, shown: true },
    { key: 'kind', label: t.system.kind, value: (e) => kind(e.kind), shown: true },
    { key: 'count', label: t.system.count, value: (e) => e.count, shown: true },
    { key: 'first_seen', label: t.system.firstSeen, value: (e) => exportMoment(e.first_seen, timeZone) },
    { key: 'status', label: t.system.httpStatus, value: (e) => e.status },
    { key: 'who', label: t.system.who, value: (e) => e.last_user_name },
    { key: 'reference', label: t.system.reference, value: (e) => e.last_request_id },
    { key: 'app', label: t.system.exportColumns.app, value: (e) => (e.source ? sourceLabel(e.source) : null) },
    { key: 'app_version', label: t.system.exportColumns.appVersion, value: (e) => e.app_version },
  ]
}
