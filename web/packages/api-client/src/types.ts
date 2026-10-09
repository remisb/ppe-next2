// Wire types, mirroring the JSON the Go handlers write. Money is integer cents
// (EUR); sizes are the vocabulary codes from GET /api/v1/sizes, except an
// employee's clothing size, which is the EU number itself (44–66, even). An
// order line holds a clothing size as its code ("54"), or as a letter (S … 3XL)
// when it was ordered before clothing sizes became numbers.

import type { Permission } from './permissions.ts'

/** A built-in role's key; a role an administrator added has none. */
export type RoleKey = 'admin' | 'manager' | 'employee'
export type SizeGroup = 'CLOTHING' | 'SHOES' | 'NONE'

/** A user's interface language; each user sets their own. */
export type Language = 'en' | 'lt' | 'ru'

export interface User {
  id: string
  email: string
  name: string
  /** The roles the user holds (GET /api/v1/roles names them), in id order. */
  role_ids: string[]
  is_active: boolean
  language: Language
  created_at: string
  updated_at: string
}

/** POST /api/v1/users. Password rules as in internal/domain/user: 8–72 bytes. */
export interface UserCreateInput {
  email: string
  name: string
  password: string
  role_ids: string[]
}

/** PUT /api/v1/users/{id}: a full replace, so is_active is always sent. */
export interface UserUpdateInput {
  email: string
  name: string
  role_ids: string[]
  is_active: boolean
}

/**
 * A role: a named bundle of permissions users hold. The built-in roles have
 * a key; Administrator is locked (never changed or deleted).
 */
export interface Role {
  id: string
  key: RoleKey | null
  name: string
  description: string
  permissions: Permission[]
  locked: boolean
  /** Live users holding the role. */
  user_count: number
  created_at: string
  updated_at: string
  created_by_user_id: string | null
  updated_by_user_id: string | null
}

/** POST /api/v1/roles and PUT /api/v1/roles/{id} (a full replace). */
export interface RoleInput {
  name: string
  description: string
  permissions: Permission[]
}

/** GET /api/v1/permissions: one permission of the catalogue, and those it cannot work without. */
export interface PermissionInfo {
  key: Permission
  group: 'administration' | 'workwear' | 'dashboards'
  requires: Permission[]
}

export interface LoginResponse {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  expires_at: string
  user: User
}

/** One of the signed-in user's sign-ins, as Account lists it (GET /api/v1/auth/sessions). */
export interface SignedInDevice {
  id: string
  /** This browser's own sign-in. */
  current: boolean
  keep_signed_in: boolean
  created_at: string
  last_used_at: string
  /** When it ends if not used before. */
  expires_at: string
  user_agent: string
  ip: string
}

/** A clothing size; six carry the height range a suggestion is made from, the rest null. */
export interface ClothingSize {
  code: string
  /** The letter size covering two EU sizes: S (44–46) … 3XL (64–66). */
  band: string
  min_cm: number | null
  max_cm: number | null
}

export interface Sizes {
  clothing: ClothingSize[]
  shoes: { code: string }[]
}

export interface Employee {
  id: string
  first_name: string
  last_name: string
  full_name: string
  code: string | null
  height_cm: number | null
  clothing_size: number | null
  shoe_size: string | null
  notes: string
  /** The language the employee prefers, of those the app speaks; null when not recorded. */
  preferred_language: Language | null
  created_at: string
  updated_at: string
}

/** Body of POST /employees and PUT /employees/{id} (full replace). */
export interface EmployeeInput {
  first_name: string
  last_name: string
  code: string | null
  height_cm: number | null
  clothing_size: number | null
  shoe_size: string | null
  notes: string
  preferred_language: Language | null
}

/** Body of PUT /employees/{id}/sizes: all three are replaced. */
export interface EmployeeSizesInput {
  height_cm: number | null
  clothing_size: number | null
  shoe_size: string | null
}

/** An item's pictogram; the web app draws each one. */
export type CatalogueIcon =
  | 'shoes'
  | 'jacket'
  | 'insulated_jacket'
  | 'trousers'
  | 'vest'
  | 'gloves'
  | 'helmet'
  | 'welding_helmet'
  | 'glasses'
  | 'ear'
  | 'mask'
  | 'other'

export interface CatalogueItem {
  id: string
  name: string
  details: string
  size_group: SizeGroup
  /** What the supplier charges; optional, never needed to order. */
  purchase_price_cents: number | null
  /** What the organisation books and orders show; needed to order. */
  accounting_price_cents: number | null
  currency: 'EUR'
  service_period_months: number | null
  active: boolean
  display_rank: number
  icon: CatalogueIcon
  created_at: string
  updated_at: string
}

