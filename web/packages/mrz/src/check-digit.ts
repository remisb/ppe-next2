/**
 * ICAO Doc 9303 Part 3 §4.9: the check digit. Each character has a value
 * (`0`–`9` their own, `A`–`Z` 10–35, the filler `<` 0), multiplied by the
 * weights 7, 3, 1 repeating; the check digit is the sum modulo 10.
 *
 * What it cannot see: two characters whose values differ by a multiple of 10
 * give the same digit in any position, as 10 × 7, 10 × 3 and 10 × 1 are all
 * 0 modulo 10. Of the look-alikes FR-5 corrects, only `K` (20) and `<` (0)
 * are such a pair, so no check digit ever tells `K` from `<`; the parser
 * handles that pair by the layout's rules instead (correct.ts).
 */

/** The value of one MRZ character, or undefined for a character the MRZ never holds. */
export function charValue(c: string): number | undefined {
  if (c === '<') return 0
  const code = c.charCodeAt(0)
  if (c.length !== 1) return undefined
  if (code >= 48 && code <= 57) return code - 48
  if (code >= 65 && code <= 90) return code - 55
  return undefined
}

/** The check digit of s, or undefined when s holds a character the MRZ never holds. */
export function checkDigit(s: string): number | undefined {
  const weights = [7, 3, 1]
  let sum = 0
  for (let i = 0; i < s.length; i++) {
    const v = charValue(s[i]!)
    if (v === undefined) return undefined
    sum += v * weights[i % 3]!
  }
  return sum % 10
}

/** Whether digit (one character) is s's check digit. */
export function checkDigitPasses(s: string, digit: string): boolean {
  const d = checkDigit(s)
  return d !== undefined && digit === String(d)
}
