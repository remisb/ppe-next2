import { ApiError, NetworkError } from './errors.ts'
import type {
  CatalogueItem,
  CatalogueItemInput,
  ConfirmationLink,
  Dashboard,
  EmployeeDashboard,
  ManagerDashboard,
  Employee,
  EmployeeInput,
  EmployeeSizesInput,
  HistoryQuery,
  ItemSet,
  ItemSetInput,
  LoginResponse,
  MarkAsOrderedInput,
  Order,
  OrderPage,
  OrderRecord,
  Resolution,
  ResolveInput,
  Settings,
  Sizes,
  User,
  UserCreateInput,
  UserUpdateInput,
} from './types.ts'

export interface ClientOptions {
  /** Prefix for every path; '' when the app is served from the API's origin or proxied. */
  baseUrl?: string
  /** The current bearer token, or null when signed out. */
  getToken: () => string | null
  /** Called on any 401, e.g. to drop an expired session. */
  onUnauthenticated?: () => void
  fetch?: typeof fetch
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

export function createClient(options: ClientOptions) {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis)
  const base = options.baseUrl ?? ''

  async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    const token = options.getToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
    if (body !== undefined) headers['Content-Type'] = 'application/json'

    let res: Response
    try {
      res = await doFetch(base + path, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
    } catch (err) {
      throw new NetworkError(err)
    }

    if (res.status === 204) return undefined as T
    const text = await res.text()
    if (!res.ok) {
      if (res.status === 401) options.onUnauthenticated?.()
      throw new ApiError(res.status, errorMessage(text, res.status))
    }
    return (text ? JSON.parse(text) : undefined) as T
  }

  const seg = encodeURIComponent

