import type { AttentionKey } from '@ppe/api-client'
import { plural } from '@ppe/i18n'

/** An attention item's words: what is wrong, the detail with its figure, and where it is put right. */
interface ItemText {
  title: string
  detail: (f: { count: number; percent: number; days: number }) => string
  action: string
}

/** The Overview: what needs attention, then figures. */
export const overview = {
  title: 'Overview',
  description: 'What needs your attention first, then the figures. Each item links to where it is put right.',
  attention: 'Needs attention',
  allClear: 'Nothing needs your attention.',
  allClearHint: 'Backups, sign-ins, errors and the access review are checked each time this page loads.',
  severity: { critical: 'Critical', warning: 'Warning', info: 'Note' },
  items: {
    audit_seal_mismatch: {
      title: 'The Audit log does not match its seals',
      detail: () => 'A sealed day’s changes were altered, added or removed behind the app. Keep the backups from before it.',
      action: 'Open the Audit log',
    },
    backups_not_running: {
      title: 'Backups are not running',
      detail: () => 'There is no recent backup, or the backup service has stopped reporting.',
      action: 'Open Backups',
    },
    last_backup_failed: {
      title: 'The last backup failed',
      detail: () => 'The backups before it are still recent. The run says why it failed.',
      action: 'Open Backups',
    },
    copied_sign_in: {
      title: 'A copied sign-in was used',
      detail: ({ count }) =>
        plural(count, {
          one: 'An old copy of a sign-in was used once in the last 7 days, so it was ended. Ask the user whether it was them; if not, have them change their password.',
          other: 'Old copies of sign-ins were used # times in the last 7 days, so they were ended. Ask the users whether it was them; if not, have them change their passwords.',
        }),
      action: 'Open Sign-ins',
    },
    failed_sign_ins: {
      title: 'Many failed sign-ins',
      detail: ({ count }) => plural(count, { one: '# failed sign-in in the last hour.', other: '# failed sign-ins in the last hour, or many at one account.' }),
      action: 'Open Sign-ins',
    },
    error_rate: {
      title: 'Requests are failing',
      detail: ({ count, percent }) => `${percent}% of the last hour’s requests failed (${count}).`,
      action: 'Open Errors',
    },
    new_errors: {
      title: 'New errors',
      detail: ({ count }) => plural(count, { one: 'A new kind of error in the last day.', other: '# new kinds of error in the last day.' }),
      action: 'Open Errors',
    },
    review_overdue: {
      title: 'Access review is due',
      detail: ({ days }) => (days > 0 ? `Access was last reviewed ${days} days ago. Review it every 90 days.` : 'Access has not been reviewed yet. Review it every 90 days.'),
      action: 'Open Access review',
    },
    database_owner_rights: {
      title: 'The API connects as the database owner',
      detail: () => 'It could switch off what keeps the Audit log append-only. Give it the ppe_app role: set API_DB_USER and API_DB_PASSWORD on the server.',
      action: 'Open System',
    },
    database_growth: {
      title: 'The database is growing fast',
      detail: ({ percent, days }) => `It grew ${percent}% in ${days} days. Check that the disk has room.`,
      action: 'Open System',
    },
  } satisfies Record<AttentionKey, ItemText>,
  figures: 'Figures',
  activeUsers: 'Active users',
  inactiveUsers: (n: number) => plural(n, { one: '# inactive', other: '# inactive' }),
  signedIn: 'Signed in now',
  signedInDetail: (devices: number) => plural(devices, { one: 'on # device', other: 'on # devices' }),
  signInsToday: 'Sign-ins today',
  failedToday: (n: number) => plural(n, { one: '# failed', other: '# failed' }),
  requests: 'Requests, 24 hours',
  requestErrors: (n: number) => plural(n, { one: '# failed', other: '# failed' }),
  database: 'Database',
  databaseDetail: 'its size on disk',
  lastBackup: 'Last backup',
  noBackup: 'None yet',
}

export type OverviewText = typeof overview
