import { type ErrorEvent, type ErrorKind, type ErrorPage, type RequestPoint, type SystemStatus } from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { deviceText, sourceLabel } from '@ppe/audit'
import { formatBytes } from '@ppe/backups'
import { Badge } from '@ppe/ui/components/badge'
import { Button } from '@ppe/ui/components/button'
import { Select } from '@ppe/ui/components/field'
import { KeyFigures, Kpi, Panel, RefreshButton } from '@ppe/ui/components/panel'
import { RelativeDate } from '@ppe/ui/components/relative-date'
import { EmptyState, ErrorState, Loading, PageHeader } from '@ppe/ui/components/states'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, stackedBreak } from '@ppe/ui/components/table'
import { formatDateTime } from '@ppe/ui/lib/dates'
import { useLoad } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { ArrowLeft, X } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'

import { intlLocale, t } from '@/i18n'
import { type Route, type SystemTab, linkTo, systemTabPermission, systemTabs } from '@/lib/router'

import { BackupsTab } from './backups'

type SystemRoute = Extract<Route, { name: 'system' }>
type Navigate = (to: Route, options?: { replace?: boolean; scroll?: boolean }) => void

/**
 * System (/system): the API and its last 24 hours of requests, the database
 * and how long records are kept (Status, system.read); the error list
 * (/system/errors, system.read), one error open beside it; and the backups
 * (/system/backups, backups.read). Each tab shows only to whoever may open it.
 */
export function SystemPage({ route, navigate }: { route: SystemRoute; navigate: Navigate }) {
  const session = useSession()
  const { client } = useApi()
  const tz = useLoad(() => client.settings()).data?.timezone
  const tabs = systemTabs.filter((tab) => session.can(systemTabPermission[tab]))
  const label: Record<SystemTab, string> = { status: t.system.status, errors: t.system.errors, backups: t.system.backups }
  return (
    <>
      <PageHeader title={t.system.title} description={t.system.description} />
      {tabs.length > 1 ? (
        <nav aria-label={t.system.sections} className="-mt-2 mb-5 flex gap-1 overflow-x-auto border-b border-border">
          {tabs.map((tab) => (
            <a
              key={tab}
              {...linkTo({ name: 'system', tab }, navigate)}
              aria-current={route.tab === tab ? 'page' : undefined}
              className="-mb-px shrink-0 border-b-2 border-transparent px-3 py-2.5 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:border-primary aria-[current=page]:text-foreground"
            >
              {label[tab]}
            </a>
          ))}
        </nav>
      ) : null}
      {route.tab === 'status' ? <StatusTab timeZone={tz} /> : null}
      {route.tab === 'errors' ? <ErrorsTab selected={route.error} timeZone={tz} navigate={navigate} /> : null}
      {route.tab === 'backups' ? <BackupsTab /> : null}
    </>
  )
}

const number = (n: number) => new Intl.NumberFormat(intlLocale()).format(n)
const percentOf = (part: number, whole: number) => (whole > 0 ? Math.round((1000 * part) / whole) / 10 : 0)

function StatusTab({ timeZone }: { timeZone: string | undefined }) {
  const { client } = useApi()
  const loaded = useLoad(() => client.system.status())
  const s = loaded.data
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{s ? t.system.timesIn(s.timezone) : null}</p>
        <RefreshButton loading={loaded.loading} onClick={loaded.reload} />
      </div>
      {loaded.error ? (
        <ErrorState error={loaded.error} onRetry={loaded.reload} />
      ) : !s ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-4 md:gap-6">
          <Service s={s} timeZone={timeZone} />
          <Requests s={s} timeZone={timeZone} />
          <div className="grid gap-4 md:gap-6 lg:grid-cols-3">
            <Database s={s} className="lg:col-span-2" />
            <Retention s={s} timeZone={timeZone} />
          </div>
        </div>
      )}
    </>
  )
}

