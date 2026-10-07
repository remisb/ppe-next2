import {
  type AccessReview,
  type LiveSession,
  type ReviewUser,
  type SecurityEntry,
  type SecurityPage as SecurityPageData,
  SECURITY_KINDS,
  decodeToken,
  isPermission,
  isSecurityKind,
  isSecurityReason,
} from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { deviceText, sourceLabel } from '@ppe/audit'
import { Alert } from '@ppe/ui/components/alert'
import { Badge } from '@ppe/ui/components/badge'
import { Button, buttonVariants } from '@ppe/ui/components/button'
import { Input, Select } from '@ppe/ui/components/field'
import { RefreshButton } from '@ppe/ui/components/panel'
import { RelativeDate } from '@ppe/ui/components/relative-date'
import { EmptyState, ErrorState, Loading, PageHeader } from '@ppe/ui/components/states'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, stackedBreak } from '@ppe/ui/components/table'
import { errorText, useLoad } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { SlidersHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'

import { t } from '@/i18n'
import { type Route, type SecurityFilter, type SecurityTab, linkTo, securityTabs } from '@/lib/router'
import { roleName } from '@/lib/users'

type SecurityRoute = Extract<Route, { name: 'security' }>
type Navigate = (to: Route, options?: { replace?: boolean; scroll?: boolean }) => void

/**
 * Security (/security): sign-ins and failed attempts, every user's signed-in
 * devices (/security/devices) and the access review (/security/review), each
 * a tab in the address. Needs security.read; signing someone's device out
 * needs users.manage too, as on Users.
 */
export function SecurityPage({ route, navigate }: { route: SecurityRoute; navigate: Navigate }) {
  const { client } = useApi()
  const settings = useLoad(() => client.settings())
  const tz = settings.data?.timezone
  const label: Record<SecurityTab, string> = { 'sign-ins': t.security.signIns, devices: t.security.devices, review: t.security.review }
  return (
    <>
      <PageHeader title={t.security.title} description={t.security.description} />
      <nav aria-label={t.security.sections} className="-mt-2 mb-5 flex gap-1 overflow-x-auto border-b border-border">
        {securityTabs.map((tab) => (
          <a
            key={tab}
            {...linkTo({ name: 'security', tab, filter: {} }, navigate)}
            aria-current={route.tab === tab ? 'page' : undefined}
            className="-mb-px shrink-0 border-b-2 border-transparent px-3 py-2.5 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:border-primary aria-[current=page]:text-foreground"
          >
            {label[tab]}
          </a>
        ))}
      </nav>
      {route.tab === 'sign-ins' ? <SignIns filter={route.filter} timeZone={tz} navigate={navigate} /> : null}
      {route.tab === 'devices' ? <Devices timeZone={tz} /> : null}
      {route.tab === 'review' ? <Review timeZone={tz} navigate={navigate} /> : null}
    </>
  )
}

/** What happened, in the language in use; a kind this app does not know yet as stored. */
function kindLabel(kind: string): string {
  return isSecurityKind(kind) ? t.security.kinds[kind] : kind
}

function reasonLabel(reason: string | null): string | null {
  if (!reason) return null
  return isSecurityReason(reason) ? t.security.reasons[reason] : reason
}

const failures = new Set(['sign_in_failed', 'reauth_failed', 'refresh_reused'])

/** Sign-ins: every security event, newest first, filtered in the address, a page at a time. */
function SignIns({ filter, timeZone, navigate }: { filter: SecurityFilter; timeZone: string | undefined; navigate: Navigate }) {
  const { client } = useApi()
  const session = useSession()
  const seesUsers = session.can('users.read')
  const people = useLoad(() => (seesUsers ? client.users.list() : Promise.resolve([])), [seesUsers])
  const [showFilters, setShowFilters] = useState(false)

  const dateError = filter.from && filter.to && filter.from > filter.to ? t.security.fromAfterTo : undefined
  const filterKey = JSON.stringify(filter)
  const first = useLoad<SecurityPageData>(
    () => (dateError ? Promise.resolve({ events: [], next: null }) : client.security.events(filter)),
    [filterKey],
  )
  const [older, setOlder] = useState<{ key: string; events: SecurityEntry[]; next: string | null } | null>(null)
  const [olderState, setOlderState] = useState<{ loading: boolean; error?: unknown }>({ loading: false })
  const olderPages = older?.key === filterKey ? older : null
  const events = useMemo(() => [...(first.data?.events ?? []), ...(olderPages?.events ?? [])], [first.data, olderPages])
  const next = olderPages ? olderPages.next : (first.data?.next ?? null)

  const loadOlder = async () => {
    if (!next) return
    setOlderState({ loading: true })
    try {
      const page = await client.security.events({ ...filter, after: next })
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
  const setFilter = (key: keyof SecurityFilter, value: string) => {
    const nextFilter: SecurityFilter = { ...filter, [key]: value || undefined }
    navigate({ name: 'security', tab: 'sign-ins', filter: clean(nextFilter) }, { replace: true, scroll: false })
  }
  const activeFilters = [filter.kind, filter.user, filter.from, filter.to].filter(Boolean).length

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{timeZone ? t.security.timesIn(timeZone) : null}</p>
        <div className="flex gap-2">
          <Button variant="outline" className="md:hidden" aria-expanded={showFilters} aria-controls="security-filters" onClick={() => setShowFilters((v) => !v)}>
            <SlidersHorizontal aria-hidden /> {activeFilters > 0 ? t.security.filtersCount(activeFilters) : t.security.filters}
          </Button>
          <RefreshButton loading={first.loading} onClick={reload} />
        </div>
      </div>
      <section
        id="security-filters"
        aria-label={t.security.filters}
        className={cn('mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(2,minmax(0,1fr))_minmax(0,1.6fr)_auto]', !showFilters && 'max-md:hidden')}
      >
        <label className="text-sm font-medium">
          {t.security.kind}
          <Select className="mt-1.5" value={filter.kind ?? ''} onChange={(e) => setFilter('kind', e.target.value)}>
            <option value="">{t.security.allKinds}</option>
            {SECURITY_KINDS.map((k) => (
              <option key={k} value={k}>
                {t.security.kinds[k]}
              </option>
            ))}
          </Select>
        </label>
        {seesUsers ? (
          <label className="text-sm font-medium">
            {t.security.person}
            <Select className="mt-1.5" value={filter.user ?? ''} onChange={(e) => setFilter('user', e.target.value)}>
              <option value="">{t.security.everyone}</option>
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
            {t.security.from}
            <Input type="date" className="mt-1.5" value={filter.from ?? ''} max={filter.to || undefined} onChange={(e) => setFilter('from', e.target.value)} />
          </label>
          <label className="text-sm font-medium">
            {t.security.to}
            <Input type="date" className="mt-1.5" value={filter.to ?? ''} min={filter.from || undefined} onChange={(e) => setFilter('to', e.target.value)} />
          </label>
        </div>
        <div className="flex items-end">
          <Button
            variant="ghost"
            className="w-full sm:w-auto"
            disabled={activeFilters === 0}
            onClick={() => navigate({ name: 'security', tab: 'sign-ins', filter: {} }, { replace: true, scroll: false })}
          >
            {t.security.clearFilters}
          </Button>
        </div>
      </section>
      {dateError ? (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {dateError}
        </p>
      ) : null}
      {events.some((e) => e.kind === 'refresh_reused') ? (
        <Alert variant="destructive" className="mb-4">
          {t.security.copiedHint}
        </Alert>
      ) : null}

      {first.error && !dateError ? (
        <ErrorState error={first.error} onRetry={reload} />
      ) : !first.data ? (
        <Loading />
      ) : events.length === 0 ? (
        <EmptyState>{activeFilters > 0 ? t.security.noMatch : t.security.noEvents}</EmptyState>
      ) : (
        <>
          <Table stack="list">
            <TableHeader>
              <TableRow>
                <TableHead>{t.security.when}</TableHead>
                <TableHead>{t.security.what}</TableHead>
                <TableHead>{t.security.who}</TableHead>
                <TableHead>{t.security.where}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((e) => (
                <TableRow key={e.id} className={stackedBreak}>
                  <TableCell className="whitespace-nowrap tabular-nums stacked:order-2 stacked:w-auto stacked:text-xs stacked:text-muted-foreground">
                    <RelativeDate iso={e.occurred_at} timeZone={timeZone} time />
                  </TableCell>
                  <TableCell className="whitespace-normal stacked:order-1 stacked:w-auto stacked:min-w-0 stacked:flex-1">
                    <span className={cn('font-medium', failures.has(e.kind) && 'text-destructive')}>{kindLabel(e.kind)}</span>
                    {reasonLabel(e.reason) && e.reason !== 'signed_out' ? (
                      <span className="block text-xs text-muted-foreground">{reasonLabel(e.reason)}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="whitespace-normal stacked:order-3 stacked:w-auto stacked:text-xs">
                    {accountName(e)}
                    {e.user_email && e.user_name ? <span className="block text-xs break-all text-muted-foreground">{e.user_email}</span> : null}
                    {e.actor_name && e.actor_id !== e.user_id ? (
                      <span className="block text-xs text-muted-foreground">{t.security.by(e.actor_name)}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground stacked:order-4 stacked:w-auto stacked:text-xs">
                    {e.user_agent ? deviceText(e.user_agent) : null}
                    {e.ip ? <span className="block tabular-nums">{e.ip}</span> : null}
                    {e.source ? <span className="block text-xs">{sourceLabel(e.source)}</span> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {olderState.error ? <ErrorState error={olderState.error} onRetry={() => void loadOlder()} /> : null}
          {next ? (
            <div className="mt-4 flex justify-center">
              <Button variant="outline" disabled={olderState.loading} onClick={() => void loadOlder()}>
                {t.security.older}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </>
  )
}

/** The account an event names: its user, or an unknown email told apart by its hash's start. */
function accountName(e: SecurityEntry): string {
  if (e.user_name) return e.user_name
  return e.email_ref ? t.security.unknownAccountRef(e.email_ref) : t.security.unknownAccount
}

/** The filter without empty values, so addresses stay short. */
function clean(f: SecurityFilter): SecurityFilter {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v)) as SecurityFilter
}

/**
 * Signed-in devices: every user's live sign-ins, last used first. Whoever
 * manages users signs one out; their own device here is marked and signs out
 * with the usual Sign out.
 */
function Devices({ timeZone }: { timeZone: string | undefined }) {
  const { client } = useApi()
  const session = useSession()
  const list = useLoad<LiveSession[]>(() => client.security.sessions())
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const mayEnd = session.can('users.manage')
  const current = decodeToken(session.token)?.sid

  const end = async (s: LiveSession) => {
    setBusy(s.id)
    setMessage(null)
    try {
      await client.security.endSession(s.id)
      setMessage({ ok: true, text: t.security.signedOut(s.user_name) })
      list.reload()
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) })
    } finally {
      setBusy(null)
    }
  }

  const people = new Set((list.data ?? []).map((s) => s.user_id)).size
  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">{t.security.devicesHint}</p>
        <RefreshButton loading={list.loading} onClick={list.reload} />
      </div>
      {message ? (
        <p role={message.ok ? 'status' : 'alert'} className={cn('mb-4 text-sm', message.ok ? 'text-muted-foreground' : 'text-destructive')}>
          {message.text}
        </p>
      ) : null}
      {list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <Loading />
      ) : list.data.length === 0 ? (
        <EmptyState>{t.security.noDevices}</EmptyState>
      ) : (
        <>
          <p className="mb-2 text-sm text-muted-foreground">
            {t.security.deviceCount(list.data.length)} · {t.security.people(people)}
          </p>
          <Table stack="list">
            <TableHeader>
              <TableRow>
                <TableHead>{t.security.name}</TableHead>
                <TableHead>{t.security.device}</TableHead>
                <TableHead>{t.security.lastUsed}</TableHead>
                <TableHead>{t.security.signedInAt}</TableHead>
                {mayEnd ? <TableHead className="text-right">{t.security.signOut}</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.map((s) => {
                const device = deviceText(s.user_agent)
                return (
                  <TableRow key={s.id} className="stacked:grid stacked:grid-cols-[minmax(0,1fr)_auto] stacked:gap-x-3">
                    <TableCell className="whitespace-normal stacked:col-start-1 stacked:row-start-1">
                      <span className="font-medium">{s.user_name}</span>
                      {s.id === current ? (
                        <Badge variant="secondary" className="ml-2 align-middle">
                          {t.security.thisDevice}
                        </Badge>
                      ) : null}
                      <span className="block text-xs break-all text-muted-foreground">{s.user_email}</span>
                    </TableCell>
                    <TableCell className="whitespace-normal stacked:col-start-1 stacked:row-start-2 stacked:text-xs">
                      {device}
                      <span className="block text-xs text-muted-foreground tabular-nums">
                        {s.ip}
                        {' · '}
                        {s.keep_signed_in ? t.security.keptSignedIn : t.security.untilBrowserCloses}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums stacked:col-start-1 stacked:row-start-3 stacked:text-xs stacked:text-muted-foreground">
                      <span className="hidden stacked:inline">{t.security.lastUsed} </span>
                      <RelativeDate iso={s.last_used_at} timeZone={timeZone} time sentence />
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums stacked:hidden">
                      <RelativeDate iso={s.created_at} timeZone={timeZone} time />
                    </TableCell>
                    {mayEnd ? (
                      <TableCell className="text-right stacked:col-start-2 stacked:[grid-row:1/span_3] stacked:flex stacked:items-center">
                        {s.id === current ? null : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="pointer-coarse:h-11"
                            aria-label={t.security.signOutDevice(device, s.user_name)}
                            disabled={busy !== null}
                            onClick={() => void end(s)}
                          >
                            {t.security.signOut}
                          </Button>
                        )}
                      </TableCell>
                    ) : null}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </>
      )}
    </>
  )
}

/** The flags on a user, as badges' words: Administrator, no sign-in, unused for the dormant period. */
function flagLabel(flag: string, days: number): string {
  switch (flag) {
    case 'administrator':
      return t.security.administrator
    case 'no_sign_in':
      return t.security.noSignIn
    case 'dormant':
      return t.security.dormant(days)
    default:
      return flag
  }
}

/**
 * The access review: every user with their roles, what those allow and their
 * last sign-in, the users worth a look marked, and Mark as reviewed, which the
 * Audit log records.
 */
function Review({ timeZone, navigate }: { timeZone: string | undefined; navigate: Navigate }) {
  const { client } = useApi()
  const session = useSession()
  const review = useLoad<AccessReview>(() => client.security.review())
  const [marked, setMarked] = useState<AccessReview | null>(null)
  const [onlyMarked, setOnlyMarked] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const data = marked ?? review.data

  const mark = async () => {
    setSaving(true)
    setError(undefined)
    try {
      setMarked(await client.security.markReviewed())
    } catch (err) {
      setError(errorText(err))
    } finally {
      setSaving(false)
    }
  }
  const reload = () => {
    setMarked(null)
    review.reload()
  }

  if (review.error && !data) return <ErrorState error={review.error} onRetry={reload} />
  if (!data) return <Loading />
  const days = data.dormant_after_days
  const users = onlyMarked ? data.users.filter((u) => u.flags.length > 0) : data.users
  const last = data.last_review

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">{t.security.reviewHint(days)}</p>
        <RefreshButton loading={review.loading} onClick={reload} />
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
        <p className="text-sm">
          {last ? (
            <>
              <span className="font-medium">{t.security.lastReviewed}</span>{' '}
              <a {...linkTo({ name: 'audit', filter: { area: 'security' }, event: last.event_id }, navigate)} className="underline-offset-4 hover:underline">
                <RelativeDate iso={last.at} timeZone={timeZone} time sentence />
              </a>
              {last.by_name ? ` ${t.security.reviewedBy(last.by_name)}` : null}
            </>
          ) : (
            t.security.neverReviewed
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          {session.can('users.manage') ? (
            <a {...linkTo({ name: 'users' }, navigate)} className={cn(buttonVariants({ variant: 'outline' }))}>
              {t.security.manageUsers}
            </a>
          ) : null}
          <Button disabled={saving} onClick={() => void mark()}>
            {t.security.markReviewed}
          </Button>
        </div>
      </div>
      {marked ? (
        <p role="status" className="mb-4 text-sm text-muted-foreground">
          {t.security.markedReviewed}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <label className="mb-3 flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-primary" checked={onlyMarked} onChange={(e) => setOnlyMarked(e.target.checked)} />
        {t.security.onlyMarked}
      </label>
      {users.length === 0 ? (
        <EmptyState>{t.security.noMarked}</EmptyState>
      ) : (
        <Table stack="list" stackBelow="lg">
          <TableHeader>
            <TableRow>
              <TableHead>{t.security.name}</TableHead>
              <TableHead>{t.security.roles}</TableHead>
              <TableHead>{t.security.permissions}</TableHead>
              <TableHead>{t.security.lastSignIn}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <ReviewRow key={u.id} user={u} days={days} timeZone={timeZone} you={u.id === session.userId} />
            ))}
          </TableBody>
        </Table>
      )}

      {data.unused_roles.length > 0 ? (
        <section className="mt-6">
          <h2 className="text-base font-semibold">{t.security.unusedRoles}</h2>
          <p className="mb-2 text-sm text-muted-foreground">{t.security.unusedRolesHint}</p>
          <p className="flex flex-wrap gap-1">
            {data.unused_roles.map((r) => (
              <Badge key={r.id} variant="secondary">
                {roleName(r)}
              </Badge>
            ))}
          </p>
        </section>
      ) : null}
    </>
  )
}

function ReviewRow({ user: u, days, timeZone, you }: { user: ReviewUser; days: number; timeZone: string | undefined; you: boolean }) {
  const labels = u.permissions.map((p) => (isPermission(p) ? t.roles.permission[p].label : p))
  return (
    <TableRow className={cn(stackedBreak, !u.is_active && 'text-muted-foreground')}>
      <TableCell className="whitespace-normal stacked:order-1 stacked:w-auto stacked:min-w-0 stacked:flex-1">
        <span className="font-medium">{u.name}</span>
        {you ? (
          <Badge variant="outline" className="ml-2 align-middle">
            {t.users.you}
          </Badge>
        ) : null}
        <span className="block text-xs break-all text-muted-foreground">{u.email}</span>
        <span className="mt-1 flex flex-wrap gap-1">
          {u.is_active ? null : <Badge variant="outline">{t.security.inactive}</Badge>}
          {/* Administrators show by their role, and no sign-in in its column. */}
          {u.flags
            .filter((f) => f === 'dormant')
            .map((f) => (
              <Badge key={f} variant="destructive">
                {flagLabel(f, days)}
              </Badge>
            ))}
        </span>
      </TableCell>
      <TableCell className="whitespace-normal stacked:order-3 stacked:w-full">
        <span className="flex flex-wrap gap-1">
          {u.roles.length === 0 ? <span className="text-xs text-muted-foreground">{t.security.noRoles}</span> : null}
          {u.roles.map((r) => (
            <Badge key={r.id} variant={r.key === 'admin' ? 'default' : 'secondary'}>
              {roleName(r)}
            </Badge>
          ))}
        </span>
      </TableCell>
      <TableCell className="whitespace-normal stacked:order-4 stacked:w-full stacked:text-xs">
        {labels.length === 0 ? null : (
          <details>
            <summary className="cursor-pointer text-sm stacked:text-xs">{t.security.permissionCount(labels.length)}</summary>
            <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
              {labels.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </details>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap tabular-nums stacked:order-2 stacked:w-auto stacked:text-xs stacked:text-muted-foreground">
        {u.last_sign_in_at ? <RelativeDate iso={u.last_sign_in_at} timeZone={timeZone} time /> : <span className="text-muted-foreground">{t.security.noSignIn}</span>}
        {u.live_sessions > 0 ? <span className="block text-xs text-muted-foreground">{t.security.signedInOn(u.live_sessions)}</span> : null}
      </TableCell>
    </TableRow>
  )
}