/** One step of an item's price history (GET /api/v1/catalogue/{id}/price-history), newest first. */
export interface PriceEntry {
  at: string
  event: 'catalogue.created' | 'catalogue.price_changed'
  by_name: string | null
  /** The values from `at` on. Events from before the purchase price existed have none. */
  purchase_price_cents: number | null
  accounting_price_cents: number | null
  service_period_months: number | null
  /** The values replaced; null for catalogue.created. */
  before_purchase_cents: number | null
  before_accounting_cents: number | null
  before_service_months: number | null
}

export interface CatalogueItemInput {
  name: string
  details: string
  size_group: SizeGroup
  purchase_price_cents: number | null
  accounting_price_cents: number | null
  service_period_months: number | null
  active: boolean
  display_rank?: number
  /** Omitted is 'other'. */
  icon?: CatalogueIcon
}

export interface ItemSetLine {
  catalogue_item_id: string
  default_quantity: number
  display_order: number
}

export interface ItemSet {
  id: string
  name: string
  description: string
  active: boolean
  lines: ItemSetLine[]
  created_at: string
  updated_at: string
}

/** Lines are sent in display order. */
export interface ItemSetInput {
  name: string
  description: string
  active: boolean
  lines: { catalogue_item_id: string; default_quantity: number }[]
}

export interface ResolvedEmployee {
  id: string
  first_name: string
  last_name: string
  full_name: string
  code: string | null
  height_cm: number | null
  clothing_size: number | null
  shoe_size: string | null
}

/** A resolved working line (algorithm A): a preview of current data. */
export interface ResolvedLine {
  catalogue_item_id: string
  item_name: string
  item_details: string
  size_group: SizeGroup | ''
  size: string | null
  size_suggested: boolean
  size_missing: boolean
  quantity: number
  accounting_price_cents: number | null
  currency: string
  service_period_months: number | null
  price_missing: boolean
  unavailable: boolean
}

export interface Resolution {
  employee: ResolvedEmployee
  lines: ResolvedLine[]
  orderable: boolean
}

export interface ResolveInput {
  employee_id: string
  lines: { catalogue_item_id: string; quantity: number }[]
}

export type OrderStatus = 'ORDERED' | 'GIVEN'
/** IN_PERSON: confirmed by the employee on a staff member's device at the counter (hand-over mode). */
export type ConfirmationMethod = 'ELECTRONIC' | 'PAPER' | 'IN_PERSON'

/** An immutable snapshot line: every value as displayed at Mark as Ordered. */
export interface OrderLine {
  id: string
  line_no: number
  catalogue_item_id: string
  item_name: string
  item_details: string
  size_group: SizeGroup
  size: string | null
  quantity: number
  /** Null when the item had none, or the line predates purchase prices. */
  purchase_price_cents: number | null
  /** The price the order shows and totals. */
  accounting_price_cents: number
  currency: 'EUR'
  service_period_months: number
}

/** A stored order. Employee and user names are snapshots, not live values. */
export interface Order {
  id: string
  record_number: string
  employee_id: string
  employee_first_name: string
  employee_last_name: string
  employee_code: string | null
  status: OrderStatus
  ordered_at: string
  prepared_by_user_id: string
  prepared_by_name: string
  given_at: string | null
  given_by_user_id: string | null
  given_by_name: string | null
  confirmation_method: ConfirmationMethod | null
  updated_at: string
  /** The confirmation wording the order was placed under; its record keeps that wording. */
  receipt_text_version: string
  lines: OrderLine[]
  total_cents: number
}

/** Mark as Ordered: only items, quantities and sizes; the server copies the rest. */
export interface MarkAsOrderedInput {
  employee_id: string
  lines: { catalogue_item_id: string; quantity: number; size: string | null }[]
}

/** A History row: a stored order plus usage time (GIVEN only). */
export interface ListedOrder extends Order {
  usage_months: number | null
}

export interface OrderPage {
  orders: ListedOrder[]
  page: number
  page_size: number
  total: number
}

export type HistorySort = 'date' | 'record' | 'employee' | 'status' | 'usage' | 'total'
export type SortDir = 'asc' | 'desc'

/** History filters; omitted fields do not filter. Dates are YYYY-MM-DD in the organisation timezone. */
export interface HistoryQuery {
  employee_id?: string
  /** Orders with a line for this catalogue item. */
  catalogue_item_id?: string
  /** The one order with this record number, as typed: "WE-000004", "we4" or "4". */
  record?: string
  status?: OrderStatus
  from?: string
  to?: string
  /** Column to order by; the default is date, newest activity first. */
  sort?: HistorySort
  /** Omitted: descending for date, ascending otherwise. Ties fall back to newest activity. */
  dir?: SortDir
  page?: number
  page_size?: number
}