/** A label and its value, as the panels list them. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right break-words tabular-nums">{children}</dd>
    </div>
  )
}

function Service({ s, timeZone }: { s: SystemStatus; timeZone: string | undefined }) {
  const ok = s.service.ready
  return (
    <div
      role="status"
      className={cn(
        'flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border p-4 text-sm',
        ok ? 'border-border bg-card' : 'border-destructive/40 bg-destructive/10',
      )}
    >
      <Badge variant={ok ? 'secondary' : 'destructive'}>{ok ? t.system.ready : t.system.notReady}</Badge>
      {s.service.problem ? <span className="text-destructive">{t.system.problems[s.service.problem]}</span> : null}
      <span>
        <span className="text-muted-foreground">{t.system.version} </span>
        <code>{s.service.commit}</code>
      </span>
      <span>
        <span className="text-muted-foreground">{t.system.started} </span>
        <RelativeDate iso={s.service.started_at} timeZone={timeZone} time sentence />
      </span>
      <span className="text-muted-foreground">{s.service.go_version}</span>
    </div>
  )
}

/** Hour of the day for a bucket, in the organisation's timezone. */
function hourOf(iso: string, timeZone: string | undefined): string {
  return new Date(iso).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit', timeZone, hourCycle: 'h23' })
}

/**
 * The 5-minute points summed by hour, for the 24 hours ending with this one,
 * oldest first: an hour before the API started, or without requests, is 0.
 */
function hourly(points: RequestPoint[], now: number = Date.now()): { at: string; requests: number; errors: number }[] {
  const hour = 3_600_000
  const end = Math.floor(now / hour) * hour
  const out = Array.from({ length: 24 }, (_, i) => ({ at: new Date(end - (23 - i) * hour).toISOString(), requests: 0, errors: 0 }))
  for (const p of points) {
    const slot = out[23 - (end - Math.floor(Date.parse(p.at) / hour) * hour) / hour]
    if (slot) {
      slot.requests += p.requests
      slot.errors += p.errors
    }
  }
  return out
}

