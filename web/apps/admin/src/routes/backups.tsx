import type { BackupStatus } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { Badge } from '@ppe/ui/components/badge'
import { EmptyState, Loaded } from '@ppe/ui/components/states'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@ppe/ui/components/table'
import { useLoad } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'

import { KeyFigures, Kpi, Panel, RefreshButton } from '@ppe/ui/components/panel'
import { RelativeDate } from '@ppe/ui/components/relative-date'
import { t } from '@/i18n'
import { backupHealth, describeSchedule, formatBytes, formatDuration, healthText, isLocalTarget } from '@ppe/backups'
import { capitalize, formatDateTime, formatRelative } from '@ppe/ui/lib/dates'
import { Fact, FactGrid } from '@ppe/ui/components/facts'
import { IssueBadge } from '@ppe/ui/components/issue-badge'
import { StatusLine } from '@ppe/ui/components/status-line'

/**
 * Backups (System's Backups tab, /system/backups; backups.read): whether the
 * database is being backed up, the backup service's settings and its recent
 * runs. It only reads GET /api/v1/backups; the service itself runs on the
 * server (docs/backups.md).
 */
export function BackupsTab() {
  const { client } = useApi()
  const loaded = useLoad(() => client.backups())

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">{t.backups.description}</p>
        <RefreshButton loading={loaded.loading} onClick={loaded.reload} />
      </div>
      <Loaded load={loaded}>
        {(s) => (
          <div className="flex flex-col gap-4 md:gap-6">
            <Verdict s={s} />
            <Figures s={s} />
            <div className="grid gap-4 md:gap-6 lg:grid-cols-3">
              <RecentRuns s={s} className="lg:col-span-2" />
              <ServiceSettings s={s} />
            </div>
          </div>
        )}
      </Loaded>
    </>
  )
}

/** The one sentence that matters, and where backups are only on the server, that they would be lost with it. */
function Verdict({ s }: { s: BackupStatus }) {
  const health = backupHealth(s)
  const ok = health === 'ok'
  return (
    // Ruled lines, not boxes: the verdict, and under it where backups would be lost with the server.
    <div className="divide-y divide-border border-y border-border">
      <StatusLine role="status" ruled={false} className="py-3" icon={ok ? <CheckCircle2 aria-hidden /> : <AlertTriangle aria-hidden />} tone={ok ? 'muted' : 'danger'}>
        <p className="font-medium">{healthText(s, new Date())}</p>
        {health === 'failed' && s.runs[0] ? <p className="mt-1 font-mono text-xs break-words text-muted-foreground">{s.runs[0].error}</p> : null}
      </StatusLine>
      {s.agent && isLocalTarget(s.agent.target) ? (
        <StatusLine ruled={false} className="py-3 text-muted-foreground" icon={<AlertTriangle aria-hidden />} tone="warning">
          {t.backups.localOnly}
        </StatusLine>
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
                  {r.status === 'succeeded' ? (
                    <Badge variant="secondary">{t.backups.succeeded}</Badge>
                  ) : (
                    // The agent's own words are what is wrong; what to do is the same for every failure.
                    <IssueBadge label={t.backups.failed} variant="destructive" issues={[{ title: r.error || t.backups.failed, detail: t.backups.failedFix }]} />
                  )}
                  {r.pruned ? <span className="mt-1 block text-xs">{t.backups.deleted}</span> : null}
                </TableCell>
                <TableCell label={t.backups.size} className="text-right tabular-nums">
                  {r.status === 'succeeded' ? formatBytes(r.size_bytes) : '–'}
                </TableCell>
                <TableCell label={t.backups.took} className="text-right tabular-nums">
                  {formatDuration(r.duration_ms)}
                </TableCell>
                <TableCell label={t.backups.dbVersion}>{r.server_version || '–'}</TableCell>
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
      <FactGrid layout="rows">
        {rows.map(([label, value]) => (
          <Fact key={label} label={label} className="first:pt-0 last:pb-0">
            {value}
          </Fact>
        ))}
      </FactGrid>
    </Panel>
  )
}