export interface Settings {
  timezone: string
  currency: 'EUR'
  /** The supplier's WhatsApp group, which Copy for WhatsApp opens for order messages; null when not set. */
  supplier_chat: SupplierChat | null
}

/** A WhatsApp group: its name as staff know it and its invite link (https://chat.whatsapp.com/<code>). */
export interface SupplierChat {
  name: string
  link: string
}

/** Sets the supplier's group; both empty clears it. The server tidies the link. */
export interface SupplierChatInput {
  name: string
  link: string
}

export interface ReceiptLine {
  line_no: number
  item_name: string
  item_details: string
  size: string | null
  quantity: number
  /** The line's accounting price; the record keeps this key (it is part of the document hash). */
  unit_price_cents: number
  total_cents: number
  currency: 'EUR'
  service_period_months: number
}

/** The locked Items Given Record, built only from the order snapshot. */
export interface Receipt {
  record_number: string
  employee_first_name: string
  employee_last_name: string
  employee_code: string | null
  ordered_at: string
  prepared_by_name: string
  lines: ReceiptLine[]
  total_cents: number
  currency: 'EUR'
  text_version: string
  confirmation_title_en: string
  confirmation_text_en: string
  confirmation_title_ru: string
  confirmation_text_ru: string
}

export interface OrderRecord {
  /** Absent on the public confirmation routes. */
  order_id?: string
  receipt: Receipt
  document_hash: string
  status: OrderStatus
  given_at: string | null
  given_by_name: string | null
  confirmation_method: ConfirmationMethod | null
  confirmation: { method: ConfirmationMethod; confirmed_at: string | null; confirmed_name: string | null } | null
  /** The employee's preferred language now, for the confirmation page to open in; not part of the record. */
  employee_language: Language | null
}

export interface ConfirmationLink {
  url: string
  expires_at: string
}

/** The administrator's dashboard (GET /api/v1/dashboard, admins only). Money and items come from order snapshots. */
export interface Dashboard {
  generated_at: string
  /** The organisation's timezone; months and day counts follow its calendar. */
  timezone: string
  awaiting: {
    /** ORDERED orders: ordered, receipt not yet confirmed. */
    orders: number
    value_cents: number
    oldest_days: number | null
    /** The longest waiting, oldest first. */
    longest: DashboardWaiting[]
  }
  /** Twelve calendar months, oldest first; the last is the current month. */
  months: DashboardMonth[]
  /** The previous month up to the same day and time of month as now: what the current month so far is compared with. */
  previous_to_date: DashboardMonth
  /** The last day of the previous month that previous_to_date covers; 0 on the first instant of a month, when it covers nothing. */
  through_day: number
  confirmation: {
    window_days: number
    given: number
    electronic: number
    paper: number
    /** Confirmed on a staff device at the counter (hand-over mode). */
    in_person: number
    /** Median days from ordered to given, one decimal; null when none were given. */
    median_days: number | null
  }
  /** Items by quantity given over the twelve months. */
  top_items: { catalogue_item_id: string; item_name: string; quantity: number; value_cents: number }[]
  /** Items whose service period has ended or ends within due_soon_days, and not already reordered. */
  replacements: { due_soon_days: number; overdue: number; due_soon: number; next: DashboardReplacement[] }
  setup: {
    employees: number
    /** No shoe size, or neither a clothing size nor a height. */
    employees_missing_sizes: number
    catalogue_active: number
    /** Active items without a price or service period: Mark as Ordered refuses them. */
    catalogue_unpriced: number
    item_sets_active: number
    users: number
    admins: number
  }
}

export interface DashboardWaiting {
  order_id: string
  record_number: string
  employee_id: string
  employee_name: string
  ordered_at: string
  days: number
  value_cents: number
}

export interface DashboardMonth {
  /** YYYY-MM */
  month: string
  ordered_orders: number
  ordered_cents: number
  given_orders: number
  given_items: number
  given_cents: number
}

export interface DashboardReplacement {
  employee_id: string
  employee_name: string
  employee_code: string | null
  catalogue_item_id: string
  item_name: string
  size: string | null
  /** The quantity given on that line; a reorder starts from it. */
  quantity: number
  order_id: string
  record_number: string
  given_at: string
  due_at: string
  overdue: boolean
}

/**
 * The employee role's dashboard (GET /api/v1/dashboard/employee, that role
 * only): the signed-in user's own orders, and what to order next.
 */
