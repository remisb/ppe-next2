/** A non-2xx API response. `message` is the API's `{"error": ...}` text when present. */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
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
