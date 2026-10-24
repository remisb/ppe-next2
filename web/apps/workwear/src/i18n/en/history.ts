import { plural } from '@ppe/i18n'

/** History: the list, an open order, the staff side of confirmation, the record page's chrome, and History's date wording. */
export const history = {
  title: 'Orders',
  filters: 'Filters',
  filtersCount: (n: number) => `Filters (${n})`,
  status: 'Status',
  employee: 'Employee',
  // The record-number filter: the one order with that number, as typed (WE-000004, we4, 4).
  recordNumber: 'Record number',
  recordInvalid: 'Type a record number, such as WE-000004 or 4.',
  from: 'From',
  to: 'To',
  // Orders' date filter: the periods it offers; Custom range opens From and To over it, and the range applied becomes its choice.
  period: 'Date',
  apply: 'Apply',
  customRange: 'Custom range',
  rangeFrom: (date: string) => `From ${date}`,
  rangeTo: (date: string) => `To ${date}`,
  periods: { all: 'All dates', last7: 'Last 7 days', thisMonth: 'This month', prevMonth: 'Previous month', custom: 'Custom range…' },
  // The status tabs' tooltips: what each counts; Ordered's note says when a wait is marked.
  tabHelp: {
    all: {
      body: 'Every order placed, waiting for confirmation or given. Deleted orders are left out.',
      note: 'Ordered and Given always add up to this. Each tab counts within the employee and date filters.',
    },
    ORDERED: {
      body: 'Orders marked as ordered that the employee has not confirmed receiving yet.',
      note: (days: number) => `Confirm one by its link, in person or on the signed paper. A wait of more than ${days} days is marked in red.`,
    },
    GIVEN: {
      body: 'Orders the employee has confirmed receiving: by the link, in person or on signed paper. Each keeps its locked record.',
      note: 'Usage time counts from the day given.',
    },
  },
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
  pageOf: (page: number, pages: number) => `Page ${page} of ${pages}`,
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
  // The order pane's: they open and print the order's Items Given Record.
  viewOrder: 'View Order',
  printRecord: 'Print Record',
  printOrder: 'Print Order',
  shareWhatsApp: 'Share via WhatsApp',
  deleteOrder: 'Delete order…',
  deleteOrdered: (record: string, name: string) =>
    `Delete ${record} for ${name}? It leaves Orders and the dashboards, and its confirmation link stops working. Only for demo and test orders; this cannot be undone in the app.`,
  deleteGiven: (record: string, name: string) =>
    `Delete ${record} for ${name}? It was given and confirmed: it leaves Orders, the dashboards and Replacements due, and its record can no longer be opened. Only for demo and test orders; this cannot be undone in the app.`,

  // The staff side of confirmation.
  confirmationDescription: (record: string, name: string) =>
    `${record} · ${name}. The employee confirms receipt on a secure page, or signs the printed record.`,
  electronicConfirmation: 'Electronic confirmation',
  createLink: 'Create confirmation link',
  paperConfirmation: 'Paper confirmation',
  paperSteps: 'Print the record, have the employee sign it, then record that the signed copy was received.',
  recordPaper: 'Record signed paper confirmation',
  // The order's paper step: Mark as Signed & Given while it waits (saying what it does), Signed once given.
  sign: 'Mark as Signed & Given',
  signed: 'Signed',
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
}

export type HistoryText = typeof history
