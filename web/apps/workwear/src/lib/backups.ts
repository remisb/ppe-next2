import type { BackupStatus } from '@ppe/api-client'

import { intlLocale, t } from '@/i18n'
import { formatRelative } from '@/lib/history'

/**
 * What the Backups screen and the Dashboard card say first, worst first: the
 * agent is missing or silent, the last run failed, no backup yet, the newest is
 * overdue, or all is well. The server decides stale, offline and failed.
 */
export type BackupHealth = 'noAgent' | 'offline' | 'failed' | 'none' | 'stale' | 'ok'

export function backupHealth(s: BackupStatus): BackupHealth {
  if (!s.agent) return 'noAgent'
  if (s.agent_offline) return 'offline'
  if (s.last_run_failed) return 'failed'
  if (!s.last_success) return 'none'
  if (s.stale) return 'stale'
  return 'ok'
}

/** The verdict as a sentence; for 'failed' the screen shows the error after it. */
export function healthText(s: BackupStatus, now: Date): string {
  const when = (iso: string) => formatRelative(iso, now, s.timezone, { time: true })
  switch (backupHealth(s)) {
    case 'noAgent':
      return t.backups.noAgent
    case 'offline':
      return t.backups.offline(when(s.agent!.last_seen_at))
    case 'failed':
      return t.backups.lastFailed
    case 'none':
      return s.agent?.next_run_at ? `${t.backups.noneYet} ${t.backups.firstAt(when(s.agent.next_run_at))}` : t.backups.noneYet
    case 'stale':
      return t.backups.stale(when(s.last_success!.started_at))
    case 'ok':
      return t.backups.upToDate(when(s.last_success!.started_at))
  }
}

/** Backups kept only on the server itself (a file:// target) are lost with it. */
export const isLocalTarget = (target: string) => target.startsWith('file://')

/** A size in bytes as people read it, in the user's language: "53.7 kB", "53,7 кБ". */
export function formatBytes(n: number): string {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return new Intl.NumberFormat(intlLocale(), {
    style: 'unit',
    unit: units[i],
    unitDisplay: 'short',
    maximumFractionDigits: i === 0 ? 0 : 1,
  }).format(v)
}

/** A duration as "0.8 sec" or "2 min 5 sec", in the user's language. */
export function formatDuration(ms: number): string {
  const fmt = (v: number, unit: 'second' | 'minute', digits = 0) =>
    new Intl.NumberFormat(intlLocale(), { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: digits }).format(v)
  if (ms < 60_000) return fmt(ms / 1000, 'second', ms < 10_000 ? 1 : 0)
  const s = Math.round(ms / 1000)
  return `${fmt(Math.floor(s / 60), 'minute')} ${fmt(s % 60, 'second')}`
}

/**
 * A cron schedule in words where it is a simple one ("Every day at 03:00",
 * "Every 6 hours"); otherwise as configured.
 */
export function describeSchedule(spec: string): string {
  const daily = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(spec.trim())
  if (daily) return t.backups.daily(`${daily[2]!.padStart(2, '0')}:${daily[1]!.padStart(2, '0')}`)
  if (spec.trim() === '@daily' || spec.trim() === '@midnight') return t.backups.daily('00:00')
  if (spec.trim() === '@hourly') return t.backups.every(1)
  const every = /^@every (\d+)h$/.exec(spec.trim())
  if (every) return t.backups.every(Number(every[1]))
  return spec
}
