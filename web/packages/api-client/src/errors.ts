/**
 * A non-2xx API response. `message` is the API's `{"error": ...}` text when
 * present; `reference`, on a 500, is the request's ID, which finds the error
 * on Administration's System screen and in the API's log.
 */
export class ApiError extends Error {
  readonly status: number
  readonly reference: string | undefined
  /** On a 409, the record the conflict is with: the asset that already has the SIM or inventory number. */
  readonly existingId: string | undefined
  /** On a refused batch (Scan SIMs), the refused row, counted from 0. */
  readonly index: number | undefined

  constructor(status: number, message: string, reference?: string, existingId?: string, index?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.reference = reference
    this.existingId = existingId
    this.index = index
  }

  /** The reference as people quote it: its first 8 characters, enough to grep the log. */
  get shortReference(): string | undefined {
    return this.reference?.slice(0, 8)
  }

  get isUnauthenticated(): boolean {
    return this.status === 401
  }
  get isForbidden(): boolean {
    return this.status === 403
  }
  get isNotFound(): boolean {
    return this.status === 404
  }
  get isConflict(): boolean {
    return this.status === 409
  }
  get isValidation(): boolean {
    return this.status === 400
  }
}

/**
 * The network did not answer (offline, server down). Distinct from ApiError so
 * a screen can offer Retry without implying the request was rejected.
 */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('The server could not be reached. Check your connection and retry.', { cause })
    this.name = 'NetworkError'
  }
}
