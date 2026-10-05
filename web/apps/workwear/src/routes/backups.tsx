import type { BackupStatus } from '@ppe/api-client'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'

import { KeyFigures, Kpi, Panel, RefreshButton } from '@/components/dashboard'
import { RelativeDate } from '@/components/relative-date'
import { EmptyState, ErrorState, Loading, PageHeader } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { t } from '@/i18n'
import { useApi } from '@/lib/api'
import { backupHealth, describeSchedule, formatBytes, formatDuration, healthText, isLocalTarget } from '@/lib/backups'
import { capitalize, formatDateTime, formatRelative } from '@/lib/history'
import { useLoad } from '@/lib/use-load'
import { cn } from '@/lib/utils'

/**
 * Backups (/backups, administrators only): whether the database is being
 * backed up, the backup service's settings and its recent runs. It only reads
 * GET /api/v1/backups; the service itself runs on the server (docs/backups.md).
 */
export function BackupsPage() {
  const { client } = useApi()
  const loaded = useLoad(() => client.backups())
  const s = loaded.data

  return (
    <>
      <PageHeader
        title={t.backups.title}
        description={t.backups.description}
        actions={<RefreshButton loading={loaded.loading} onClick={loaded.reload} />}
      />
      {loaded.error ? (
        <ErrorState error={loaded.error} onRetry={loaded.reload} />
      ) : !s ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-4 md:gap-6">
          <Verdict s={s} />
          <Figures s={s} />
          <div className="grid gap-4 md:gap-6 lg:grid-cols-3">
            <RecentRuns s={s} className="lg:col-span-2" />
            <ServiceSettings s={s} />
          </div>
        </div>
      )}
    </>
  )
}

/** The one sentence that matters, and where backups are only on the server, that they would be lost with it. */
function Verdict({ s }: { s: BackupStatus }) {
  const health = backupHealth(s)
  const ok = health === 'ok'
  return (
    <div className="flex flex-col gap-2">
      <div
        role="status"
        className={cn(
          'flex items-start gap-3 rounded-xl border p-4 text-sm',
          ok ? 'border-border bg-card' : 'border-destructive/40 bg-destructive/5',
        )}
      >
        {ok ? (
          <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        ) : (
          <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-destructive" />
        )}
        <div className="min-w-0">
          <p className="font-medium">{healthText(s, new Date())}</p>
          {health === 'failed' && s.runs[0] ? (
            <p className="mt-1 font-mono text-xs break-words text-muted-foreground">{s.runs[0].error}</p>
          ) : null}
        </div>
      </div>
      {s.agent && isLocalTarget(s.agent.target) ? (
        <p className="flex items-start gap-3 rounded-xl border border-border p-4 text-sm text-muted-foreground">
          <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0" />
          {t.backups.localOnly}
        </p>
      ) : null}
    </div>
  )
}

function Figures({ s }: { s: BackupStatus }) {
  const now = new Date()
  const when = (iso: string) => capitalize(formatRelative(iso, now, s.timezone, { time: true }))
  const last = s.last_success
  const next = s.agent?.next_run_at ?? null
  return (
    <KeyFigures>
      <Kpi
        label={t.backups.lastBackup}
        value={last ? when(last.started_at) : t.backups.none}
        detail={last ? t.backups.tookAndSize(formatDuration(last.duration_ms), formatBytes(last.size_bytes)) : t.backups.noneYet}
        brief={last ? formatBytes(last.size_bytes) : t.backups.noneYet}
        alert={s.stale}
      />
      <Kpi
        label={t.backups.nextBackup}
        value={next && !s.agent_offline ? when(next) : t.backups.unknown}
        detail={s.agent ? describeSchedule(s.agent.schedule) : t.backups.noAgent}
        brief={s.agent ? describeSchedule(s.agent.schedule) : t.backups.unknown}
        alert={s.agent_offline}
      />
      <Kpi label={t.backups.stored} value={String(s.kept.count)} detail={t.backups.backupsCount(s.kept.count)} brief={s.agent?.retention ?? t.backups.backupsCount(s.kept.count)} />
      <Kpi label={t.backups.storedSize} value={formatBytes(s.kept.bytes)} detail={t.backups.backupsCount(s.kept.count)} />
    </KeyFigures>
  )
}

function RecentRuns({ s, className }: { s: BackupStatus; className?: string }) {
  return (
    <Panel title={t.backups.recent} description={t.backups.recentDescription} className={className}>
      {s.runs.length === 0 ? (
        <EmptyState>{t.backups.empty}</EmptyState>
      ) : (
        <Table stack stackBelow="sm">
          <TableHeader>
            <TableRow>
              <TableHead>{t.backups.started}</TableHead>
              <TableHead>{t.backups.result}</TableHead>
              <TableHead className="text-right">{t.backups.size}</TableHead>
              <TableHead className="text-right">{t.backups.took}</TableHead>
              <TableHead>{t.backups.dbVersion}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {s.runs.map((r) => (
              <TableRow key={r.id} className={cn(r.pruned && 'text-muted-foreground')}>
                <TableCell label={t.backups.started} className="font-medium">
                  <RelativeDate iso={r.started_at} timeZone={s.timezone} time />
                </TableCell>
                <TableCell label={t.backups.result} className="whitespace-normal">
                  <Badge variant={r.status === 'succeeded' ? 'secondary' : 'destructive'}>
                    {r.status === 'succeeded' ? t.backups.succeeded : t.backups.failed}
                  </Badge>
                  {r.status === 'failed' && r.error ? (
                    <span className="mt-1 block max-w-md font-mono text-xs break-words text-muted-foreground">{r.error}</span>
                  ) : null}
                  {r.pruned ? <span className="mt-1 block text-xs">{t.backups.deleted}</span> : null}
                </TableCell>
                <TableCell label={t.backups.size} className="text-right tabular-nums">
                  {r.status === 'succeeded' ? formatBytes(r.size_bytes) : '—'}
                </TableCell>
                <TableCell label={t.backups.took} className="text-right tabular-nums">
                  {formatDuration(r.duration_ms)}
                </TableCell>
                <TableCell label={t.backups.dbVersion}>{r.server_version || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  )
}

/** What the server configured: read-only here. */
function ServiceSettings({ s }: { s: BackupStatus }) {
  const a = s.agent
  if (!a) return null
  const rows: [string, string][] = [
    [t.backups.schedule, `${describeSchedule(a.schedule)} (${a.timezone})`],
    [t.backups.savedTo, a.target],
    [t.backups.keptFor, a.retention],
    [t.backups.encryption, a.encrypted ? t.backups.encrypted : t.backups.notEncrypted],
    [t.backups.lastReport, formatDateTime(a.last_seen_at, s.timezone)],
    [t.backups.serviceVersion, a.version],
  ]
  return (
    <Panel title={t.backups.settings} description={t.backups.settingsDescription}>
      <dl className="flex flex-col divide-y divide-border text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-medium break-words">{value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  )
}
