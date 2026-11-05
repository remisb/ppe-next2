/**
 * The Lithuanian personal code (asmens kodas), `G YYMMDD NNN K`
 * (docs-import plan §2.4): G gives the century and sex (1/2 the 1800s,
 * 3/4 the 1900s, 5/6 the 2000s, odd male, even female), K is a check digit:
 * the first ten digits weighted 1–9, 1 modulo 11; if that is 10, weighted
 * 3–9, 1, 2, 3 modulo 11; if that is 10 again, 0.
 *
 * A code that begins with 9 (given to people whose birth date or sex was not
 * known) passes its checksum but says nothing about either.
 */
import { isRealDate, iso } from './dates.ts'

export interface LtPersonalCode {
  /** The checksum passes. */
  valid: boolean
  /** The birth date the code says, ISO; undefined for a 9-code or an impossible date. */
  birthDate?: string
  sex?: 'M' | 'F'
}

const FIRST = [1, 2, 3, 4, 5, 6, 7, 8, 9, 1]
const SECOND = [3, 4, 5, 6, 7, 8, 9, 1, 2, 3]

/** The check digit for the first ten digits of a code. */
export function ltCheckDigit(first10: string): number {
  const d = [...first10].map(Number)
  const sum = (w: number[]) => d.reduce((s, x, i) => s + x * w[i]!, 0) % 11
  const a = sum(FIRST)
  if (a !== 10) return a
  const b = sum(SECOND)
  return b === 10 ? 0 : b
}

/** What an 11-digit code says, or undefined when it is not 11 digits. */
export function ltPersonalCode(code: string): LtPersonalCode | undefined {
  if (!/^\d{11}$/.test(code)) return undefined
  const valid = ltCheckDigit(code.slice(0, 10)) === Number(code[10])
  const g = Number(code[0])
  if (g < 1 || g > 6) return { valid }
  const year = 1800 + 100 * Math.floor((g - 1) / 2) + Number(code.slice(1, 3))
  const month = Number(code.slice(3, 5))
  const day = Number(code.slice(5, 7))
  const sex = g % 2 === 1 ? 'M' : 'F'
  return isRealDate(year, month, day) ? { valid, birthDate: iso(year, month, day), sex } : { valid, sex }
}
