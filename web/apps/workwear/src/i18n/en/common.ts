import { plural } from '@ppe/i18n'

/** Words many screens share. A screen's own wording lives in its own namespace. */
export const common = {
  appName: 'Workwear & Equipment',
  cancel: 'Cancel',
  save: 'Save',
  saving: 'Saving…',
  back: 'Back',
  edit: 'Edit',
  delete: 'Delete',
  add: 'Add',
  search: 'Search',
  retry: 'Try again',
  actionFailed: 'Action failed',
  moreActions: (name: string) => `More actions for ${name}`,
  ordered: 'Ordered',
  given: 'Given',
  active: 'Active',
  inactive: 'Inactive',
  none: 'None',
  all: 'All',
  total: 'Total',
  months: (n: number) => plural(n, { one: '# month', other: '# months' }),
  days: (n: number) => plural(n, { one: '# day', other: '# days' }),
  items: (n: number) => plural(n, { one: '# item', other: '# items' }),
  lines: (n: number) => plural(n, { one: '# line', other: '# lines' }),
  orders: (n: number) => plural(n, { one: '# order', other: '# orders' }),
  employees: (n: number) => plural(n, { one: '# employee', other: '# employees' }),
}

export type CommonText = typeof common
