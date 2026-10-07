import { ApiError, NetworkError } from './errors.ts'
import type {
  AccessReview,
  AuditEntry,
  AuditIntegrity,
  AuditPage,
  AuditQuery,
  AuditRecordKind,
  AuditVerification,
  BackupStatus,
  CatalogueItem,
  CatalogueItemInput,
  ClientErrorReport,
  ConfirmationLink,
  Dashboard,
  Employee,
  EmployeeDashboard,
  EmployeeInput,
  EmployeeSizesInput,
  ErrorEvent,
  ErrorPage,
  ErrorQuery,
  HistoryQuery,
  ItemSet,
  ItemSetInput,
  Language,
  LiveSession,
  LoginResponse,
  ManagerDashboard,
  MarkAsOrderedInput,
  Order,
  OrderPage,
  OrderRecord,
  Overview,
  PermissionInfo,
  PriceEntry,
  Resolution,
  ResolveInput,
  Role,
  RoleInput,
  SecurityPage,
  SecurityQuery,
  Settings,
  SignedInDevice,
  Sizes,
  SupplierChatInput,
  SystemStatus,
  UsageReport,
  User,
  UserCreateInput,
  UserUpdateInput,
} from './types.ts'

/** The apps the API tells apart in the Audit log (X-PPE-App). */
export type AppName = 'workwear' | 'admin'

export interface ClientOptions {
  /** Prefix for every path; '' when the app is served from the API's origin or proxied. */
  baseUrl?: string
  /** The app sending the requests; the Audit log records it with each change. */
  app?: AppName
  /** The current bearer token, or null when signed out. */
  getToken: () => string | null
  /**
   * Called when a request is refused with 401, as when the access token ran
   * out while the device slept: get a new one from the refresh cookie and
   * resolve true to send the request once more with it.
   */
  renew?: () => Promise<boolean>
  /** Called on a 401 that stands, e.g. to drop the session. */
  onUnauthenticated?: () => void
  /**
   * Called when the server wants the password confirmed first (403
   * RECENT_SIGN_IN_REQUIRED): ask for it, confirm it (reauthenticate), and
   * resolve true to send the request once more.
   */
  confirmPassword?: () => Promise<boolean>
  fetch?: typeof fetch
}

/** The API's 403 message when managing users needs the password entered again. */
export const RECENT_SIGN_IN_REQUIRED = 'recent sign-in required'

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

/**
 * How a request handles refusals. The sign-in routes answer with the cookie,
 * not the token, so their 401 neither renews nor signs out: login's is a wrong
 * password, refresh's means signed out, which the caller handles.
 */
interface Handling {
  renew: boolean
  signOut: boolean
}
const normal: Handling = { renew: true, signOut: true }
const signInRoute: Handling = { renew: false, signOut: false }

