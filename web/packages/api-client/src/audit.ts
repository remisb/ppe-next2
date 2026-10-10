/**
 * The Audit log's areas and every event the API records, in the order its
 * filters list them. They mirror Areas() and Events() in internal/audit
 * (events.go); a Go test there reads this file and fails when they differ.
 * The apps' words are typed against these lists, so a new event cannot be
 * shown without a description.
 */
export const AUDIT_AREAS = ['users', 'employees', 'catalogue', 'item_sets', 'orders', 'assets', 'settings', 'security', 'audit'] as const

export const AUDIT_EVENTS = [
  'user.created',
  'user.updated',
  'user.roles_changed',
  'user.activated',
  'user.deactivated',
  'user.password_changed',
  'user.password_reset',
  'user.deleted',
  'role.created',
  'role.updated',
  'role.deleted',
  'employee.created',
  'employee.updated',
  'employee.sizes_changed',
  'employee.deleted',
  'catalogue.created',
  'catalogue.updated',
  'catalogue.price_changed',
  'catalogue.activated',
  'catalogue.deactivated',
  'catalogue.deleted',
  'item_set.created',
  'item_set.updated',
  'item_set.deleted',
  'order.ordered',
  'order.confirmation_link_created',
  'order.confirmation_link_opened',
  'order.given',
  'order.deleted',
  'asset.registered',
  'asset.updated',
  'asset.status_changed',
  'asset.given',
  'asset.returned',
  'asset.marked_not_returned',
  'asset.signed_copy_uploaded',
  'settings.supplier_chat_changed',
  'settings.default_sim_provider_changed',
  'access_review.completed',
  'audit.exported',
  'audit.purged',
] as const

/** A group of record types on the Audit log's filter. */
export type AuditArea = (typeof AUDIT_AREAS)[number]

/** One kind of recorded change. */
export type AuditEvent = (typeof AUDIT_EVENTS)[number]

export function isAuditEvent(name: unknown): name is AuditEvent {
  return typeof name === 'string' && (AUDIT_EVENTS as readonly string[]).includes(name)
}
