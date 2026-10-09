import { AUDIT_EVENTS, type AuditEntry, type AuditPage as AuditPageData, type AuditVerification, isPermission } from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { type DescribeOptions, ChangeDetail, areaLabel, auditText, auditTitle, changedBy, sourceLabel } from '@ppe/audit'
import { staffHref } from '@ppe/routing'
import { Button } from '@ppe/ui/components/button'
import { Field, Input, Select, controlProps } from '@ppe/ui/components/field'
import { FormSheet } from '@ppe/ui/components/form-sheet'
import { RefreshButton } from '@ppe/ui/components/panel'
import { RelativeDate } from '@ppe/ui/components/relative-date'
import { EmptyState, ErrorState, Loading, PageHeader } from '@ppe/ui/components/states'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, stackedBreak } from '@ppe/ui/components/table'
import { formatDateTime } from '@ppe/ui/lib/dates'
import { errorText, useLoad } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { ArrowLeft, Download, ExternalLink, ShieldAlert, ShieldCheck, SlidersHorizontal, X } from 'lucide-react'
import { type FormEvent, type ReactNode, useMemo, useState } from 'react'

import { intlLocale, t } from '@/i18n'
import { type AuditFilter, type Route, linkTo } from '@/lib/router'
import { roleName } from '@/lib/users'

type AuditRoute = Extract<Route, { name: 'audit' }>

/** Which events each area's filter offers: the events of its record types. */
const areaEvents: Record<string, string[]> = {
  users: ['user.', 'role.'],
  employees: ['employee.'],
  catalogue: ['catalogue.'],
  item_sets: ['item_set.'],
  orders: ['order.'],
  settings: ['settings.'],
  security: ['access_review.'],
  audit: ['audit.'],
}

const eventsOf = (area: string | undefined) =>
  AUDIT_EVENTS.filter((e) => !area || (areaEvents[area] ?? []).some((prefix) => e.startsWith(prefix)))

const recordLinkClass = 'rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring'

/**
 * The Audit log (/audit): every recorded change, newest first, filtered by
 * area, change, person, days and record, the filters in the address. A change
 * opens at /audit/<id>: beside the list from lg, in its place below. Older
 * changes load a page at a time. Needs audit.read.
 */
