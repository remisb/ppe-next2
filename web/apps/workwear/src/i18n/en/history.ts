import { plural } from '../plural'

/** History: the list, an open order, the staff side of confirmation, the record page's chrome, and History's date wording. */
export const history = {
  title: 'Orders',
  filters: 'Filters',
  filtersCount: (n: number) => `Filters (${n})`,
  status: 'Status',
  awaiting: 'Awaiting',
  employee: 'Employee',
  from: 'From',
  to: 'To',
  clearFilters: 'Clear filters',
  fromAfterTo: 'From must not be after To.',
  noMatch: 'No orders match these filters.',
  nothingWaiting: 'Nothing is waiting: every order is confirmed.',
  noneGiven: 'No order has been given yet.',
  noOrders: 'No orders yet. Orders appear here after Mark as Ordered.',
  colRecord: 'Record',
  colEmployee: 'Employee',
  colDate: 'Date',
  colStatus: 'Status',
  colUsage: 'Usage time',
  colTotal: 'Total value',
  pages: 'Pages',
  pageOf: (page: number, pages: number) => `page ${page} of ${pages}`,
  previous: 'Previous',
  next: 'Next',
  order: 'Order',
  nextOrPrevious: 'next or previous order',
  closeHint: 'close',

  // An open order.
  orderLabel: (record: string) => `Order ${record}`,
  closeOrder: 'Close order',
  notDeleted: 'The order was not deleted',
  waitingToday: 'Waiting today',
  waitingFor: (n: number) => plural(n, { one: 'Waiting # day', other: 'Waiting # days' }),
  orderedBy: (date: string, name: string) => `Ordered ${date} by ${name}`,
  given: (date: string) => `given ${date}`,
  givenConfirmed: {
    ELECTRONIC: (date: string) => `given ${date}, confirmed electronically`,
    PAPER: (date: string) => `given ${date}, confirmed on paper`,
    IN_PERSON: (date: string) => `given ${date}, confirmed in person on a staff device`,
  },
  openConfirmation: 'Open Employee Confirmation',
  handOverNow: 'Hand over now',
  viewRecord: 'View Record',
  printRecord: 'Print Record',
  shareWhatsApp: 'Share via WhatsApp',
  deleteOrder: 'Delete order…',
  deleteOrdered: (record: string, name: string) =>
    `Delete ${record} for ${name}? It leaves Orders and the dashboards, and its confirmation link stops working. Only for demo and test orders; this cannot be undone in the app.`,
  deleteGiven: (record: string, name: string) =>
    `Delete ${record} for ${name}? It was given and confirmed: it leaves Orders, the dashboards and Replacements due, and its record can no longer be opened. Only for demo and test orders; this cannot be undone in the app.`,

  // The staff side of confirmation.
  confirmationDescription: (record: string, name: string) =>
    `${record} · ${name}. The employee confirms receipt on a secure page, or signs the printed record.`,
  didNotWork: 'That did not work',
  electronicConfirmation: 'Electronic confirmation',
  createLink: 'Create confirmation link',
  paperConfirmation: 'Paper confirmation',
  paperSteps: 'Print the record, have the employee sign it, then record that the signed copy was received.',
  recordPaper: 'Record signed paper confirmation',
  recordPaperQuestion: (name: string, record: string) =>
    `Record that ${name} signed the paper record for ${record}? The order becomes Given.`,
  confirmationLink: 'Confirmation link',
  copied: 'Copied',
  copyLink: 'Copy link',
  linkValidUntil: (date: string) => `Valid until ${date}. This link is shown once; creating another replaces it.`,
  openOnThisDevice: 'Open on this device',
  shareLinkWhatsApp: 'Share link via WhatsApp',
  linkMessage: (name: string, record: string, url: string) => `${name}, please confirm receipt of your workwear (${record}):\n${url}`,

  // The hover card of a record number.
  previewFailed: 'The order could not be loaded.',
  previewOrdered: (date: string) => `ordered ${date}`,
  previewOrderedGiven: (ordered: string, given: string) => `ordered ${ordered}, given ${given}`,
  andMore: (n: number) => `and ${n} more`,

  // Dates and durations in lists.
  usage: (months: string) => `${months} months`,
  today: 'today',
  todayAt: (time: string) => `today ${time}`,
  yesterday: 'yesterday',
  yesterdayAt: (time: string) => `yesterday ${time}`,
  tomorrow: 'tomorrow',
  daysAgo: (n: number) => plural(n, { one: '# day ago', other: '# days ago' }),
  inDays: (n: number) => plural(n, { one: 'in # day', other: 'in # days' }),
}

export type HistoryText = typeof history
