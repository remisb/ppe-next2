import type { PhotoUse } from './photo-uses.ts'
// Wire types, mirroring the JSON the Go handlers write. Money is integer cents
// (EUR); sizes are the vocabulary codes from GET /api/v1/sizes, except an
// employee's clothing size, which is the EU number itself (44–66, even). An
// order line holds a clothing size as its code ("54"), or as a letter (S … 3XL)
// when it was ordered before clothing sizes became numbers.

import type { AppIcon } from './app-icons.ts'
import type { Permission } from './permissions.ts'

/** A built-in role's key; a role an administrator added has none. */
export type RoleKey = 'admin' | 'manager' | 'employee' | 'equipment' | 'testers' | 'personnel'
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
  group: 'administration' | 'launcher' | 'workwear' | 'personnel' | 'dashboards'
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
  /** The employee's default photo (see EmployeePhoto); null when they have none. */
  default_photo_id: string | null
  /**
   * From an identity document saved with Add to Employee Record (Personnel files,
   * ADR 0007), else null; read only: EmployeeInput never sets them.
   */
  birth_date: string | null
  /** An ICAO code, as on the document (LTU). */
  nationality: string | null
  sex: 'M' | 'F' | 'X' | null
  created_at: string
  updated_at: string
}

/** One photo of an employee; GET /employee-photos/{employee}/{id} sends the picture. */
export interface EmployeePhoto {
  id: string
  employee_id: string
  file_name: string
  content_type: 'image/jpeg' | 'image/png'
  size_bytes: number
  sha256: string
  uses: PhotoUse[]
  is_default: boolean
  uploaded_at: string
  /** Coloured by AI from a document's portrait (ADR 0007): labelled AI-coloured everywhere, never the ID badge's. */
  ai_generated: boolean
  consent?: { by: 'verbal' | 'written'; recorded_by_user_id: string; at: string }
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

/**
 * How alike two employees' names are: the same words in any order, accents or
 * script (same_name), or at least two words alike allowing a slip of a letter (similar_name).
 */
export type EmployeeMatchKind = 'same_name' | 'similar_name'

/** POST /employees/similar: an employee whose name is like the one typed. */
export interface EmployeeMatch {
  employee: Employee
  kind: EmployeeMatchKind
}

/** GET /employees/possible-duplicates: two live employees who may be one person, the older first. */
export interface EmployeePair {
  a: Employee
  b: Employee
  kind: EmployeeMatchKind
}

/** GET /employees/{keep}/merge/{remove}: what the record removed has, that moves to the one kept. */
export interface EmployeeMergePreview {
  keep: Employee
  remove: Employee
  contents: {
    orders: string[]
    /** Its company assets' assignments, open or returned. */
    assignments: string[]
    /** Of those, the ones still held. */
    open_assignments: number
    photos: string[]
    keep_has_documents: boolean
    /** A record with identity documents cannot be the one removed: keep it instead. */
    remove_has_documents: boolean
  }
}

/** Body of PUT /employees/{id}/sizes: all three are replaced. */
export interface EmployeeSizesInput {
  height_cm: number | null
  clothing_size: number | null
  shoe_size: string | null
}

/** An item's picture; the web app draws each one. Each is a CataloguePicture, which gives its items their size group. */
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
  /** The picture's size group (read only): the item has none of its own. */
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

/** A picture (GET /api/v1/catalogue/pictures): the category an item belongs to, which sets its size group. */
export interface CataloguePicture {
  id: string
  icon: CatalogueIcon
  size_group: SizeGroup
  /** Live items with this picture, active or not. */
  item_count: number
}

/** Body of PUT /api/v1/catalogue/pictures/{icon}. */
export interface CataloguePictureInput {
  size_group: SizeGroup
}

/** An item's size group is its picture's, so the body has none. */
export interface CatalogueItemInput {
  name: string
  details: string
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
  /**
   * GET /api/v1/orders/{id} alone, for an ORDERED order: the confirmation link it waits on (the latest
   * neither replaced nor used, expired or not); left out when there is none.
   */
  link?: WaitingLink
}

/** What the staff know of an order's confirmation link: when it was made, until when it works, and when the employee first opened it. */
export interface WaitingLink {
  created_at: string
  expires_at: string
  opened_at: string | null
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
  /** The company's name, which mail templates write ({{company.name}}); null when not set. */
  company_name: string | null
  /** The supplier's WhatsApp group, which Copy for WhatsApp opens for order messages; null when not set. */
  supplier_chat: SupplierChat | null
  /** The SIM providers Add SIM offers, in the administrator's order; empty when none are listed. */
  sim_providers: SimProvider[]
  /** The name of the one of sim_providers Add SIM chooses for a new card; null when there is none. */
  default_sim_provider: string | null
  /** The Non-return Value Add SIM fills in for a new card, in cents; null when there is none. */
  default_sim_non_return_value_cents: number | null
}

/**
 * A SIM card provider listed on Settings: its name as cards record it, the
 * address its activation and blocking emails go to, and the plan Add SIM fills
 * in for a new card of it and Give SIM for one of its cards without a plan.
 * email and default_plan are '' when not set.
 */
export interface SimProvider {
  name: string
  email: string
  default_plan: string
}

/**
 * Replaces the SIM providers; default names one of them, or '' for none; the
 * default Non-return Value is in cents, or null for none.
 */
export interface SimProvidersInput {
  providers: SimProvider[]
  default: string
  default_non_return_value_cents: number | null
}

/** A mail template's parts; fields are written {{key}}. cc is '' for no one. */
export interface MailText {
  to: string
  cc: string
  subject: string
  body: string
}

/** A value a mail template may write as {{key}}; label is what a missing one reads as ([label]), sample what the preview fills in. */
export interface MailField {
  key: string
  label: string
  sample: string
}

/** The keys of the use cases that prepare an email, each with one template. */
export type MailTemplateKey = 'sim.activation' | 'sim.blocking'

/**
 * A use case's mail template: its text, the fields it may use, the default it
 * is reset to, and the id its changes are recorded under (entity type
 * mail_template). updated_at is null while it is the default never saved.
 */
export interface MailTemplate extends MailText {
  key: MailTemplateKey
  fields: MailField[]
  default: MailText
  is_default: boolean
  entity_id: string
  updated_at: string | null
  updated_by_user_id: string | null
}

/** A prepared email, to copy into one's own: nothing is sent. missing lists the fields that had no value. */
export interface MailMessage extends MailText {
  missing: string[]
}

/** A SIM card's emails to its provider. */
export type SimEmailKind = 'activation' | 'blocking'

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
export type AuditEntityType =
  | 'user'
  | 'role'
  | 'employee'
  | 'catalogue_item'
  | 'catalogue_picture'
  | 'item_set'
  | 'order'
  | 'asset'
  | 'settings'
  | 'mail_template'
  | 'app'
  | 'access_review'
  | 'personnel_scan'
  | 'audit_log'

/** Where a change was made, by a name the apps word themselves. */
export type KnownAuditSource = 'workwear' | 'admin' | 'launcher' | 'api' | 'public_link' | 'system'

/** Where a change was made: a known source, or an app registered in App Launcher, by its slug. */
export type AuditSource = string

/** The records with a History of their own (GET /api/v1/audit-events/{record}/{id}). */
export type AuditRecordKind = 'employees' | 'catalogue' | 'item-sets' | 'orders' | 'assets' | 'users' | 'apps'

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
  /** The published app's build the latest occurrence came from. */
  app_version: string | null
}

