/**
 * Live scanning accepts a reading once it is the same twice in a row, so one
 * misread frame is never taken.
 */
export class Steady<T> {
  #last: string | undefined
  #count = 0
  readonly #needed: number
  constructor(needed = 2) {
    this.#needed = needed
  }

  /** The value, once seen needed times in a row; else null. */
  see(value: T | null, key: (v: T) => string): T | null {
    if (value === null) {
      this.#last = undefined
      this.#count = 0
      return null
    }
    const k = key(value)
    this.#count = k === this.#last ? this.#count + 1 : 1
    this.#last = k
    return this.#count >= this.#needed ? value : null
  }

  reset(): void {
    this.#last = undefined
    this.#count = 0
  }
}