export interface EmployeeDashboard {
  generated_at: string
  timezone: string
  /** The user's ORDERED orders. */
  awaiting: {
    orders: number
    items: number
    value_cents: number
    /** Orders whose employee has no usable confirmation link: never created, or expired or revoked. */
    no_link: number
    link_expired: number
    oldest_days: number | null
    /** The longest waiting, oldest first. */
    longest: EmployeeDashboardWaiting[]
  }
  /** The user's orders per month, oldest first: ordered by date ordered, given by date given. */
  months: EmployeeDashboardMonth[]
  /** The previous month up to the same day and time of month as now: what the current month so far is compared with. */
  previous_to_date: EmployeeDashboardMonth
  /** The last day of the previous month that previous_to_date covers; 0 on the first instant of a month, when it covers nothing. */
  through_day: number
  /** The user's orders most recently given, newest first. */
  recently_given: {
    order_id: string
    record_number: string
    employee_id: string
    employee_name: string
    given_at: string
    method: ConfirmationMethod
    items: number
    value_cents: number
  }[]
  /** Organisation-wide, as on the administrator's dashboard. */
  replacements: Dashboard['replacements']
  /** Live employees without a shoe size, or without both a clothing size and a height. */
  missing_sizes: {
    employees: number
    list: { employee_id: string; employee_name: string; employee_code: string | null; clothing: boolean; shoes: boolean }[]
  }
}

export interface EmployeeDashboardMonth {
  /** YYYY-MM */
  month: string
  ordered: number
  given: number
  given_items: number
}

export interface EmployeeDashboardWaiting extends DashboardWaiting {
  items: number
  link: 'NONE' | 'ACTIVE' | 'EXPIRED'
  /** Set for an active link. */
  link_expires_at: string | null
}

export interface ManagerDashboardMonth {
  /** YYYY-MM */
  month: string
  orders: number
  items: number
  value_cents: number
}

/** The manager's dashboard (GET /api/v1/dashboard/manager, managers only): items, prices and purchasing. */
export interface ManagerDashboard {
  generated_at: string
  timezone: string
  /** Everything on ORDERED orders: ordered, not yet given out. */
  on_order: { orders: number; items: number; value_cents: number }
  /** Twelve calendar months by ordered_at, oldest first; the last is the current month. */
  months: ManagerDashboardMonth[]
  /** The previous month up to the same day and time of month as now: what the current month so far is compared with. */
  previous_to_date: ManagerDashboardMonth
  /** The last day of the previous month that previous_to_date covers; 0 on the first instant of a month, when it covers nothing. */
  through_day: number
  /** Items by value ordered over the twelve months. */
  spend_by_item: { catalogue_item_id: string; item_name: string; quantity: number; value_cents: number }[]
  /** Replacements due within `days` (overdue included) and not already on order, costed at current prices. */
  forecast: {
    days: number
    items: number
    estimated_cents: number
    /** Quantity whose item has no current price (or is inactive), left out of estimated_cents. */
    unpriced: number
    lines: ManagerForecastLine[]
  }
  price_changes: ManagerPriceChange[]
  catalogue: {
    active: number
    inactive: number
    unpriced: { id: string; name: string }[]
    /** Active, priced items on no order in the twelve months. */
    not_ordered: { id: string; name: string }[]
  }
  /** Active item sets with lines Apply Item Set will flag. */
  item_sets: { id: string; name: string; inactive: number; unpriced: number }[]
  /** Live employees by the size Create Order would use (saved, or suggested from height). */
  sizes: {
    clothing: { size: string; employees: number }[]
    shoes: { size: string; employees: number }[]
    no_clothing: number
    no_shoes: number
    suggested: number
  }
}

export interface ManagerForecastLine {
  catalogue_item_id: string
  item_name: string
  quantity: number
  employees: number
  accounting_price_cents: number | null
  estimated_cents: number | null
  overdue: number
}

export interface ManagerPriceChange {
  catalogue_item_id: string
  item_name: string
  at: string
  by_name: string | null
  /** Null for events from before the purchase price existed. */
  before_purchase_cents: number | null
  after_purchase_cents: number | null
  before_accounting_cents: number | null
  after_accounting_cents: number | null
  before_service_months: number | null
  after_service_months: number | null
}

/**
 * The database backups (GET /api/v1/backups, administrators only), as the
 * backup agent records them. stale, agent_offline and last_run_failed are the
 * server's verdicts the screen warns with.
 */
