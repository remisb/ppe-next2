import { plural } from '@ppe/i18n'

/** Usage: who uses the system and how, from what the API already records. */
export const usage = {
  title: 'Usage',
  description: 'Who uses the apps and from what, how sign-ins and changes go, how employees confirm, and how complete the data is. No page is tracked: these come from what the system records anyway.',
  timesIn: (tz: string) => `Days are in ${tz}.`,
  // Key figures
  activeToday: 'Active today',
  ofAccounts: (users: number) => plural(users, { one: 'of # active account', other: 'of # active accounts' }),
  active7: 'Last 7 days',
  active30: 'Last 30 days',
  signInsToday: 'Sign-ins today',
  failed: (n: number) => plural(n, { one: '# failed', other: '# failed' }),
  // Active people
  activePeople: 'Active people per day',
  activePeopleHint: 'Someone who used an app that day, signed in already or not.',
  day: 'Day',
  everyone: 'Everyone',
  byRole: 'By role',
  byRoleHint: 'A person counts under each role they hold.',
  roleToday: (n: number) => plural(n, { one: '# today', other: '# today' }),
  // Sign-ins
  signIns: 'Sign-ins per day',
  signedIn: 'Signed in',
  failedSignIns: 'Failed',
  // Changes
  changes: 'Changes per week',
  changesHint: 'What the Audit log recorded, by area; darker is more.',
  area: 'Area',
  weekOf: (day: string) => `Week of ${day}`,
  mostActive: 'Most active, last 30 days',
  changesCount: (n: number) => plural(n, { one: '# change', other: '# changes' }),
  noChanges: 'No changes in the last 30 days.',
  // Devices
  devices: 'Devices, last 30 days',
  devicesHint: 'The people using each, by their browser.',
  kinds: { phone: 'Phone', tablet: 'Tablet', computer: 'Computer' },
  systems: 'Systems',
  browsers: 'Browsers',
  unknown: 'Other',
  noDevices: 'No one has signed in in the last 30 days.',
  // Languages
  languages: 'Languages',
  users: 'Users',
  employees: 'Employees',
  noLanguage: 'Not recorded',
  // Funnel
  funnel: 'Confirmation links, last 90 days',
  funnelHint: 'Links sent to employees to confirm what they received, and how far each went.',
  created: 'Sent',
  opened: 'Opened',
  confirmed: 'Confirmed',
  ofSent: (percent: number) => `${percent}% of sent`,
  waiting: 'Still waiting',
  expired: 'Expired unconfirmed',
  replaced: 'Replaced or confirmed another way',
  noLinks: 'No confirmation links were sent in the last 90 days.',
  // Data quality
  quality: 'Data quality, last 90 days',
  qualityHint: 'Sampled once a day. Fewer is better.',
  missingSizes: 'Employees without sizes',
  unpriced: 'Items without a price or service period',
  ofTotal: (part: number, total: number) => `${part} of ${total}`,
  trend: (first: number, last: number) => `From ${first} to ${last}`,
  noSamples: 'No sample yet: the first is taken within the hour.',
}

export type UsageText = typeof usage