function Requests({ s, timeZone }: { s: SystemStatus; timeZone: string | undefined }) {
  const r = s.requests
  const hours = hourly(r.series)
  const max = Math.max(1, ...hours.map((h) => h.requests))
  return (
    <Panel title={t.system.requests} description={t.system.requestsSince}>
      <div className="flex flex-col gap-5">
        <KeyFigures>
          <Kpi label={t.system.total} value={number(r.requests)} detail={formatDateTime(r.since, timeZone)} />
          <Kpi label={t.system.failed} value={number(r.errors)} detail={t.system.failedShare(percentOf(r.errors, r.requests))} alert={r.errors > 0} />
          <Kpi label={t.system.median} value={`${r.p50_ms} ms`} detail={t.system.overMs(r.p50_ms)} />
          <Kpi label={t.system.p95} value={`${r.p95_ms} ms`} detail={t.system.overMs(r.p95_ms)} />
        </KeyFigures>
        {r.requests === 0 ? (
          <p className="text-sm text-muted-foreground">{t.system.noRequests}</p>
        ) : (
          <>
            <figure>
              <figcaption className="mb-2 text-sm font-medium">{t.system.perHour}</figcaption>
              <ul className="flex h-28 items-end gap-0.5 border-b border-border" aria-label={t.system.perHour}>
                {hours.map((h) => {
                  const caption = t.system.perHourCaption(h.requests, h.errors, hourOf(h.at, timeZone))
                  return (
                    <li key={h.at} title={caption} aria-label={caption} className="flex h-full min-w-0 flex-1 flex-col justify-end">
                      <span
                        className="flex w-full flex-col justify-end overflow-hidden rounded-t-sm bg-primary/70"
                        style={{ height: `${Math.max(h.requests > 0 ? 2 : 0, (100 * h.requests) / max)}%` }}
                      >
                        {h.errors > 0 ? <span className="w-full bg-destructive" style={{ height: `${Math.max(8, (100 * h.errors) / h.requests)}%` }} /> : null}
                      </span>
                    </li>
                  )
                })}
              </ul>
              <div aria-hidden className="mt-1 flex justify-between text-xs text-muted-foreground tabular-nums">
                <span>{hours[0] ? hourOf(hours[0].at, timeZone) : null}</span>
                <span>{hourOf(hours[hours.length - 1]!.at, timeZone)}</span>
              </div>
            </figure>
            <div>
              <h3 className="mb-2 text-sm font-medium">{t.system.slowest}</h3>
              <Table stack="list">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.system.route}</TableHead>
                    <TableHead className="text-right">{t.system.total}</TableHead>
                    <TableHead className="text-right">{t.system.failed}</TableHead>
                    <TableHead className="text-right">{t.system.median}</TableHead>
                    <TableHead className="text-right">{t.system.p95}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.slowest.map((x) => (
                    <TableRow key={x.route} className={stackedBreak}>
                      <TableCell className="font-mono text-xs break-all whitespace-normal stacked:order-1 stacked:w-full">{x.route}</TableCell>
                      <TableCell className="text-right tabular-nums stacked:order-3 stacked:w-auto stacked:text-xs">{number(x.requests)}</TableCell>
                      <TableCell className={cn('text-right tabular-nums stacked:order-3 stacked:w-auto stacked:text-xs', x.errors > 0 && 'text-destructive')}>
                        {number(x.errors)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums stacked:order-3 stacked:w-auto stacked:text-xs">{x.p50_ms} ms</TableCell>
                      <TableCell className="text-right tabular-nums stacked:order-3 stacked:w-auto stacked:text-xs">{x.p95_ms} ms</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>
    </Panel>
  )
}

function Database({ s, className }: { s: SystemStatus; className?: string }) {
  const d = s.database
  const growth = d.earlier
    ? t.system.grew(percentOf(d.bytes - d.earlier.bytes, d.earlier.bytes), Math.max(1, Math.round((Date.now() - Date.parse(d.earlier.day)) / 86_400_000)))
    : null
  return (
    <Panel title={t.system.database} className={className}>
      <dl className="divide-y divide-border">
        <Fact label={t.system.size}>
          {formatBytes(d.bytes)}
          {growth ? <span className="block text-xs text-muted-foreground">{growth}</span> : null}
        </Fact>
        <Fact label={t.system.postgres}>{d.version}</Fact>
        <Fact label={t.system.connections}>
          {t.system.connectionsDetail(d.connections['active'] ?? 0, d.connections['idle'] ?? 0, d.max_connections)}
        </Fact>
        {s.pool ? (
          <Fact label={t.system.pool}>
            {t.system.poolDetail(s.pool.acquired, s.pool.idle, s.pool.max)}
            {s.pool.waits > 0 ? <span className="block text-xs text-muted-foreground">{t.system.poolWaits(s.pool.waits)}</span> : null}
          </Fact>
        ) : null}
        <Fact label={t.system.oldestTransaction}>
          {d.oldest_transaction_seconds > 0 ? t.system.seconds(Math.round(d.oldest_transaction_seconds)) : t.system.none}
        </Fact>
        <Fact label={t.system.migration}>{d.latest_migration ? <code className="text-xs">{d.latest_migration.file}</code> : t.system.none}</Fact>
      </dl>
      <h3 className="mt-4 mb-2 text-sm font-medium">{t.system.largestTables}</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t.system.table}</TableHead>
            <TableHead className="text-right">{t.system.size}</TableHead>
            <TableHead className="text-right">{t.system.rows}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {d.tables.map((x) => (
            <TableRow key={x.name}>
              <TableCell className="font-mono text-xs break-all whitespace-normal">{x.name}</TableCell>
              <TableCell className="text-right tabular-nums">{formatBytes(x.bytes)}</TableCell>
              <TableCell className="text-right tabular-nums">{number(x.rows)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  )
}

function Retention({ s, timeZone }: { s: SystemStatus; timeZone: string | undefined }) {
  const r = s.retention
  return (
    <Panel title={t.system.retention} description={t.system.retentionHint}>
      <dl className="divide-y divide-border">
        <Fact label={t.system.signInRecords}>{t.system.days(r.auth_events_days)}</Fact>
        <Fact label={t.system.errorRecords}>{t.system.days(r.error_events_days)}</Fact>
        <Fact label={t.system.endedSignIns}>{t.system.days(r.ended_session_days)}</Fact>
        <Fact label={t.system.lastUpkeep}>
          {r.last_run.at ? (
            <>
              <RelativeDate iso={r.last_run.at} timeZone={timeZone} time sentence />
              <span className="block text-xs text-muted-foreground">
                {r.last_run.failed ? t.system.upkeepFailed : t.system.upkeepDeleted(r.last_run.auth_events_deleted, r.last_run.error_events_deleted)}
              </span>
            </>
          ) : (
            t.system.notYet
          )}
        </Fact>
      </dl>
    </Panel>
  )
}

const errorKinds: ErrorKind[] = ['server', 'panic', 'client']

const kindLabel = (k: string) => (errorKinds as string[]).includes(k) ? t.system.kinds[k as ErrorKind] : k

/** The error list, newest occurrence first, one error open beside it (/system/errors/<id>). */
function ErrorsTab({ selected, timeZone, navigate }: { selected: string | undefined; timeZone: string | undefined; navigate: Navigate }) {
  const { client } = useApi()
  const [kind, setKind] = useState<ErrorKind | ''>('')
  const first = useLoad<ErrorPage>(() => client.system.errors(kind ? { kind } : {}), [kind])
  const [older, setOlder] = useState<{ kind: string; errors: ErrorEvent[]; next: string | null } | null>(null)
  const [olderState, setOlderState] = useState<{ loading: boolean; error?: unknown }>({ loading: false })
  const olderPages = older?.kind === kind ? older : null
  const errors = useMemo(() => [...(first.data?.errors ?? []), ...(olderPages?.errors ?? [])], [first.data, olderPages])
  const next = olderPages ? olderPages.next : (first.data?.next ?? null)
  const loadOlder = async () => {
    if (!next) return
    setOlderState({ loading: true })
    try {
      const page = await client.system.errors({ ...(kind ? { kind } : {}), after: next })
      setOlder({ kind, errors: [...(olderPages?.errors ?? []), ...page.errors], next: page.next })
      setOlderState({ loading: false })
    } catch (error) {
      setOlderState({ loading: false, error })
    }
  }
  const reload = () => {
    setOlder(null)
    first.reload()
  }
  const open = (id: string) => navigate({ name: 'system', tab: 'errors', error: id }, { scroll: false })
  const close = () => navigate({ name: 'system', tab: 'errors' }, { scroll: false })
  const beside = selected !== undefined

  return (
    <div className={cn(beside && 'lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)] lg:items-start lg:gap-6')}>
      <div className={cn('min-w-0', beside && 'max-lg:hidden')}>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <label className="text-sm font-medium">
            {t.system.kind}
            <Select className="mt-1.5" value={kind} onChange={(e) => setKind(e.target.value as ErrorKind | '')}>
              <option value="">{t.system.allKinds}</option>
              {errorKinds.map((k) => (
                <option key={k} value={k}>
                  {t.system.kinds[k]}
                </option>
              ))}
            </Select>
          </label>
          <RefreshButton loading={first.loading} onClick={reload} />
        </div>
        {first.error ? (
          <ErrorState error={first.error} onRetry={reload} />
        ) : !first.data ? (
          <Loading />
        ) : errors.length === 0 ? (
          <EmptyState>{kind ? t.system.noMatch : t.system.noErrors}</EmptyState>
        ) : (
          <>
            <Table stack="list" stackBelow={beside ? 'sm' : 'md'}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.system.lastSeen}</TableHead>
                  <TableHead>{t.system.error}</TableHead>
                  {beside ? null : <TableHead>{t.system.kind}</TableHead>}
                  <TableHead className="text-right">{t.system.count}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {errors.map((e) => (
                  <TableRow
                    key={e.id}
                    data-state={selected === e.id ? 'selected' : undefined}
                    aria-current={selected === e.id ? 'true' : undefined}
                    className={cn(stackedBreak, 'cursor-pointer stacked:hover:bg-muted/50 stacked:data-[state=selected]:bg-muted')}
                    onClick={(ev) => {
                      if ((ev.target as Element).closest('a, button') || window.getSelection()?.toString()) return
                      open(e.id)
                    }}
                  >
                    <TableCell className="whitespace-nowrap tabular-nums stacked:order-2 stacked:w-auto stacked:text-xs stacked:text-muted-foreground">
                      <RelativeDate iso={e.last_seen} timeZone={timeZone} time />
                    </TableCell>
                    <TableCell className="whitespace-normal stacked:order-1 stacked:w-auto stacked:min-w-0 stacked:flex-1">
                      <a
                        {...linkTo({ name: 'system', tab: 'errors', error: e.id }, () => open(e.id))}
                        className="line-clamp-2 rounded-sm font-medium break-words underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {e.message}
                      </a>
                      <span className="block font-mono text-xs break-all text-muted-foreground">{e.route}</span>
                    </TableCell>
                    {beside ? null : (
                      <TableCell className="whitespace-nowrap text-muted-foreground stacked:hidden">{kindLabel(e.kind)}</TableCell>
                    )}
                    <TableCell className="text-right tabular-nums stacked:order-3 stacked:w-auto stacked:text-xs">{t.system.times(e.count)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {olderState.error ? <ErrorState error={olderState.error} onRetry={() => void loadOlder()} /> : null}
            {next ? (
              <div className="mt-4 flex justify-center">
                <Button variant="outline" disabled={olderState.loading} onClick={() => void loadOlder()}>
                  {t.system.older}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
      {selected ? (
        <aside
          aria-label={t.system.error}
          className="lg:sticky lg:top-8 lg:max-h-[calc(100dvh-4rem)] lg:overflow-y-auto lg:rounded-lg lg:border lg:border-border lg:bg-card lg:p-4"
        >
          <ErrorPane key={selected} id={selected} listed={errors.find((e) => e.id === selected)} timeZone={timeZone} onClose={close} />
        </aside>
      ) : null}
    </div>
  )
}

function ErrorPane({ id, listed, timeZone, onClose }: { id: string; listed: ErrorEvent | undefined; timeZone: string | undefined; onClose: () => void }) {
  const { client } = useApi()
  const loaded = useLoad(() => (listed ? Promise.resolve(listed) : client.system.error(id)), [id, listed])
  const e = listed ?? loaded.data
  return (
    <article aria-label={t.system.error} className="relative flex flex-col gap-4">
      <div className="flex items-center lg:contents">
        <Button variant="ghost" className="-ml-3 lg:hidden" onClick={onClose}>
          <ArrowLeft aria-hidden /> {t.system.errors}
        </Button>
        <Button variant="ghost" size="icon" className="absolute -top-2 -right-2 max-lg:hidden" aria-label={t.system.closeError} onClick={onClose}>
          <X aria-hidden />
        </Button>
      </div>
      {!e && loaded.error ? (
        <ErrorState title={t.system.notFound} error={loaded.error} onRetry={loaded.reload} />
      ) : !e ? (
        <Loading />
      ) : (
        <>
          <header className="lg:pr-10">
            <h2 className="text-lg font-semibold break-words">{e.message}</h2>
            <p className="text-sm text-muted-foreground">
              {kindLabel(e.kind)} · {t.system.times(e.count)}
            </p>
          </header>
          <dl className="divide-y divide-border">
            <Fact label={t.system.route}>
              <code className="text-xs break-all">{e.route}</code>
            </Fact>
            {e.status ? <Fact label={t.system.httpStatus}>{e.status}</Fact> : null}
            <Fact label={t.system.firstSeen}>{formatDateTime(e.first_seen, timeZone)}</Fact>
            <Fact label={t.system.lastSeen}>{formatDateTime(e.last_seen, timeZone)}</Fact>
            <Fact label={t.system.who}>{e.last_user_name ?? t.system.nobody}</Fact>
            <Fact label={t.system.where}>{sourceLabel(e.source)}</Fact>
            {e.last_user_agent ? <Fact label={t.system.device}>{deviceText(e.last_user_agent)}</Fact> : null}
            {e.last_request_id ? (
              <Fact label={t.system.reference}>
                <code className="text-xs break-all">{e.last_request_id}</code>
                <span className="block text-xs text-muted-foreground">{t.system.referenceHint}</span>
              </Fact>
            ) : null}
          </dl>
          {e.stack ? (
            <details>
              <summary className="cursor-pointer text-sm font-medium">{t.system.stack}</summary>
              <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre">{e.stack}</pre>
            </details>
          ) : null}
        </>
      )}
    </article>
  )
}