export interface BackupStatus {
  generated_at: string
  /** The organisation's timezone, which times are shown in. */
  timezone: string
  /** The agent that reported last; null when none ever has. */
  agent: BackupAgent | null
  /** The newest successful backup; null when there is none. */
  last_success: BackupRun | null
  /** The newest 30 runs, newest first. */
  runs: BackupRun[]
  /** Successful backups whose file is still stored. */
  kept: { count: number; bytes: number }
  /** No successful backup, or the newest is older than the schedule allows. */
  stale: boolean
  /** No agent, or none reported in the last 15 minutes. */
  agent_offline: boolean
  last_run_failed: boolean
}

export interface BackupAgent {
  name: string
  /** As configured, e.g. "0 3 * * *" (cron). */
  schedule: string
  timezone: string
  interval_seconds: number
  /** Where backups go, without credentials, e.g. "file:///backups" or "s3://bucket (fra1.digitaloceanspaces.com)". */
  target: string
  /** E.g. "14 days, at least 7". */
  retention: string
  encrypted: boolean
  version: string
  next_run_at: string | null
  last_seen_at: string
}

export interface BackupRun {
  id: string
  started_at: string
  finished_at: string
  duration_ms: number
  status: 'succeeded' | 'failed'
  /** Empty on success; the agent's message (English) on failure. */
  error: string
  size_bytes: number
  server_version: string
  tool_version: string
  target: string
  key: string
  encrypted: boolean
  /** Retention has deleted the file. */
  pruned: boolean
}

/** The record types the API records changes to (entity_type). */
export type AuditEntityType = 'user' | 'role' | 'employee' | 'catalogue_item' | 'item_set' | 'order' | 'asset' | 'settings' | 'access_review' | 'audit_log'

/** Where a change was made. */
export type AuditSource = 'workwear' | 'admin' | 'api' | 'public_link' | 'system'

/** The records with a History of their own (GET /api/v1/audit-events/{record}/{id}). */
export type AuditRecordKind = 'employees' | 'catalogue' | 'orders' | 'assets' | 'users'

/**
 * One recorded change (GET /api/v1/audit-events). `event` is one of
 * AUDIT_EVENTS, typed as a string since a newer API may record one this
 * client does not know yet.
 */
export interface AuditEntry {
  id: string
  occurred_at: string
  event: string
  area: string
  entity_type: AuditEntityType
  entity_id: string
  /** The record's name now (an employee's name, an order's record number); null when unknown. */
  entity_label: string | null
  /** The record was deleted since. */
  entity_deleted: boolean
  /** Null for a change made through a public confirmation link or by the system. */
  actor_id: string | null
  actor_name: string | null
  /** Null on changes recorded before the source was. */
  source: AuditSource | null
  request_id: string | null
  session_id: string | null
  /** The browser of that sign-in, while it is kept (30 days after it ends). */
  session_user_agent: string | null
  /** The changed fields before and after; their shape depends on the event. */
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}

/** One page of the Audit log; `next` continues it (null on the last page). */
export interface AuditPage {
  events: AuditEntry[]
  next: string | null
}

/** The Audit log's filters, all optional; from and to are days in the organisation's timezone. */
export interface AuditQuery {
  area?: string
  event?: string
  actor?: string
  entity_type?: AuditEntityType
  entity_id?: string
  from?: string
  to?: string
  after?: string
  page_size?: number
}

/**
 * One security event (GET /api/v1/security/events): a sign-in, a failed
 * attempt, a confirmed password or a session ending. `kind` is one of
 * SECURITY_KINDS and `reason` one of SECURITY_REASONS, typed as strings since
 * a newer API may record one this client does not know yet.
 */
export interface SecurityEntry {
  id: string
  occurred_at: string
  kind: string
  /** Why it failed, or why the session ended; null otherwise. */
  reason: string | null
  /** The account; null for an attempt at an email nobody has. */
  user_id: string | null
  user_name: string | null
  user_email: string | null
  /** The start of the hash of the email an attempt named, so attempts at one unknown email can be told apart. */
  email_ref: string | null
  /** The signed-in user who made it happen, when not the account itself (an administrator ending a session). */
  actor_id: string | null
  actor_name: string | null
  session_id: string | null
  ip: string | null
  user_agent: string | null
  request_id: string | null
  source: AuditSource | null
}

/** One page of security events; `next` continues it (null on the last page). */
export interface SecurityPage {
  events: SecurityEntry[]
  next: string | null
}

/** The security events' filters, all optional; from and to are days in the organisation's timezone. */
export interface SecurityQuery {
  kind?: string
  user?: string
  from?: string
  to?: string
  after?: string
  page_size?: number
}

/** A user's live session, as Security lists everyone's (GET /api/v1/security/sessions). */
export interface LiveSession {
  id: string
  user_id: string
  user_name: string
  user_email: string
  keep_signed_in: boolean
  created_at: string
  last_used_at: string
  /** When it ends if not used before. */
  expires_at: string
  user_agent: string
  ip: string
}

