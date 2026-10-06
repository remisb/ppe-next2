import { plural } from '@ppe/i18n'

/** Backups: the database backups the backup service takes, for administrators. */
export const backups = {
  title: 'Backups',
  description: 'Copies of the whole database, taken on a schedule by the backup service.',
  // The verdict at the top (its sentences are @ppe/backups'), and beside it.
  noAgent: 'The backup service has not reported: nothing is backed up on schedule. Check that it runs on the server.',
  noneYet: 'No backup has been taken yet.',
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
}

export type BackupsText = typeof backups
