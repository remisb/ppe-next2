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

/** History filters; omitted fields do not filter. Dates are YYYY-MM-DD in the organisation timezone. */
export interface HistoryQuery {
  employee_id?: string
  status?: OrderStatus
  from?: string
  to?: string
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