/** A role as the access review names it; key is set on the built-in ones. */
export interface ReviewRole {
  id: string
  key: RoleKey | null
  name: string
}

/** One account in the access review. */
export interface ReviewUser {
  id: string
  name: string
  email: string
  is_active: boolean
  created_at: string
  /** Null when no sign-in is recorded. */
  last_sign_in_at: string | null
  live_sessions: number
  roles: ReviewRole[]
  /** What the roles allow together; keys this client does not know are left in. */
  permissions: string[]
  /** One of ACCESS_FLAGS each. */
  flags: string[]
}

/** The access review (GET /api/v1/security/access-review). */
export interface AccessReview {
  users: ReviewUser[]
  /** Roles no live user holds. */
  unused_roles: ReviewRole[]
  /** The latest Mark as reviewed; null before the first. */
  last_review: { at: string; by_id: string | null; by_name: string | null; event_id: string } | null
  dormant_after_days: number
}

/** Where an error happened: the API answered 5xx, a handler panicked, or an app caught one in the browser. */
export type ErrorKind = 'server' | 'panic' | 'client'

/** One row of System's error list: one kind of error, its occurrences counted (GET /api/v1/system/errors). */
export interface ErrorEvent {
  id: string
  fingerprint: string
  kind: ErrorKind
  /** The route pattern ("GET /api/v1/orders/{id}"), or the page's path for an app's error. */
  route: string
  method: string
  status: number | null
  message: string
  stack: string
  source: AuditSource | null
  first_seen: string
  last_seen: string
  count: number
  /** The latest occurrence's request: the reference people quote. */
  last_request_id: string | null
  last_user_id: string | null
  last_user_name: string | null
  last_user_agent: string | null
}

export interface ErrorPage {
  errors: ErrorEvent[]
  next: string | null
}

export interface ErrorQuery {
  kind?: ErrorKind
  after?: string
  page_size?: number
}

/** One 5-minute bucket of the API's requests. */
export interface RequestPoint {
  at: string
  requests: number
  errors: number
  p95_ms: number
}

export interface RouteStat {
  route: string
  requests: number
  errors: number
  p50_ms: number
  p95_ms: number
}

/** The API's requests over the last 24 hours, kept in its memory since it started. */
export interface RequestWindow {
  since: string
  requests: number
  errors: number
  p50_ms: number
  p95_ms: number
  last_hour: { requests: number; errors: number }
  series: RequestPoint[]
  slowest: RouteStat[]
}

export interface DatabaseStatus {
  version: string
  /** The role the API connects as; owner_rights when it could switch the trails' triggers off (not ppe_app). */
  user: string
  owner_rights: boolean
  bytes: number
  /** The size at least 30 days ago, or the earliest kept; null before the first. */
  earlier: { day: string; bytes: number } | null
  tables: { name: string; bytes: number; rows: number }[]
  connections: Record<string, number>
  max_connections: number
  oldest_transaction_seconds: number
  latest_migration: { file: string; applied_at: string } | null
}

/** System's status (GET /api/v1/system/status, system.read). */
export interface SystemStatus {
  service: { commit: string; go_version: string; started_at: string; ready: boolean; problem?: 'database' | 'migrations' }
  requests: RequestWindow
  database: DatabaseStatus
  pool: { acquired: number; idle: number; max: number; waits: number } | null
  retention: {
    audit_events_days: number
    auth_events_days: number
    error_events_days: number
    ended_session_days: number
    last_run: {
      at: string | null
      auth_events_deleted: number
      error_events_deleted: number
      audit_events_deleted: number
      days_sealed: number
      failed: boolean
    }
  }
  timezone: string
}

/** A thing that needs an administrator, worst first; `key` is one of ATTENTION_KEYS. */
export interface AttentionItem {
  key: string
  severity: 'critical' | 'warning' | 'info'
  count?: number
  percent?: number
  days?: number
  since?: string
}

/** Administration's Overview (GET /api/v1/overview): areas the reader may not see are null. */
export interface Overview {
  attention: AttentionItem[]
  users: { active: number; inactive: number } | null
  security: {
    copied_sign_ins: number
    failed_last_hour: number
    most_at_one_account: number
    sign_ins_today: number
    failed_today: number
    signed_in: number
    devices: number
    last_review: string | null
  } | null
  requests: {
    since: string
    requests: number
    errors: number
    p95_ms: number
    new_error_kinds: number
    database_bytes: number
  } | null
  backups: { last_success_at: string | null; stale: boolean; agent_offline: boolean; last_run_failed: boolean } | null
}

