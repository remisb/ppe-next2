import { plural } from '../plural'

/** Backups: the database backups the backup service takes, for administrators. */
export const backups = {
  title: 'Backups',
  description: 'Copies of the whole database, taken on a schedule by the backup service.',
  // The verdict at the top, worst first.
  upToDate: (when: string) => `Backups are up to date. The last one was taken ${when}.`,
  noAgent: 'The backup service has not reported: nothing is backed up on schedule. Check that it runs on the server.',
  offline: (when: string) => `The backup service last reported ${when}. It may have stopped: check the server.`,
  noneYet: 'No backup has been taken yet.',
  firstAt: (when: string) => `The first is due ${when}.`,
  lastFailed: 'The last backup failed:',
  stale: (when: string) => `The last successful backup was taken ${when}: a scheduled one is overdue.`,
  localOnly:
    'Backups are kept on the server itself, so they would be lost with it. Ask whoever runs the server to store them in a bucket elsewhere.',
  // Key figures.
  lastBackup: 'Last backup',
  nextBackup: 'Next backup',
  stored: 'Stored',
  storedSize: 'Total size',
  none: 'None',
  unknown: 'Not known',
  backupsCount: (n: number) => plural(n, { one: '# backup', other: '# backups' }),
  tookAndSize: (took: string, size: string) => `${size}, took ${took}`,
  // The service's settings.
  settings: 'Settings',
  settingsDescription: 'Set on the server, where the backup service runs.',
  schedule: 'Schedule',
  daily: (time: string) => `Every day at ${time}`,
  every: (hours: number) => plural(hours, { one: 'Every hour', other: 'Every # hours' }),
  savedTo: 'Saved to',
  keptFor: 'Kept',
  encryption: 'Encryption',
  encrypted: 'Encrypted',
  notEncrypted: 'Not encrypted',
  lastReport: 'Service last reported',
  serviceVersion: 'Service version',
  // Recent runs.
  recent: 'Recent backups',
  recentDescription: 'Each attempt, newest first.',
  started: 'Started',
  result: 'Result',
  size: 'Size',
  took: 'Took',
  dbVersion: 'Database version',
  succeeded: 'Succeeded',
  failed: 'Failed',
  deleted: 'Deleted after the retention period',
  empty: 'No backups yet. Each one the backup service takes is listed here.',
  open: 'Open Backups',
}

export type BackupsText = typeof backups
