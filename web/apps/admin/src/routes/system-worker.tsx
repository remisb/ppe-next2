import { type WorkerStatus } from '@ppe/api-client'
import { Fact, FactGrid } from '@ppe/ui/components/facts'
import { IssueBadge } from '@ppe/ui/components/issue-badge'
import { Panel } from '@ppe/ui/components/panel'
import { RelativeDate } from '@ppe/ui/components/relative-date'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, stackedBreak } from '@ppe/ui/components/table'
import { formatNumber } from '@ppe/i18n'
import { cn } from '@ppe/ui/lib/utils'

import { t } from '@/i18n'

/** A job kind's words; one the app does not know yet is shown as it is. */
const kindLabel = (kind: string) => t.system.jobKinds[kind] ?? kind

/**
 * System → Worker (ADR 0008 decision 9): whether a worker is running, its
 * tools and the job kinds it serves, the jobs by kind and state, and those
 * that failed in the last 7 days with their reasons.
 */
export function WorkerPanel({ w, timeZone, className }: { w: WorkerStatus; timeZone: string | undefined; className?: string }) {
  const alive = w.workers.filter((x) => x.alive)
  const newest = w.workers[0]
  const waiting = w.kinds.reduce((n, k) => n + k.pending, 0)
  const issues = alive.length === 0 && waiting > 0 ? [t.system.workerSilentIssue] : []
  return (
    <Panel title={t.system.worker} description={t.system.workerHint} className={className}>
      <div className="mb-4">
        <IssueBadge
          label={alive.length > 0 ? t.system.workerRunning(alive.length) : newest ? t.system.workerStopped : t.system.workerNever}
          variant={alive.length > 0 ? 'success' : waiting > 0 ? 'destructive' : 'outline'}
          issues={issues}
        />
      </div>
      {newest ? (
        <FactGrid layout="rows">
          <Fact label={t.system.lastSeen}>
            <RelativeDate iso={newest.seen_at} timeZone={timeZone} time sentence />
            <span className="block text-xs text-muted-foreground">
              <code>{newest.name}</code> · <code>{newest.version}</code>
            </span>
          </Fact>
          <Fact label={t.system.tools}>
            {Object.keys(newest.tools).length === 0 ? (
              t.system.none
            ) : (
              <span className="flex flex-col gap-0.5">
                {Object.entries(newest.tools)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([name, version]) => (
                    <span key={name} className="text-xs">
                      <code>{name}</code> <span className="text-muted-foreground">{version}</span>
                    </span>
                  ))}
              </span>
            )}
          </Fact>
          <Fact label={t.system.serves}>{newest.kinds.length === 0 ? t.system.servesNothing : newest.kinds.map(kindLabel).join(', ')}</Fact>
          <Fact label={t.system.oldestWaiting}>
            {w.oldest_waiting ? <RelativeDate iso={w.oldest_waiting} timeZone={timeZone} time sentence /> : t.system.none}
          </Fact>
        </FactGrid>
      ) : null}
      {w.kinds.length > 0 ? (
        <>
          <h3 className="mt-4 mb-2 text-sm font-medium">{t.system.jobs}</h3>
          <Table stack="list">
            <TableHeader>
              <TableRow>
                <TableHead>{t.system.jobKind}</TableHead>
                <TableHead className="text-right">{t.system.jobsWaiting}</TableHead>
                <TableHead className="text-right">{t.system.jobsRunning}</TableHead>
                <TableHead className="text-right">{t.system.jobsDone}</TableHead>
                <TableHead className="text-right">{t.system.jobsFailed}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {w.kinds.map((k) => (
                <TableRow key={k.kind} className={stackedBreak}>
                  <TableCell className="whitespace-normal stacked:order-1 stacked:w-full">{kindLabel(k.kind)}</TableCell>
                  <Count label={t.system.jobsWaiting} n={k.pending} />
                  <Count label={t.system.jobsRunning} n={k.running} />
                  <Count label={t.system.jobsDone} n={k.done} />
                  <Count label={t.system.jobsFailed} n={k.failed} alarm />
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      ) : null}
      {w.failed.length > 0 ? (
        <>
          <h3 className="mt-4 mb-2 text-sm font-medium">{t.system.failedJobs(w.failed_recently)}</h3>
          <ul className="flex flex-col gap-2 text-sm">
            {w.failed.map((j) => (
              <li key={j.id} className="border-b border-border pb-2 last:border-0">
                <span className="font-medium">{kindLabel(j.kind)}</span>{' '}
                <span className="text-muted-foreground">
                  · {j.finished_at ? <RelativeDate iso={j.finished_at} timeZone={timeZone} time /> : null} · {t.system.attempts(j.attempts)}
                </span>
                {j.last_error ? <code className="mt-0.5 block text-xs break-all whitespace-normal text-muted-foreground">{j.last_error}</code> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Panel>
  )
}

/** A count of jobs in one state; stacked on a narrow screen, it names the state. */
function Count({ label, n, alarm = false }: { label: string; n: number; alarm?: boolean }) {
  return (
    <TableCell className={cn('text-right tabular-nums stacked:order-3 stacked:w-auto stacked:text-xs', alarm && n > 0 && 'text-destructive')}>
      <span className="hidden text-muted-foreground stacked:inline">{label} </span>
      {formatNumber(n)}
    </TableCell>
  )
}