/** An error an app caught in the browser (POST /api/v1/client-errors). */
export interface ClientErrorReport {
  message: string
  stack?: string
  /** The page's path; the API replaces its ids. */
  path: string
}

/** What checking the Audit log's seals found (POST /api/v1/audit-events/verify). */
export interface AuditVerification {
  checked_at: string
  ok: boolean
  /** Seals checked, and the events counted in them. */
  days: number
  rows: number
  /** Sealed days whose events retention deleted: their seals' chain only is checked. */
  purged_days: number
  first_day: string | null
  last_day: string | null
  /** Events since the last sealed day, not sealed yet. */
  unsealed: number
  /** With timestamps on: seals whose trusted timestamp checked out, the newest one's day, and those still waiting (overdue: over a day). */
  stamped: number
  last_stamped: string | null
  stamps_waiting: number
  stamps_overdue: number
  /**
   * The first day that did not match: its count, its events, its place in the chain, a missing seal, or its
   * timestamp (not a trusted one of the seal, made too late, or missing past the grace).
   */
  mismatch: {
    day: string
    problem: 'rows' | 'hash' | 'chain' | 'gap' | 'stamp' | 'late' | 'unstamped'
    sealed_rows: number
    found_rows: number
  } | null
}

/** The Audit log's seals, latest check and retention (GET /api/v1/audit-events/integrity). */
export interface AuditIntegrity {
  /** The latest check, by the hourly upkeep or Verify; null until the first since the API started. */
  verification: AuditVerification | null
  sealed_days: number
  first_sealed: string | null
  last_sealed: string | null
  last_sealed_at: string | null
  retention_days: number
  purges: { id: string; before_day: string; rows: number; purged_at: string }[]
  /** The timestamp service anchoring the seals (empty when off), the seals it stamped, and the newest stamp's day and time. */
  tsa: string
  stamped_days: number
  last_stamped: string | null
  last_stamped_at: string | null
}

/** A role as Usage names it; key is set on the built-in ones. */
export interface UsageRole {
  id: string
  key: RoleKey | null
  name: string
}

/** Administration's Usage screen (GET /api/v1/usage, usage.read). Daily series follow `days`, weekly ones `weeks`. */
export interface UsageReport {
  /** The last 30 days, oldest first (YYYY-MM-DD, organisation's timezone). */
  days: string[]
  /** The Mondays of the last 12 weeks, oldest first. */
  weeks: string[]
  active: {
    total: number[]
    by_app: Record<string, number[]>
    by_role: { role: UsageRole; values: number[] }[]
    last_7: number
    last_30: number
    /** Active accounts. */
    users: number
  }
  sign_ins: number[]
  failed_sign_ins: number[]
  /** Browsers used in the last 30 days, by the people using them. */
  devices: { user_agent: string; people: number }[]
  user_languages: Record<string, number>
  /** "" counts employees with no language recorded. */
  employee_languages: Record<string, number>
  /** Changes per Audit log area, per week. */
  changes: { area: string; counts: number[] }[]
  top_people: { id: string; name: string; changes: number }[]
  /** Confirmation links created in the last 90 days. */
  funnel: { created: number; opened: number; confirmed: number; waiting: number; expired: number; replaced: number }
  /** The Dashboard's setup figures, one sample a day, the last 90 days. */
  quality: {
    day: string
    employees: number
    employees_missing_sizes: number
    catalogue_active: number
    catalogue_unpriced: number
    item_sets_active: number
  }[]
  timezone: string
}

// Company Assets (docs/specs/asset-service.md): SIM cards and individual
// equipment and furniture, and their assignments to employees.

/** SIM for a SIM card, EQUIPMENT for equipment and furniture. */
export type AssetKind = 'SIM' | 'EQUIPMENT'

/** An equipment asset's kind of item; each has its inventory number prefix (PC, PH, DRV, FUR, AST). */
export type AssetCategory = 'COMPUTER' | 'PHONE' | 'EXTERNAL_DRIVE' | 'FURNITURE' | 'OTHER'

/** A SIM card's connection status, as the provider confirmed it. */
export type ConnectionStatus = 'NOT_ACTIVATED' | 'ACTIVE' | 'BLOCKED'

/** Where an asset is; it follows from its open assignment. */
export type AssetLocation = 'OFFICE' | 'WITH_EMPLOYEE' | 'UNKNOWN'

/** What Mark as Not Returned says of the asset. */
export type Whereabouts = 'WITH_EMPLOYEE' | 'UNKNOWN'

/** The prefixes of suggested inventory numbers. */
export type InventoryPrefix = 'SIM' | 'PC' | 'PH' | 'DRV' | 'FUR' | 'AST'