export interface ErrorPage {
  errors: ErrorEvent[]
  next: string | null
  /** The first page's alone: the list's rows by kind, whatever kind it is filtered to. */
  counts?: Record<ErrorKind, number>
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
      /** Kept scans erased once expired. */
      scans_purged: number
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
  /** Whether a signed copy of the form was uploaded. */
  signed_copy_uploaded: boolean
  /** The uploads, newest first: only on an asset's page (AssetDetail). */
  signed_copies?: SignedCopy[]
}

/** One upload of a signed assignment form, a scan or a photo. The newest is the copy shown; earlier ones stay. */
export interface SignedCopy {
  id: string
  assignment_id: string
  file_name: string
  content_type: 'application/pdf' | 'image/jpeg' | 'image/png'
  size_bytes: number
  sha256: string
  uploaded_at: string
  uploaded_by_user_id: string
  /** The uploader's name now. */
  uploaded_by_name: string
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

/** Add SIM / Add Asset and Edit: an asset's details. Edit sends no kind or status. */
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

/** One card of a Scan SIMs batch: its SIM No. and, when its back was read, its PIN and PUK (both or neither; empty for none). */
export interface ScannedSimInput {
  sim_no: string
  pin: string
  puk: string
}

/** A Scan SIMs batch: what the cards share, chosen once, then the cards (at most 100). */
export interface SimBatchInput {
  provider: string
  plan?: string
  non_return_value_cents?: number
  received_date?: string
  comment: string
  cards: ScannedSimInput[]
}

/** What is wrong with a card of a batch; the apps word it. */
export type SimProblemCode = 'not_sim_no' | 'check_digit' | 'duplicate' | 'registered' | 'codes_incomplete' | 'pin' | 'puk'

/** One problem of one card, by its index in the batch. */
export interface SimProblem {
  index: number
  field: 'sim_no' | 'pin' | 'puk'
  code: SimProblemCode
  /** The SIM card in the register, for registered. */
  existing_id?: string
  /** The batch's other card with the same SIM No., for duplicate. */
  other?: number
}

/** One card a batch added. */
export interface AddedSim {
  id: string
  inventory_no: string
  sim_no: string
}

/** A SIM card's PIN and PUK, as printed on its carrier. */
export interface SimCodes {
  pin: string
  puk: string
}

/** The register's sorts. */
export type AssetSort = 'inventory' | 'name' | 'phone' | 'status' | 'holder' | 'given'

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
  /** Held on a form with no signed copy yet. */
  signed_copy?: 'missing'
  sort?: AssetSort
  dir?: 'asc' | 'desc'
  page?: number
  page_size?: number
}

