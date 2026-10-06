import type { BackupRun, BackupStatus } from '@ppe/api-client'
import { applyLanguage } from '@ppe/i18n'
import { afterEach, describe, expect, it } from 'vitest'

import { backupHealth, describeSchedule, formatBytes, formatDuration, healthText, isLocalTarget } from './index.ts'

afterEach(() => applyLanguage('en'))

const now = new Date('2026-10-05T12:00:00Z')

const run = (over: Partial<BackupRun> = {}): BackupRun => ({
  id: '1',
  started_at: '2026-10-05T03:00:00Z',
  finished_at: '2026-10-05T03:00:02Z',
  duration_ms: 2000,
  status: 'succeeded',
  error: '',
  size_bytes: 54_000,
  server_version: '18.6',
  tool_version: '18.6',
  target: 'file:///backups',
  key: 'ppe2/x.dump',
  encrypted: false,
  pruned: false,
  ...over,
})

const status = (over: Partial<BackupStatus> = {}): BackupStatus => ({
  generated_at: now.toISOString(),
  timezone: 'Europe/Vilnius',
  agent: {
    name: 'ppe-next2',
    schedule: '0 3 * * *',
    timezone: 'Europe/Vilnius',
    interval_seconds: 86400,
    target: 'file:///backups',
    retention: '14 days, at least 7',
    encrypted: false,
    version: 'v0.1.0',
    next_run_at: '2026-10-06T00:00:00Z',
    last_seen_at: '2026-10-05T11:58:00Z',
  },
  last_success: run(),
  runs: [run()],
  kept: { count: 1, bytes: 54_000 },
  stale: false,
  agent_offline: false,
  last_run_failed: false,
  ...over,
})

describe('backupHealth', () => {
  it('names the worst problem first', () => {
    expect(backupHealth(status())).toBe('ok')
    expect(backupHealth(status({ stale: true }))).toBe('stale')
    expect(backupHealth(status({ last_success: null, runs: [], stale: true }))).toBe('none')
    expect(backupHealth(status({ last_run_failed: true, stale: true }))).toBe('failed')
    expect(backupHealth(status({ agent_offline: true, last_run_failed: true }))).toBe('offline')
    expect(backupHealth(status({ agent: null, agent_offline: true }))).toBe('noAgent')
  })
})

describe('healthText', () => {
  it('says when, in the organisation timezone', () => {
    expect(healthText(status(), now)).toBe('Backups are up to date. The last one was taken today 06:00.')
    expect(healthText(status({ last_success: null, runs: [], stale: true }), now)).toBe(
      'No backup has been taken yet. The first is due tomorrow.',
    )
    expect(healthText(status({ agent_offline: true }), now)).toMatch(/^The backup service last reported today 14:58\./)
  })
})

describe('formats', () => {
  it('sizes, durations and schedules', () => {
    expect(formatBytes(512)).toBe('512 byte')
    expect(formatBytes(54_000)).toBe('52.7 kB')
    expect(formatBytes(3 * 1024 ** 3)).toBe('3 GB')
    expect(formatDuration(850)).toBe('0.9 secs')
    expect(formatDuration(125_000)).toBe('2 mins 5 secs')
    expect(describeSchedule('0 3 * * *')).toBe('Every day at 03:00')
    expect(describeSchedule('30 23 * * *')).toBe('Every day at 23:30')
    expect(describeSchedule('@every 6h')).toBe('Every 6 hours')
    expect(describeSchedule('0 3 * * 1')).toBe('0 3 * * 1')
    expect(isLocalTarget('file:///backups')).toBe(true)
    expect(isLocalTarget('s3://b (fra1.digitaloceanspaces.com)')).toBe(false)
    applyLanguage('lt')
    expect(describeSchedule('0 3 * * *')).toBe('Kasdien 03:00')
    expect(formatBytes(54_000).replace(/\s/g, ' ')).toBe('52,7 kB')
  })
})