  return {
    login: (email: string, password: string) =>
      request<LoginResponse>('POST', '/api/v1/auth/login', { email, password }),
    me: () => request<User>('GET', '/api/v1/users/me'),
    /** Change the signed-in user's own password; the current one must be supplied. */
    changeOwnPassword: (currentPassword: string, newPassword: string) =>
      request<void>('PUT', '/api/v1/users/me/password', { current_password: currentPassword, new_password: newPassword }),
    sizes: () => request<Sizes>('GET', '/api/v1/sizes'),
    settings: () => request<Settings>('GET', '/api/v1/settings'),
    /** The administrator's dashboard; admins only. */
    dashboard: () => request<Dashboard>('GET', '/api/v1/dashboard'),
    /** The manager's dashboard; managers only. */
    managerDashboard: () => request<ManagerDashboard>('GET', '/api/v1/dashboard/manager'),
    /** The employee role's dashboard, for the signed-in user; that role only. */
    employeeDashboard: () => request<EmployeeDashboard>('GET', '/api/v1/dashboard/employee'),

    /** User accounts: listing is admin or manager, every change admin only. */
    users: {
      list: () => request<User[]>('GET', '/api/v1/users'),
      create: (input: UserCreateInput) => request<User>('POST', '/api/v1/users', input),
      update: (id: string, input: UserUpdateInput) => request<User>('PUT', `/api/v1/users/${seg(id)}`, input),
      /** Admin reset: replaces the password without the old one. */
      setPassword: (id: string, password: string) => request<void>('PUT', `/api/v1/users/${seg(id)}/password`, { password }),
    },

    employees: {
      list: () => request<Employee[]>('GET', '/api/v1/employees'),
      get: (id: string) => request<Employee>('GET', `/api/v1/employees/${seg(id)}`),
      search: (q: string) => request<Employee[]>('GET', `/api/v1/employees/by-name/${seg(q)}`),
      create: (input: EmployeeInput) => request<Employee>('POST', '/api/v1/employees', input),
      update: (id: string, input: EmployeeInput) => request<Employee>('PUT', `/api/v1/employees/${seg(id)}`, input),
      updateSizes: (id: string, input: EmployeeSizesInput) =>
        request<Employee>('PUT', `/api/v1/employees/${seg(id)}/sizes`, input),
      remove: (id: string) => request<void>('DELETE', `/api/v1/employees/${seg(id)}`),
    },

    catalogue: {
      list: () => request<CatalogueItem[]>('GET', '/api/v1/catalogue'),
      listActive: () => request<CatalogueItem[]>('GET', '/api/v1/catalogue/active'),
      get: (id: string) => request<CatalogueItem>('GET', `/api/v1/catalogue/${seg(id)}`),
      create: (input: CatalogueItemInput) => request<CatalogueItem>('POST', '/api/v1/catalogue', input),
      update: (id: string, input: CatalogueItemInput) =>
        request<CatalogueItem>('PUT', `/api/v1/catalogue/${seg(id)}`, input),
      setActive: (id: string, active: boolean) =>
        request<CatalogueItem>('POST', `/api/v1/catalogue/${seg(id)}/${active ? 'activate' : 'deactivate'}`),
      remove: (id: string) => request<void>('DELETE', `/api/v1/catalogue/${seg(id)}`),
    },

    itemSets: {
      list: () => request<ItemSet[]>('GET', '/api/v1/item-sets'),
      listActive: () => request<ItemSet[]>('GET', '/api/v1/item-sets/active'),
      get: (id: string) => request<ItemSet>('GET', `/api/v1/item-sets/${seg(id)}`),
      create: (input: ItemSetInput) => request<ItemSet>('POST', '/api/v1/item-sets', input),
      update: (id: string, input: ItemSetInput) => request<ItemSet>('PUT', `/api/v1/item-sets/${seg(id)}`, input),
      remove: (id: string) => request<void>('DELETE', `/api/v1/item-sets/${seg(id)}`),
      /** Apply Item Set: the set's lines resolved for the employee. Reads only. */
      apply: (setId: string, employeeId: string) =>
        request<Resolution>('GET', `/api/v1/item-sets/${seg(setId)}/apply/${seg(employeeId)}`),
    },

    orders: {
      /** Algorithm A for working lines. Reads only; nothing is stored. */
      resolve: (input: ResolveInput) => request<Resolution>('POST', '/api/v1/orders/resolve', input),
      /** Mark as Ordered: creates the immutable ORDERED record. */
      markAsOrdered: (input: MarkAsOrderedInput) => request<Order>('POST', '/api/v1/orders', input),
      get: (id: string) => request<Order>('GET', `/api/v1/orders/${seg(id)}`),
      /** History: stored snapshots, newest activity first. */
      list: (query: HistoryQuery = {}) => request<OrderPage>('GET', `/api/v1/orders${historyQueryString(query)}`),
      /** Open Employee Confirmation: a new link, shown once; replaces earlier unused links. */
      createConfirmationLink: (id: string) =>
        request<ConfirmationLink>('POST', `/api/v1/orders/${seg(id)}/confirmation-link`),
      /** Record a signed paper Items Given Record. Idempotent. */
      confirmPaper: (id: string) => request<OrderRecord>('POST', `/api/v1/orders/${seg(id)}/confirm-paper`),
      /** View Record / Print Record: the locked receipt. */
      record: (id: string) => request<OrderRecord>('GET', `/api/v1/orders/${seg(id)}/record`),
    },

    /** Public, token-only routes for the employee's confirmation page. */
    confirmations: {
      view: (token: string) => request<OrderRecord>('POST', '/api/v1/confirmations/view', { token }),
      confirm: (token: string) =>
        request<OrderRecord>('POST', '/api/v1/confirmations/confirm', { token, confirmed: true }),
    },
  }
}

export type Client = ReturnType<typeof createClient>

/** The query string for History, with empty filters left out. */
export function historyQueryString(query: HistoryQuery): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') params.set(k, String(v))
  }
  const s = params.toString()
  return s ? `?${s}` : ''
}

function errorMessage(text: string, status: number): string {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed === 'object' && parsed !== null && typeof (parsed as { error?: unknown }).error === 'string') {
      return (parsed as { error: string }).error
    }
  } catch {
    // muxstack's auth middleware answers 401/403 in plain text.
  }
  return text.trim() || `Request failed with status ${status}`
}
