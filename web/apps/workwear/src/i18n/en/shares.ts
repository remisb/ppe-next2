import { plural } from '@ppe/i18n'

/** Sharing employees' details (WARE-51): Shared Links and the public page of a link. */
export const shares = {
  title: 'Shared Links',
  description: 'The links you have shared that are still open. Anyone who has one can open it until it expires; revoke it to close it now.',
  name: 'Name',
  type: 'Type',
  rows: 'Rows',
  shared: 'Shared',
  openUntil: 'Open until',
  kinds: { employees: 'Employees' } as Record<string, string>,
  revoke: 'Revoke',
  revokeName: (name: string) => `Revoke ${name}`,
  revokeQuestion: (name: string) => `Revoke the link “${name}”? It stops opening at once, and the details it held are erased. This cannot be undone.`,
  revoked: (name: string) => `Link “${name}” revoked.`,
  none: 'No open shared links',
  noneHelp: 'Share a few employees from Employees: Export (or Share), then Share Link.',
  openEmployees: 'Open Employees',
  // The name Share Link proposes for more than three people: the first two, and how many more.
  namesAndMore: (names: string, more: number) => `${names} ${plural(more, { one: 'and # more', other: 'and # more' })}`,
  pageSharedBy: (who: string, when: string) => `Shared by ${who} on ${when}`,
  pageOpenUntil: (when: string) => `This link is open until ${when}.`,
  pageAsOf: 'The details are as they were when shared.',
  pageGone: 'This link is no longer available',
  pageGoneHelp: 'It has expired or was revoked. Ask the person who shared it for a new one.',
  pageNotFound: 'This link does not exist',
  pageNotFoundHelp: 'Check that it was copied in full, or ask for a new one.',
  pageCount: (n: number) => plural(n, { one: '# person', other: '# people' }),
}

export type SharesText = typeof shares
