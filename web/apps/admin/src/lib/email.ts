/** An e-mail address's limit, as the API's internal/email.MaxLen. */
export const MAX_EMAIL_LENGTH = 254

const BARE = /^[^\s@,;<>"()]+@[^\s@,;<>"()]+\.[^\s@,;<>"()]+$/

/**
 * Whether s is an e-mail address the API keeps: one bare address (no display
 * name, no list) of at most MAX_EMAIL_LENGTH characters, with a dot in its
 * domain. The API's internal/email applies the same rule to users, suppliers
 * and SIM providers, and checks it again.
 */
export function isEmail(s: string): boolean {
  return s.length <= MAX_EMAIL_LENGTH && BARE.test(s)
}