/**
 * The SIM card register as a PDF list: the register's filters and sort, never
 * a page (every match is printed). It is in the reader's own language, which
 * the API reads from their account.
 */
export type SimCardsReportQuery = Omit<AssetQuery, 'kind' | 'employee_id' | 'category' | 'page' | 'page_size'>

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

/** Give SIM / Give Asset; form_hash is the printed preview's document hash. */
export interface GiveAssetInput extends AssignmentFormInput {
  comment: string
  paper_form_signed: boolean
  form_hash: string
}

/** Print Form, and a stored form for reprinting. */
export interface AssignmentFormResult {
  form: AssignmentForm
  document_hash: string
}

// App Launcher's registry (ADR 0006; GET /api/v1/launcher, /api/v1/apps).

export type AppKind = 'app' | 'shortcut'
export type AppGroup = 'workwear' | 'assets' | 'people' | 'admin'
/** Here: this site, with the user's sign-in. Linked: another site, with its own. */
export type AppTier = 'here' | 'linked'
export type AppStage = 'live' | 'pilot' | 'poc' | 'dev' | 'retired'

export interface AppNames {
  en: string
  lt: string
  ru: string
}

/** A tile: an app, opened by its address, or a shortcut to one screen inside an app. */
export interface LauncherApp {
  id: string
  slug: string
  kind: AppKind
  /** The slug of a shortcut's app; '' for an app. */
  parent: string
  group: AppGroup
  icon: AppIcon
  /** #rrggbb; white text on it passes 4.5:1. */
  color: string
  /** A path on this site, or a linked site's https address. */
  href: string
  tier: AppTier
  stage: AppStage
  names: AppNames
  /** Seen by holders of any of these; none: every signed-in user. */
  any_of: Permission[]
  position: number
  /** A published app: a deploy's publish to Preview moves Stable too. */
  stable_follows_deploys: boolean
  created_at: string
  updated_at: string
  updated_by_user_id: string | null
}

/** What Manage apps sends for a tile; the slug and kind are set once, on register. */
export interface AppInput {
  parent: string
  group: AppGroup
  icon: AppIcon
  color: string
  href: string
  tier: AppTier
  stage: AppStage
  names: AppNames
  any_of: Permission[]
}

export interface NewAppInput extends AppInput {
  slug: string
  kind: AppKind
}

/**
 * One user's launcher: the tiles they see, their pins among them, whether they
 * may see apps in testing, and for each published app (by slug) the channels
 * they see and the one they chose (none: Stable).
 */
export interface LauncherList {
  apps: LauncherApp[]
  pins: string[]
  preview: boolean
  channels: Record<string, AppChannel[]>
  choices: Record<string, string>
}