export function createClient(options: ClientOptions) {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis)
  const base = options.baseUrl ?? ''

  /** A file the API sends as an attachment, and the name it gives it. */
  async function download(path: string): Promise<{ blob: Blob; filename: string }> {
    const get = async () => {
      const headers: Record<string, string> = {}
      if (options.app) headers['X-PPE-App'] = options.app
      const token = options.getToken()
      if (token) headers['Authorization'] = `Bearer ${token}`
      try {
        return await doFetch(base + path, { method: 'GET', headers })
      } catch (err) {
        throw new NetworkError(err)
      }
    }
    let res = await get()
    if (res.status === 401 && options.renew && (await options.renew())) res = await get()
    if (!res.ok) {
      const text = await res.text()
      if (res.status === 401) options.onUnauthenticated?.()
      throw new ApiError(res.status, errorMessage(text, res.status), errorReference(text))
    }
    const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'download'
    return { blob: await res.blob(), filename: name }
  }

  async function send(method: Method, path: string, body: unknown): Promise<{ res: Response; text: string }> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (options.app) headers['X-PPE-App'] = options.app
    const token = options.getToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    try {
      const res = await doFetch(base + path, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
      return { res, text: res.status === 204 ? '' : await res.text() }
    } catch (err) {
      throw new NetworkError(err)
    }
  }

  async function request<T>(method: Method, path: string, body?: unknown, handling: Handling = normal): Promise<T> {
    let { res, text } = await send(method, path, body)
    if (res.status === 401 && handling.renew && options.renew && (await options.renew())) {
      ;({ res, text } = await send(method, path, body))
    }
    if (res.status === 403 && errorMessage(text, 403) === RECENT_SIGN_IN_REQUIRED && options.confirmPassword && (await options.confirmPassword())) {
      ;({ res, text } = await send(method, path, body))
    }
    if (res.status === 204) return undefined as T
    if (!res.ok) {
      if (res.status === 401 && handling.signOut) options.onUnauthenticated?.()
      throw new ApiError(res.status, errorMessage(text, res.status), errorReference(text))
    }
    return (text ? JSON.parse(text) : undefined) as T
  }

  const seg = encodeURIComponent

  return {
    /** Sign in; the server also sets the refresh cookie, outliving the browser with keepSignedIn. */
    login: (email: string, password: string, keepSignedIn: boolean) =>
      request<LoginResponse>('POST', '/api/v1/auth/login', { email, password, keep_signed_in: keepSignedIn }, signInRoute),
    /** A new access token from the refresh cookie, which it replaces; 401 when signed out (no cookie, ended or expired). */
    refresh: () => request<LoginResponse>('POST', '/api/v1/auth/refresh', undefined, signInRoute),
    /** Sign out this browser: ends its sign-in and clears the cookie. */
    logout: () => request<void>('POST', '/api/v1/auth/logout', undefined, signInRoute),
    /** Confirm the password for an action that needs a recent sign-in; a new access token. 400 when it is wrong. */
    reauthenticate: (password: string) => request<LoginResponse>('POST', '/api/v1/auth/reauth', { password }, { renew: false, signOut: true }),
    /** The signed-in user's devices (sign-ins), this one marked current. */
    sessions: {
      list: () => request<SignedInDevice[]>('GET', '/api/v1/auth/sessions'),
      /** Sign out one of the user's other devices. */
      end: (id: string) => request<void>('DELETE', `/api/v1/auth/sessions/${encodeURIComponent(id)}`),
      /** Sign out every device but this one. */
      endOthers: () => request<void>('DELETE', '/api/v1/auth/sessions'),
    },
    me: () => request<User>('GET', '/api/v1/users/me'),
    /** Change the signed-in user's own password; the current one must be supplied. */
    changeOwnPassword: (currentPassword: string, newPassword: string) =>
      request<void>('PUT', '/api/v1/users/me/password', { current_password: currentPassword, new_password: newPassword }),
    /** Set the signed-in user's own interface language; returns the user. */
    setOwnLanguage: (language: Language) => request<User>('PUT', '/api/v1/users/me/language', { language }),
    sizes: () => request<Sizes>('GET', '/api/v1/sizes'),
    settings: () => request<Settings>('GET', '/api/v1/settings'),
    /** Set or clear the supplier's WhatsApp group; administrators only. Returns the settings. */
    updateSupplierChat: (input: SupplierChatInput) => request<Settings>('PUT', '/api/v1/settings/supplier-chat', input),
    /** The administrator's dashboard; admins only. */
    dashboard: () => request<Dashboard>('GET', '/api/v1/dashboard'),
    /** The database backups the backup agent recorded; admins only. */
    backups: () => request<BackupStatus>('GET', '/api/v1/backups'),
    /**
     * The Audit log: every recorded change, newest first, a page at a time
     * (audit.read). History is one record's changes, for whoever may open it.
     */
    audit: {
      list: (query: AuditQuery = {}) => request<AuditPage>('GET', `/api/v1/audit-events${historyQueryString(query)}`),
      get: (id: string) => request<AuditEntry>('GET', `/api/v1/audit-events/${seg(id)}`),
      history: (record: AuditRecordKind, id: string) => request<AuditEntry[]>('GET', `/api/v1/audit-events/${record}/${seg(id)}`),
      /** The seals, the latest check and the retention (audit.read). */
      integrity: () => request<AuditIntegrity>('GET', '/api/v1/audit-events/integrity'),
      /** Recomputes every seal from the events now (audit.read). */
      verify: () => request<AuditVerification>('POST', '/api/v1/audit-events/verify'),
      /** The events the filter selects as a CSV or JSON-lines file (audit.export); from and to are required. */
      export: (format: 'csv' | 'jsonl', query: AuditQuery) =>
        download(`/api/v1/audit-events/export${historyQueryString({ ...query, format } as AuditQuery)}`),
    },
    /**
     * Administration's Security screen (security.read): sign-ins and failed
     * attempts, every user's live sessions and the access review. Ending
     * someone's session takes users.manage and a recent sign-in.
     */
    security: {
      events: (query: SecurityQuery = {}) => request<SecurityPage>('GET', `/api/v1/security/events${historyQueryString(query)}`),
      sessions: () => request<LiveSession[]>('GET', '/api/v1/security/sessions'),
      endSession: (id: string) => request<void>('DELETE', `/api/v1/security/sessions/${seg(id)}`),
      review: () => request<AccessReview>('GET', '/api/v1/security/access-review'),
      /** Records that the signed-in user reviewed access now; returns the review. */
      markReviewed: () => request<AccessReview>('POST', '/api/v1/security/access-review'),
    },
    /**
     * Administration's System screen (system.read): the API's status and
     * request figures, the database, and the error list.
     */
    system: {
      status: () => request<SystemStatus>('GET', '/api/v1/system/status'),
      errors: (query: ErrorQuery = {}) => request<ErrorPage>('GET', `/api/v1/system/errors${historyQueryString(query)}`),
      error: (id: string) => request<ErrorEvent>('GET', `/api/v1/system/errors/${seg(id)}`),
    },
    /** Administration's Usage screen: who uses the system and how (usage.read). */
    usage: () => request<UsageReport>('GET', '/api/v1/usage'),
    /** Administration's Overview: what needs attention, of the areas the user may see (any signed-in user). */
    overview: () => request<Overview>('GET', '/api/v1/overview'),
    /** Reports an error the app caught in the browser to System's error list (any signed-in user). */
    reportError: (report: ClientErrorReport) => request<void>('POST', '/api/v1/client-errors', report),
    /** Replacements due: the whole list the dashboards show the start of (any signed-in user). */
    replacements: () => request<Dashboard['replacements']>('GET', '/api/v1/replacements'),
    /** The manager's dashboard; managers only. */
    managerDashboard: () => request<ManagerDashboard>('GET', '/api/v1/dashboard/manager'),
    /** The employee role's dashboard, for the signed-in user; that role only. */
    employeeDashboard: () => request<EmployeeDashboard>('GET', '/api/v1/dashboard/employee'),

    /** User accounts: listing needs users.read, every change users.manage. */
    users: {
      list: () => request<User[]>('GET', '/api/v1/users'),
      create: (input: UserCreateInput) => request<User>('POST', '/api/v1/users', input),
      update: (id: string, input: UserUpdateInput) => request<User>('PUT', `/api/v1/users/${seg(id)}`, input),
      /** Admin reset: replaces the password without the old one. */
      setPassword: (id: string, password: string) => request<void>('PUT', `/api/v1/users/${seg(id)}/password`, { password }),
    },

    /** The permission catalogue, in display order (users.read). */
    permissions: () => request<PermissionInfo[]>('GET', '/api/v1/permissions'),

    /** Roles: reading needs users.read, every change roles.manage. */
    roles: {
      list: () => request<Role[]>('GET', '/api/v1/roles'),
      get: (id: string) => request<Role>('GET', `/api/v1/roles/${seg(id)}`),
      create: (input: RoleInput) => request<Role>('POST', '/api/v1/roles', input),
      update: (id: string, input: RoleInput) => request<Role>('PUT', `/api/v1/roles/${seg(id)}`, input),
      remove: (id: string) => request<void>('DELETE', `/api/v1/roles/${seg(id)}`),
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
      /** Price and service period changes, newest first, ending with the values it was created with. */
      priceHistory: (id: string) => request<PriceEntry[]>('GET', `/api/v1/catalogue/${seg(id)}/price-history`),
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
      /** Hand-over mode: the employee ticked the confirmation text on this staff device. */
      confirmInPerson: (id: string) => request<OrderRecord>('POST', `/api/v1/orders/${seg(id)}/confirm-in-person`, { confirmed: true }),
      /** View Record / Print Record: the locked receipt. */
      record: (id: string) => request<OrderRecord>('GET', `/api/v1/orders/${seg(id)}/record`),
      /** Managers only: soft-deletes a demo or test order; it leaves History, the dashboards and its links. */
      remove: (id: string) => request<void>('DELETE', `/api/v1/orders/${seg(id)}`),
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

/** The query string for a list's filters (Orders, the Audit log, Security), with empty filters left out. */
export function historyQueryString(query: HistoryQuery | AuditQuery | SecurityQuery | ErrorQuery): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') params.set(k, String(v))
  }
  const s = params.toString()
  return s ? `?${s}` : ''
}

function errorReference(text: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(text)
    const ref = typeof parsed === 'object' && parsed !== null ? (parsed as { reference?: unknown }).reference : undefined
    return typeof ref === 'string' && ref !== '' ? ref : undefined
  } catch {
    return undefined
  }
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
