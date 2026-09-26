// Wire types, mirroring the JSON the Go handlers write. Money is integer cents
// (EUR); sizes are the vocabulary codes from GET /api/v1/sizes.

export type Role = 'admin' | 'manager' | 'employee'
export type SizeGroup = 'CLOTHING' | 'SHOES' | 'NONE'

export interface User {
  id: string
  email: string
  name: string
  roles: Role[]
  is_active: boolean
  created_at: string
  updated_at: string
}

/** POST /api/v1/users. Password rules as in internal/domain/user: 8–72 bytes. */
export interface UserCreateInput {
  email: string
  name: string
  password: string
  roles: Role[]
}

/** PUT /api/v1/users/{id}: a full replace, so is_active is always sent. */
export interface UserUpdateInput {
  email: string
  name: string
  roles: Role[]
  is_active: boolean
}

export interface LoginResponse {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  expires_at: string
  user: User
}

export interface ClothingSize {
  code: string
  min_cm: number
  max_cm: number
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
  clothing_size: string | null
  shoe_size: string | null
  notes: string
  created_at: string
  updated_at: string
}

/** Body of POST /employees and PUT /employees/{id} (full replace). */
export interface EmployeeInput {
  first_name: string
  last_name: string
  code: string | null
  height_cm: number | null
  clothing_size: string | null
  shoe_size: string | null
  notes: string
}

/** Body of PUT /employees/{id}/sizes: all three are replaced. */
export interface EmployeeSizesInput {
  height_cm: number | null
  clothing_size: string | null
  shoe_size: string | null
}

export interface CatalogueItem {
  id: string
  name: string
  details: string
  size_group: SizeGroup
  unit_price_cents: number | null
  currency: 'EUR'
  service_period_months: number | null
  active: boolean
  display_rank: number
  created_at: string
  updated_at: string
}

export interface CatalogueItemInput {
  name: string
  details: string
  size_group: SizeGroup
  unit_price_cents: number | null
  service_period_months: number | null
  active: boolean
  display_rank?: number
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
  clothing_size: string | null
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
  unit_price_cents: number | null
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
export type ConfirmationMethod = 'ELECTRONIC' | 'PAPER'

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
  unit_price_cents: number
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
}

export interface ReceiptLine {
  line_no: number
  item_name: string
  item_details: string
  size: string | null
  quantity: number
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
  confirmation: {
    window_days: number
    given: number
    electronic: number
    paper: number
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
  months: { month: string; ordered: number; given: number; given_items: number }[]
  /** The user's orders most recently given, newest first. */
  recently_given: {
    order_id: string
    record_number: string
    employee_id: string
    employee_name: string
    given_at: string
    method: 'ELECTRONIC' | 'PAPER'
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

export interface EmployeeDashboardWaiting extends DashboardWaiting {
  items: number
  link: 'NONE' | 'ACTIVE' | 'EXPIRED'
  /** Set for an active link. */
  link_expires_at: string | null
}

/** The manager's dashboard (GET /api/v1/dashboard/manager, managers only): items, prices and purchasing. */
export interface ManagerDashboard {
  generated_at: string
  timezone: string
  /** Everything on ORDERED orders: ordered, not yet given out. */
  on_order: { orders: number; items: number; value_cents: number }
  /** Twelve calendar months by ordered_at, oldest first; the last is the current month. */
  months: { month: string; orders: number; items: number; value_cents: number }[]
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
  unit_price_cents: number | null
  estimated_cents: number | null
  overdue: number
}

export interface ManagerPriceChange {
  catalogue_item_id: string
  item_name: string
  at: string
  by_name: string | null
  before_cents: number | null
  after_cents: number | null
  before_service_months: number | null
  after_service_months: number | null
}