/** The policy a published version gets, named by its manifest (older builds: from the capabilities they declared). */
export type AppProfile = 'standard' | 'device'

/** One published build of an app (ADR 0006, phase 3), never changed once published. */
export interface AppVersion {
  id: string
  app_id: string
  /** YYYY.MM.DD-<commit> */
  version: string
  profile: AppProfile
  /** What builds declared before they named a profile; none for newer ones. */
  capabilities: string[]
  commit: string
  published_at: string
  /** null for a deploy's. */
  published_by_user_id: string | null
}

/** A name that points at one version of an app: stable, beta, preview or a variant. */
export interface AppChannel {
  id: string
  app_id: string
  /** stable, beta or preview. */
  name: 'stable' | 'beta' | 'preview'
  version_id: string
  version: string
  published_at: string
  updated_at: string
  updated_by_user_id: string | null
}

export interface AppReleases {
  versions: AppVersion[]
  channels: AppChannel[]
}

/** Points a channel at a version; a variant needs a label, the fixed channels have none. */
export interface ChannelInput {
  version: string
}

export type FeedbackRating = 'works' | 'confusing' | 'broken'
export type FeedbackDevice = 'phone' | 'tablet' | 'desktop'

export interface AppFeedbackInput {
  app: string
  rating: FeedbackRating
  text: string
  device: FeedbackDevice
  language: 'en' | 'lt' | 'ru'
}

export interface AppFeedback {
  id: string
  app_id: string
  user_id: string
  user_name: string
  rating: FeedbackRating
  text: string
  device: FeedbackDevice
  language: 'en' | 'lt' | 'ru'
  /** The published version the sender's tile opened; null for an app with no versions. */
  version: string | null
  created_at: string
}

/** One version in a published app's Trials view (ADR 0006, phase 5). */
export interface AppTrial {
  version: string
  published_at: string
  /** The channels opening it now, with a variant's label. */
  channels: AppChannel[]
  /** People who used it, and on how many days, over the last `days`. */
  people: number
  days: number
  /** Kinds of error last seen on it, and how often they came. */
  error_kinds: number
  errors: number
  feedback: { works: number; confusing: number; broken: number }
}

export interface AppTrials {
  days: number
  versions: AppTrial[]
}

// Personnel files: identity documents (ADR 0007, docs/specs/personnel-service.md).
// Nothing here ever carries a document's number, personal code or images:
// those open only with Show Document.

export type IdentityDocumentKind = 'passport' | 'id_card' | 'residence_permit'

/** A Document Copy's side: a passport's data page, a card's front and back, and the portrait. */
export type DocumentCopySide = 'page' | 'front' | 'back' | 'portrait'

/** An employee field a document may fill, with Add to Employee Record on. */
export type DocumentTake = 'names' | 'birth_date' | 'nationality' | 'sex'

/** An MRZ's problem or note: a code and the field it is about (@ppe/mrz's Issue). */
export interface MrzIssue {
  code: string
  field?: string
}

/** POST /api/v1/personnel/documents/check: what docs-import asks before Save. */
export interface DocumentCheckInput {
  /** The chosen employee; left out for a new one. */
  employee_id?: string
  mrz: string[]
  surname?: string
  given_names?: string
}

/** The API's reading of the lines, and what only it knows; never a value read. */
export interface DocumentCheck {
  valid: boolean
  problems: MrzIssue[]
  notes: MrzIssue[]
  needs_second_read: boolean
  /** The typed names against the MRZ's; '' when no surname was sent. */
  name_match: 'same' | 'truncated' | 'differs' | ''
  document_on_file: { employee_id: string; document_id: string } | null
  /** The employee the personal code belongs to, when not the chosen one. */
  other_employee: string | null
  /** For a new employee: live employees with the same names, or last name and birth date. */
  possible_duplicates: string[]
}

/** Save's "document" part (POST /api/v1/personnel/documents, multipart). */
export interface IdentityDocumentInput {
  employee: { id: string } | { new: { first_name: string; last_name: string; code?: string | null } }
  mrz: string[]
  kind: IdentityDocumentKind
  /** As printed, with diacritics. */
  surname: string
  given_names: string
  /** Not in the MRZ: typed, optional. */
  issued_on?: string
  place_of_birth?: string
  authority?: string
  add_to_employee_record: boolean
  take?: DocumentTake[]
}