export function AuditPage({ route, navigate }: { route: AuditRoute; navigate: (to: Route, options?: { replace?: boolean; scroll?: boolean }) => void }) {
  const { client } = useApi()
  const session = useSession()
  const { filter, event: selected } = route
  const seesUsers = session.can('users.read')
  const settings = useLoad(() => client.settings())
  const people = useLoad(() => (seesUsers ? client.users.list() : Promise.resolve([])), [seesUsers])
  const roles = useLoad(() => (seesUsers ? client.roles.list() : Promise.resolve([])), [seesUsers])
  const [showFilters, setShowFilters] = useState(false)
  const [exporting, setExporting] = useState(false)
  const tz = settings.data?.timezone

  const dateError = filter.from && filter.to && filter.from > filter.to ? t.audit.fromAfterTo : undefined
  const filterKey = JSON.stringify(filter)
  const first = useLoad<AuditPageData>(
    () => (dateError ? Promise.resolve({ events: [], next: null }) : client.audit.list(filter)),
    [filterKey],
  )
  // Older pages, appended; they belong to the filter they were loaded for.
  const [older, setOlder] = useState<{ key: string; events: AuditEntry[]; next: string | null } | null>(null)
  const [olderState, setOlderState] = useState<{ loading: boolean; error?: unknown }>({ loading: false })
  const olderPages = older?.key === filterKey ? older : null
  const events = useMemo(() => [...(first.data?.events ?? []), ...(olderPages?.events ?? [])], [first.data, olderPages])
  const next = olderPages ? olderPages.next : (first.data?.next ?? null)

  const loadOlder = async () => {
    if (!next) return
    setOlderState({ loading: true })
    try {
      const page = await client.audit.list({ ...filter, after: next })
      setOlder({ key: filterKey, events: [...(olderPages?.events ?? []), ...page.events], next: page.next })
      setOlderState({ loading: false })
    } catch (error) {
      setOlderState({ loading: false, error })
    }
  }

  const reload = () => {
    setOlder(null)
    first.reload()
  }

  const go = (to: AuditFilter, event?: string) =>
    navigate(event ? { name: 'audit', filter: to, event } : { name: 'audit', filter: to }, { replace: true, scroll: false })
  const setFilter = (key: keyof AuditFilter, value: string) => {
    const nextFilter: AuditFilter = { ...filter, [key]: value || undefined }
    // A change of area keeps the change filter only when that change is in it.
    if (key === 'area' && nextFilter.event && !eventsOf(nextFilter.area).includes(nextFilter.event as (typeof AUDIT_EVENTS)[number])) delete nextFilter.event
    go(clean(nextFilter), selected)
  }
  const open = (id: string) => navigate({ name: 'audit', filter, event: id }, { scroll: false })
  const close = () => navigate({ name: 'audit', filter }, { scroll: false })

  const options: DescribeOptions = useMemo(() => {
    const byId = new Map((roles.data ?? []).map((r) => [r.id, roleName(r)]))
    return {
      roleName: (id) => byId.get(id),
      permissionLabel: (key) => (isPermission(key) ? t.roles.permission[key].label : undefined),
    }
  }, [roles.data])

  const recordFiltered = filter.entity_type && filter.entity_id
  const recordLabel = recordFiltered ? (events.find((e) => e.entity_id === filter.entity_id)?.entity_label ?? t.audit.unnamed) : null
  const activeFilters = [filter.area, filter.event, filter.actor, filter.from, filter.to].filter(Boolean).length
  const beside = selected !== undefined

  return (
    <div className={cn(beside && 'lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)] lg:items-start lg:gap-6')}>
      <div className={cn('min-w-0', beside && 'max-lg:hidden')}>
        <PageHeader
          title={t.audit.title}
          description={t.audit.description}
          actions={
            <>
              {session.can('audit.export') ? (
                <Button variant="outline" onClick={() => setExporting(true)}>
                  <Download aria-hidden /> {t.audit.exportAction}
                </Button>
              ) : null}
              <Button variant="outline" className="md:hidden" aria-expanded={showFilters} aria-controls="audit-filters" onClick={() => setShowFilters((v) => !v)}>
                <SlidersHorizontal aria-hidden /> {activeFilters > 0 ? t.audit.filtersCount(activeFilters) : t.audit.filters}
              </Button>
              <RefreshButton loading={first.loading} onClick={reload} />
            </>
          }
        />

        <Seals timeZone={tz} />
        {session.can('audit.export') ? <ExportSheet open={exporting} onClose={() => setExporting(false)} filter={filter} /> : null}

        <section
          id="audit-filters"
          aria-label={t.audit.filters}
          className={cn('mb-4 grid gap-3 sm:grid-cols-2', !beside && 'xl:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.8fr)]', !showFilters && 'max-md:hidden')}
        >
          <label className="text-sm font-medium">
            {t.audit.area}
            <Select className="mt-1.5" value={filter.area ?? ''} onChange={(e) => setFilter('area', e.target.value)}>
              <option value="">{t.audit.allAreas}</option>
              {Object.keys(areaEvents).map((a) => (
                <option key={a} value={a}>
                  {areaLabel(a)}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-sm font-medium">
            {t.audit.event}
            <Select className="mt-1.5" value={filter.event ?? ''} onChange={(e) => setFilter('event', e.target.value)}>
              <option value="">{t.audit.allEvents}</option>
              {eventsOf(filter.area).map((e) => (
                <option key={e} value={e}>
                  {auditTitle(e)}
                </option>
              ))}
            </Select>
          </label>
          {seesUsers ? (
            <label className="text-sm font-medium">
              {t.audit.person}
              <Select className="mt-1.5" value={filter.actor ?? ''} onChange={(e) => setFilter('actor', e.target.value)}>
                <option value="">{t.audit.everyone}</option>
                {(people.data ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm font-medium">
              {t.audit.from}
              <Input type="date" className="mt-1.5" value={filter.from ?? ''} max={filter.to || undefined} onChange={(e) => setFilter('from', e.target.value)} />
            </label>
            <label className="text-sm font-medium">
              {t.audit.to}
              <Input type="date" className="mt-1.5" value={filter.to ?? ''} min={filter.from || undefined} onChange={(e) => setFilter('to', e.target.value)} />
            </label>
          </div>
          <div className={cn('flex items-end', !beside && 'xl:col-span-4 xl:justify-end')}>
            <Button
              variant="ghost"
              className="w-full sm:w-auto"
              disabled={activeFilters === 0}
              onClick={() => go(recordOnly(filter), selected)}
            >
              {t.audit.clearFilters}
            </Button>
          </div>
        </section>
        {dateError ? (
          <p role="alert" className="mb-4 text-sm text-destructive">
            {dateError}
          </p>
        ) : null}

        {recordFiltered ? (
          <p className="mb-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-muted px-3 py-1 font-medium">{t.audit.recordFilter(recordLabel ?? '')}</span>
            <Button variant="ghost" size="sm" onClick={() => go(withoutRecord(filter), selected)}>
              <X aria-hidden /> {t.audit.allRecords}
            </Button>
          </p>
        ) : null}

        {first.error && !dateError ? (
          <ErrorState error={first.error} onRetry={reload} />
        ) : !first.data ? (
          <Loading />
        ) : events.length === 0 ? (
          <EmptyState>{activeFilters > 0 || recordFiltered ? t.audit.noMatch : t.audit.noChanges}</EmptyState>
        ) : (
          <>
            {/* Four short columns fit side by side from 48rem; beside an open change, from 30rem. */}
            <Table stack="list" stackBelow={beside ? 'sm' : 'md'}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.audit.when}</TableHead>
                  <TableHead>{t.audit.what}</TableHead>
                  <TableHead>{t.audit.who}</TableHead>
                  {beside ? null : <TableHead>{t.audit.where}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((e) => (
                  <TableRow
                    key={e.id}
                    data-state={selected === e.id ? 'selected' : undefined}
                    aria-current={selected === e.id ? 'true' : undefined}
                    className={cn(stackedBreak, 'cursor-pointer stacked:hover:bg-muted/50 stacked:data-[state=selected]:bg-muted')}
                    // The whole row opens the change; its name is the real link, for
                    // keyboards, screen readers and "open in new tab".
                    onClick={(ev) => {
                      if ((ev.target as Element).closest('a, button') || window.getSelection()?.toString()) return
                      open(e.id)
                    }}
                  >
                    <TableCell className="whitespace-nowrap tabular-nums stacked:order-2 stacked:w-auto stacked:text-xs stacked:text-muted-foreground">
                      <RelativeDate iso={e.occurred_at} timeZone={tz} time />
                    </TableCell>
                    <TableCell className="whitespace-normal stacked:order-1 stacked:w-auto stacked:min-w-0 stacked:flex-1">
                      <a {...linkTo({ name: 'audit', filter, event: e.id }, () => open(e.id))} className={cn(recordLinkClass, 'font-medium')}>
                        {auditTitle(e.event)}
                      </a>
                      <span className="block text-xs text-muted-foreground">{recordName(e)}</span>
                    </TableCell>
                    <TableCell className="whitespace-normal stacked:order-3 stacked:w-auto stacked:text-xs stacked:text-muted-foreground">
                      {changedBy(e)}
                    </TableCell>
                    {beside ? null : (
                      <TableCell className="whitespace-normal text-muted-foreground stacked:hidden">{sourceLabel(e.source)}</TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {olderState.error ? <ErrorState error={olderState.error} onRetry={() => void loadOlder()} /> : null}
            {next ? (
              <div className="mt-4 flex justify-center">
                <Button variant="outline" disabled={olderState.loading} onClick={() => void loadOlder()}>
                  {t.audit.older}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>

      {selected ? (
        <aside aria-label={t.audit.change} className="lg:sticky lg:top-8 lg:max-h-[calc(100dvh-4rem)] lg:overflow-y-auto lg:rounded-lg lg:border lg:border-border lg:bg-card lg:p-4">
          <ChangePane
            key={selected}
            id={selected}
            listed={events.find((e) => e.id === selected)}
            timeZone={tz}
            options={options}
            onClose={close}
            showRecord={(e) => go({ entity_type: e.entity_type, entity_id: e.entity_id }, e.id)}
            navigate={navigate}
          />
        </aside>
      ) : null}
    </div>
  )
}

/** Only the record a filter is narrowed to: what Clear filters keeps. */
function recordOnly(f: AuditFilter): AuditFilter {
  return f.entity_type && f.entity_id ? { entity_type: f.entity_type, entity_id: f.entity_id } : {}
}

/** A filter no longer narrowed to one record. */
function withoutRecord({ entity_type: _type, entity_id: _id, ...rest }: AuditFilter): AuditFilter {
  return rest
}

/** The filter without empty values, so addresses stay short. */
function clean(f: AuditFilter): AuditFilter {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v)) as AuditFilter
}

/** The record a change was made to, as the list names it. */
function recordName(e: AuditEntry): string {
  const name =
    e.entity_label ??
    (e.entity_type === 'settings'
      ? areaLabel('settings')
      : e.entity_type === 'access_review'
        ? t.security.review
        : e.entity_type === 'audit_log'
          ? t.audit.title
          : t.audit.unnamed)
  return e.entity_deleted ? `${name} (${t.audit.deleted})` : name
}

/** Where a record opens: the staff app's page for it, Roles here, or nowhere (users, settings, deleted records). */
function recordHref(e: AuditEntry, navigate: (to: Route) => void): { href: string; onClick?: (ev: React.MouseEvent) => void } | null {
  if (e.entity_deleted) return null
  const id = encodeURIComponent(e.entity_id)
  switch (e.entity_type) {
    case 'employee':
      return { href: staffHref(`/employees/${id}`) }
    case 'catalogue_item':
      return { href: staffHref(`/catalogue/${id}`) }
    case 'order':
      return { href: staffHref(`/orders/${id}`) }
    case 'asset':
      return { href: staffHref(`/assets/${id}`) }
    case 'item_set':
      return { href: staffHref('/item-sets') }
    case 'role':
      return linkTo({ name: 'roles' }, navigate)
    case 'access_review':
      return linkTo({ name: 'security', tab: 'review', filter: {} }, navigate)
    default:
      return null
  }
}

/** One change, beside the list or in its place: from the list when it is there, else loaded. */
function ChangePane({
  id,
  listed,
  timeZone,
  options,
  onClose,
  showRecord,
  navigate,
}: {
  id: string
  listed: AuditEntry | undefined
  timeZone: string | undefined
  options: DescribeOptions
  onClose: () => void
  showRecord: (e: AuditEntry) => void
  navigate: (to: Route) => void
}) {
  const { client } = useApi()
  const loaded = useLoad(() => (listed ? Promise.resolve(listed) : client.audit.get(id)), [id, listed])
  const e = listed ?? loaded.data
  let record: ReactNode = null
  if (e) {
    const href = recordHref(e, navigate)
    const staff = e.entity_type !== 'role' && e.entity_type !== 'access_review' && href !== null
    record = (
      <span className="flex flex-col items-start gap-1">
        {href ? (
          <a {...href} className={cn(recordLinkClass, 'inline-flex items-center gap-1 font-medium')}>
            {recordName(e)}
            {staff ? <ExternalLink aria-label={t.audit.openRecord} className="size-3.5" /> : null}
          </a>
        ) : (
          <span className="font-medium">{recordName(e)}</span>
        )}
        <button type="button" className={cn(recordLinkClass, 'cursor-pointer text-xs text-muted-foreground')} onClick={() => showRecord(e)}>
          {t.audit.recordChanges}
        </button>
      </span>
    )
  }
  return (
    <article aria-label={t.audit.change} className="relative flex flex-col gap-4">
      <div className="flex items-center lg:contents">
        <Button variant="ghost" className="-ml-3 lg:hidden" onClick={onClose}>
          <ArrowLeft aria-hidden /> {t.audit.title}
        </Button>
        <Button variant="ghost" size="icon" className="absolute -top-2 -right-2 max-lg:hidden" aria-label={t.audit.closeChange} onClick={onClose}>
          <X aria-hidden />
        </Button>
      </div>
      {!e && loaded.error ? (
        <ErrorState title={t.audit.notFound} error={loaded.error} onRetry={loaded.reload} />
      ) : !e ? (
        <Loading />
      ) : (
        <>
          <header className="lg:pr-10">
            <h2 className="text-xl font-semibold">{auditTitle(e.event)}</h2>
            <p className="text-sm text-muted-foreground">{auditText().areas[e.area as keyof ReturnType<typeof auditText>['areas']] ?? e.area}</p>
          </header>
          <ChangeDetail entry={e} timeZone={timeZone} record={record} options={options} />
        </>
      )}
    </article>
  )
}

/** A day as the seals name it: a calendar date, not a moment, so no timezone shifts it. */
function dayText(iso: string): string {
  return new Date(iso).toLocaleDateString(intlLocale(), { dateStyle: 'medium', timeZone: 'UTC' })
}

/**
 * The seals: through which day the log is sealed, whether the latest check
 * found every sealed day whole, and Verify to check again now. A mismatch is
 * an alert: someone changed the record behind the app.
 */
function Seals({ timeZone }: { timeZone: string | undefined }) {
  const { client } = useApi()
  const integrity = useLoad(() => client.audit.integrity())
  const [checked, setChecked] = useState<AuditVerification | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const i = integrity.data
  if (!i) return integrity.error ? <ErrorState error={integrity.error} onRetry={integrity.reload} /> : null
  const v = checked ?? i.verification
  const verify = async () => {
    setBusy(true)
    setError(undefined)
    try {
      setChecked(await client.audit.verify())
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  const bad = v?.mismatch ?? null
  return (
    <section
      aria-label={t.audit.seals}
      className={cn(
        'mb-4 flex flex-col gap-2 rounded-xl border p-4 text-sm sm:flex-row sm:items-start',
        bad ? 'border-destructive/40 bg-destructive/10' : 'border-border bg-card',
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {bad ? (
          <ShieldAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-destructive" />
        ) : (
          <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0">
          {bad ? (
            <>
              <p role="alert" className="font-medium text-destructive">
                {t.audit.mismatch}: {dayText(bad.day)}, {t.audit.problems[bad.problem]}.
              </p>
              <p className="text-muted-foreground">{t.audit.mismatchHint}</p>
            </>
          ) : (
            <p>
              {i.last_sealed ? (
                <>
                  <span className="font-medium">
                    {t.audit.sealedThrough} {dayText(i.last_sealed)}.
                  </span>{' '}
                  {v ? t.audit.allMatch(v.days) : t.audit.notChecked} {v && v.unsealed > 0 ? t.audit.unsealed(v.unsealed) : null}
                </>
              ) : (
                t.audit.notSealedYet
              )}
            </p>
          )}
          {!bad ? (
            <p className="text-muted-foreground">
              {i.tsa
                ? i.last_stamped
                  ? t.audit.timestampedThrough(dayText(i.last_stamped), hostOf(i.tsa))
                  : t.audit.noStampYet(hostOf(i.tsa))
                : t.audit.timestampsOff}{' '}
              {i.tsa && v && v.stamps_waiting > 0 ? t.audit.stampsWaiting(v.stamps_waiting) : null}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {v ? (
              <>
                {capitalize(t.audit.lastChecked)} {formatDateTime(v.checked_at, timeZone)}.{' '}
              </>
            ) : null}
            {i.retention_days > 0 ? t.audit.keptFor(Math.round(i.retention_days / 365)) : null} <span className="max-md:hidden">{t.audit.sealsHint}</span>
            {i.tsa ? <span className="max-md:hidden"> {t.audit.stampsHint}</span> : null}
          </p>
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </div>
      <Button size="sm" variant="outline" className="shrink-0 self-start" disabled={busy} onClick={() => void verify()}>
        {busy ? t.audit.verifying : t.audit.verify}
      </Button>
    </section>
  )
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** A timestamp service's host, as people know it (timestamp.digicert.com). */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Today, in the organisation's calendar as the browser has it, as YYYY-MM-DD. */
function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Export: the changes the Audit log's filters select, between two days at
 * most a year apart (the filter's own days, else the last 30), as CSV or JSON
 * lines. The download is recorded on the log.
 */
function ExportSheet({ open, onClose, filter }: { open: boolean; onClose: () => void; filter: AuditFilter }) {
  const { client } = useApi()
  const today = new Date()
  const [format, setFormat] = useState<'csv' | 'jsonl'>('csv')
  const [from, setFrom] = useState(filter.from ?? isoDay(new Date(today.getTime() - 29 * 86_400_000)))
  const [to, setTo] = useState(filter.to ?? isoDay(today))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const problem = !from || !to ? t.audit.exportNeedsDays : from > to ? t.audit.fromAfterTo : Date.parse(to) - Date.parse(from) > 365 * 86_400_000 ? t.audit.exportTooLong : undefined

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (problem) return
    setBusy(true)
    setError(undefined)
    try {
      // The filter's own days give way to the ones chosen here.
      const file = await client.audit.export(format, { ...filter, from, to })
      const url = URL.createObjectURL(file.blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file.filename
      document.body.append(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      onClose()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={t.audit.exportTitle}
      description={t.audit.exportHint}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button type="submit" form="audit-export" disabled={busy || problem !== undefined}>
            <Download aria-hidden /> {busy ? t.audit.exporting : t.audit.download}
          </Button>
        </>
      }
    >
      <form id="audit-export" onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm font-medium">
            {t.audit.from}
            <Input type="date" className="mt-1.5" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-sm font-medium">
            {t.audit.to}
            <Input type="date" className="mt-1.5" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <Field label={t.audit.format}>
          {(props) => (
            <Select {...controlProps(props)} value={format} onChange={(e) => setFormat(e.target.value as 'csv' | 'jsonl')}>
              <option value="csv">{t.audit.csv}</option>
              <option value="jsonl">{t.audit.jsonl}</option>
            </Select>
          )}
        </Field>
        {problem || error ? (
          <p role="alert" className="text-sm text-destructive">
            {problem ?? error}
          </p>
        ) : null}
      </form>
    </FormSheet>
  )
}