/** One giving of an asset to one employee, open until it is returned. */
export interface AssetAssignment {
  id: string
  asset_id: string
  employee_id: string
  /** The employee's name now. */
  employee_name: string
  /** YYYY-MM-DD, the actual day. */
  given_date: string
  given_by_user_id: string
  created_at: string
  comment: string
  /** The assignment form's data as printed; null when the asset needs none. */
  form: AssignmentForm | null
  form_template_version: string | null
  document_hash: string | null
  paper_form_signed: boolean
  not_returned_at: string | null
  not_returned_by_user_id: string | null
  not_returned_comment: string | null
  whereabouts: Whereabouts | null
  returned_date: string | null
  returned_at: string | null
  returned_by_user_id: string | null
  return_comment: string | null
  /** Whole days from the given date to the return date, or to today while open. */
  days_held: number
}

/** The data an assignment form shows, copied when the asset is given. */
export interface AssignmentForm {
  template_version: string
  kind: AssetKind
  employee: { first_name: string; last_name: string; code: string | null }
  inventory_no: string
  category: AssetCategory | null
  name: string | null
  serial_no: string | null
  sim_no: string | null
  phone_no: string | null
  provider: string | null
  plan: string | null
  non_return_value_cents: number
  currency: 'EUR'
  given_date: string
}

/** An asset as the register lists it: with where it is and its open assignment. */
export interface Asset {
  id: string
  kind: AssetKind
  category: AssetCategory | null
  inventory_no: string
  name: string | null
  serial_no: string | null
  /** As typed, leading zeros included. */
  sim_no: string | null
  phone_no: string | null
  provider: string | null
  plan: string | null
  non_return_value_cents: number | null
  currency: 'EUR'
  connection_status: ConnectionStatus | null
  /** YYYY-MM-DD: when a SIM card arrived from the provider. */
  received_date: string | null
  comment: string
  created_at: string
  updated_at: string
  location: AssetLocation
  open_assignment: AssetAssignment | null
  /** Giving it needs a signed form: SIM cards and computer equipment (spec, open decision 6). */
  needs_form: boolean
}

/** An asset's page: the asset and every assignment, newest first. */
export interface AssetDetail extends Asset {
  assignments: AssetAssignment[]
}

/** One of an employee's assignments, with its asset (GET /api/v1/assets/by-employee/{id}). */
export interface HeldAsset extends AssetAssignment {
  asset: Omit<Asset, 'location' | 'open_assignment' | 'needs_form'>
}

/** Add SIM Card / Add Asset and Edit: an asset's details. Edit sends no kind or status. */
export interface AssetInput {
  category?: AssetCategory | null
  inventory_no: string
  name?: string | null
  serial_no?: string | null
  sim_no?: string | null
  phone_no?: string | null
  provider?: string | null
  plan?: string | null
  non_return_value_cents?: number | null
  received_date?: string | null
  comment: string
}

export interface CreateAssetInput extends AssetInput {
  kind: AssetKind
  /** A SIM card's status at registration; Not Activated when left out. */
  connection_status?: ConnectionStatus
}

/** The register's sorts. */
export type AssetSort = 'inventory' | 'name' | 'status' | 'holder' | 'given'

/** The register's filters (GET /api/v1/assets); empty ones are left out. */
export interface AssetQuery {
  kind: AssetKind
  q?: string
  location?: AssetLocation
  /** Someone holds it, whereabouts known or not: the With Employees tile. */
  held?: boolean
  employee_id?: string
  provider?: string
  category?: AssetCategory
  status?: ConnectionStatus
  not_returned?: boolean
  sort?: AssetSort
  dir?: 'asc' | 'desc'
  page?: number
  page_size?: number
}

export interface AssetPage {
  assets: Asset[]
  page: number
  page_size: number
  total: number
}

/** The register's tiles. They overlap: never add them up. */
export interface AssetSummary {
  total: number
  in_office: number
  with_employees: number
  not_returned: number
  /** The providers of the kind's assets, for the filter. */
  providers: string[]
}

/** The assignment form's inputs: the plan or value only when the asset lacks them. */
export interface AssignmentFormInput {
  employee_id: string
  given_date: string
  plan?: string | null
  non_return_value_cents?: number | null
}

/** Give SIM Card / Give Asset; form_hash is the printed preview's document hash. */
export interface GiveAssetInput extends AssignmentFormInput {
  comment: string
  paper_form_signed: boolean
  form_hash: string
}

/** Preview Form, Print Form, and a stored form for reprinting. */
export interface AssignmentFormResult {
  form: AssignmentForm
  document_hash: string
}