/** Save's copies, JPEG, each at most 5 MB and 2400 px. */
export type DocumentCopies = Partial<Record<'copy_page' | 'copy_front' | 'copy_back' | 'portrait', Blob>>

/** An identity document as its summary shows it. */
export interface IdentityDocument {
  id: string
  employee_id: string
  kind: IdentityDocumentKind
  issuing_state: string
  issued_on: string | null
  expires_on: string
  on_employee_record: boolean
  copies: DocumentCopySide[]
  superseded_at: string | null
  created_at: string
  created_by_user_id: string
}

/** What anyone may know of a current document: the employee page's "valid until" line. */
export interface DocumentValidity {
  kind: IdentityDocumentKind
  issuing_state: string
  expires_on: string
}

/** What Show Document opens (POST /api/v1/personnel/documents/{id}/show): the sealed fields. */
export interface IdentityDocumentFields {
  number: string
  personal_code?: string
  mrz: string[]
  surname: string
  given_names: string
  birth_date?: string
  nationality: string
  sex?: 'M' | 'F' | 'X'
  place_of_birth?: string
  authority?: string
}

export interface ShownDocument {
  document: IdentityDocument
  fields: IdentityDocumentFields
}

/** A personnel file's retention: when employment ended, and a Legal Hold (ISO dates). */
export interface PersonnelRetention {
  employment_ended_on: string | null
  hold_until: string | null
  hold_reason: string | null
}

/** What names a kept scan, as Scan Document sends it; the MRZ lines are checked, never kept. */
export interface ScanMetaInput {
  surname: string
  given_names: string
  kind: IdentityDocumentKind
  /** Letters and digits, or '' when not read. */
  number: string
  mrz?: string[]
}

/** A kept scan, as Recent scans lists it (its maker's alone; deleted at expires_at). */
export interface KeptScan {
  id: string
  /** <Surname>_<Given>_<kind>.zip */
  file_name: string
  surname: string
  given_names: string
  kind: IdentityDocumentKind
  number: string
  pages: number
  bytes: number
  created_at: string
  expires_at: string
}

// Settings → AI and AI Usage (ADR 0007, docs/specs/ai-usage-service.md).

/** USD per million tokens of each kind. */
export interface AIPrices {
  input_text: number
  input_image: number
  output_text: number
  output_image: number
}

/** Settings → AI: the key is never sent, only which it is. */
export interface AISettings {
  enabled: boolean
  model: string
  quality: 'low' | 'medium' | 'high'
  prices: Record<string, AIPrices>
  /** The monthly budget in micro-dollars; null for none. */
  budget_micro_usd: number | null
  key: { last4: string; set_at: string; set_by_user_id: string } | null
  /** Whether this server can seal a key (API_SECRETS_KEY). */
  can_save_key: boolean
  spent_this_month_micro_usd: number
}

export interface AISettingsInput {
  enabled: boolean
  model: string
  quality: 'low' | 'medium' | 'high'
  prices: Record<string, AIPrices>
  budget_micro_usd: number | null
}

export type AIOperation = (typeof import('./ai.ts').AI_OPERATIONS)[number]

export interface AISum {
  calls: number
  cost_micro_usd: number
}

/** The AI Usage screen's figures: this month against the budget, the months, and the split over them. */
export interface AIUsageReport {
  this_month: AISum
  budget_micro_usd: number | null
  months: (AISum & { month: string })[]
  by_operation: (AISum & { key: string })[]
  /** key is the user's id, name their name. */
  by_user: (AISum & { key: string; name?: string })[]
  by_model: (AISum & { key: string })[]
}

/** One AI call as recorded: never its prompt, image or answer. */
export interface AICall {
  id: string
  at: string
  operation: AIOperation
  provider: string
  model: string
  outcome: 'ok' | 'failed' | 'refused'
  error_code?: string
  tokens: { input_text: number; input_image: number; output_text: number; output_image: number }
  cost_micro_usd: number
  prices: AIPrices
  duration_ms: number
  user_id: string
  user_name?: string
  source: string
  request_id: string
  provider_request_id?: string
  employee_id: string | null
}

export interface AICallsQuery {
  from?: string
  to?: string
  operation?: AIOperation
  user?: string
  outcome?: 'ok' | 'failed' | 'refused'
  limit?: number
  offset?: number
}
