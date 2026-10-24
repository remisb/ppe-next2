import type { UsageReport } from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { areaLabel, sourceLabel } from '@ppe/audit'
import { staffHref } from '@ppe/routing'
import { BarChart, type Column, HeatStrip, Sparkline } from '@ppe/ui/components/charts'
import { KeyFigures, Kpi, Panel, RefreshButton } from '@ppe/ui/components/panel'
import { EmptyState, Loaded, PageHeader } from '@ppe/ui/components/states'
import { formatDay } from '@ppe/ui/lib/dates'
import { deviceName } from '@ppe/ui/lib/devices'
import { useLoad } from '@ppe/ui/lib/use-load'
import { linkVariants } from '@ppe/ui/components/link'
import { formatNumber } from '@ppe/i18n'

import { intlLocale, t } from '@/i18n'
import { type Route, linkTo } from '@/lib/router'
import { roleName } from '@/lib/users'

const percent = (part: number, whole: number) => (whole > 0 ? Math.round((100 * part) / whole) : 0)

/** A calendar day (YYYY-MM-DD) as people read it: "7 Oct" short, for an axis; long, as every date is written (formatDay). */
function dayText(day: string, long = false): string {
  if (long) return formatDay(day)
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(intlLocale(), { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

const dayColumns = (days: string[]): Column[] => days.map((d) => ({ key: d, short: dayText(d), long: dayText(d, true) }))

/**
 * Usage (/usage, usage.read): who uses the apps and from what, sign-ins and
 * changes over time, the confirmation-link funnel and the data's quality,
 * from what the API records anyway (docs/specs/usage-service.md).
 */
export function UsagePage({ navigate }: { navigate: (to: Route) => void }) {
  const { client } = useApi()
  const session = useSession()
  const loaded = useLoad(() => client.usage())
  return (
    <>
      <PageHeader title={t.usage.title} description={t.usage.description} actions={<RefreshButton loading={loaded.loading} onClick={loaded.reload} />} />
      <Loaded load={loaded}>
        {(r) => (
          <div className="flex flex-col gap-4 md:gap-6">
            <p className="-mt-2 text-sm text-muted-foreground">{t.usage.timesIn(r.timezone)}</p>
            <Figures r={r} onSignIns={session.can('security.read') ? (day) => navigate({ name: 'security', tab: 'sign-ins', filter: { from: day, to: day } }) : undefined} />
            <Active r={r} />
            <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
              <SignIns r={r} />
              <Funnel r={r} />
            </div>
            <Changes r={r} navigate={session.can('audit.read') ? navigate : undefined} />
            <div className="grid gap-4 md:gap-6 lg:grid-cols-3">
              <Devices r={r} />
              <Languages r={r} />
              <Quality r={r} />
            </div>
          </div>
        )}
      </Loaded>
    </>
  )
}

function Figures({ r, onSignIns }: { r: UsageReport; onSignIns: ((day: string) => void) | undefined }) {
  const last = r.days.length - 1
  const today = r.days[last]
  return (
    <KeyFigures>
      <Kpi label={t.usage.activeToday} value={formatNumber(r.active.total[last] ?? 0)} detail={t.usage.ofAccounts(r.active.users)} />
      <Kpi label={t.usage.active7} value={formatNumber(r.active.last_7)} detail={t.usage.ofAccounts(r.active.users)} />
      <Kpi label={t.usage.active30} value={formatNumber(r.active.last_30)} detail={t.usage.ofAccounts(r.active.users)} />
      <Kpi
        label={t.usage.signInsToday}
        value={formatNumber(r.sign_ins[last] ?? 0)}
        detail={t.usage.failed(r.failed_sign_ins[last] ?? 0)}
        alert={(r.failed_sign_ins[last] ?? 0) > 0}
        help={{ body: t.overview.figureHelp.signIns }}
        onOpen={onSignIns && today ? () => onSignIns(today) : undefined}
        openHint={t.overview.openFigure.signIns}
      />
    </KeyFigures>
  )
}

function Active({ r }: { r: UsageReport }) {
  const apps = Object.entries(r.active.by_app).filter(([, v]) => v.some((n) => n > 0))
  const series = apps.length > 1
    ? apps.map(([app, values], i) => ({ label: sourceLabel(app as 'workwear'), className: i === 0 ? 'bg-primary/80' : 'bg-foreground/40', values }))
    : [{ label: t.usage.everyone, className: 'bg-primary/80', values: r.active.total }]
  const last = r.days.length - 1
  const roles = r.active.by_role.filter((s) => s.values.some((n) => n > 0))
  return (
    <Panel title={t.usage.activePeople} description={t.usage.activePeopleHint}>
      <BarChart
        columns={dayColumns(r.days)}
        series={series}
        format={formatNumber}
        caption={t.usage.activePeople}
        cell={(s, i) => formatNumber(s.values[i] ?? 0)}
        columnHead={t.usage.day}
        dense
      />
      {roles.length > 0 ? (
        <div className="mt-5">
          <h3 className="text-sm font-medium">{t.usage.byRole}</h3>
          <p className="mb-2 text-xs text-muted-foreground">{t.usage.byRoleHint}</p>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {roles.map((s) => (
              <li key={s.role.id} className="flex items-center gap-3 text-sm">
                <span className="w-28 shrink-0 truncate">{roleName(s.role)}</span>
                <Sparkline values={s.values} label={`${roleName(s.role)}: ${t.usage.roleToday(s.values[last] ?? 0)}`} className="min-w-0 flex-1" />
                <span className="w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{t.usage.roleToday(s.values[last] ?? 0)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  )
}

function SignIns({ r }: { r: UsageReport }) {
  return (
    <Panel title={t.usage.signIns}>
      <BarChart
        columns={dayColumns(r.days)}
        series={[
          { label: t.usage.signedIn, className: 'bg-primary/80', values: r.sign_ins },
          { label: t.usage.failedSignIns, className: 'bg-destructive/80', values: r.failed_sign_ins },
        ]}
        format={formatNumber}
        caption={t.usage.signIns}
        cell={(s, i) => formatNumber(s.values[i] ?? 0)}
        columnHead={t.usage.day}
        dense
      />
    </Panel>
  )
}

function Funnel({ r }: { r: UsageReport }) {
  const f = r.funnel
  const steps = [
    { key: 'created', label: t.usage.created, value: f.created },
    { key: 'opened', label: t.usage.opened, value: f.opened },
    { key: 'confirmed', label: t.usage.confirmed, value: f.confirmed },
  ]
  return (
    <Panel title={t.usage.funnel} description={t.usage.funnelHint}>
      {f.created === 0 ? (
        <p className="text-sm text-muted-foreground">{t.usage.noLinks}</p>
      ) : (
        <>
          <ol className="flex flex-col gap-3">
            {steps.map((s) => (
              <li key={s.key} className="text-sm">
                <div className="flex justify-between gap-3">
                  <span>{s.label}</span>
                  <span className="tabular-nums">
                    {formatNumber(s.value)}
                    {s.key === 'created' ? null : <span className="ml-2 text-xs text-muted-foreground">{t.usage.ofSent(percent(s.value, f.created))}</span>}
                  </span>
                </div>
                <div aria-hidden className="mt-1 h-2 rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary/80" style={{ width: `${percent(s.value, f.created)}%` }} />
                </div>
              </li>
            ))}
          </ol>
          <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-xs text-muted-foreground">
            {[
              [t.usage.waiting, f.waiting],
              [t.usage.expired, f.expired],
              [t.usage.replaced, f.replaced],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border border-border p-2">
                <dd className="text-base font-semibold text-foreground tabular-nums">{formatNumber(Number(value))}</dd>
                <dt>{label}</dt>
              </div>
            ))}
          </dl>
        </>
      )}
    </Panel>
  )
}

/** navigate, for a reader who may open the Audit log: each person's name opens their changes there. */
function Changes({ r, navigate }: { r: UsageReport; navigate: ((to: Route) => void) | undefined }) {
  const columns: Column[] = r.weeks.map((w) => ({ key: w, short: dayText(w), long: t.usage.weekOf(dayText(w, true)) }))
  const rows = r.changes.map((c) => ({ key: c.area, label: areaLabel(c.area), values: c.counts }))
  const max = Math.max(1, ...r.top_people.map((p) => p.changes))
  return (
    <Panel title={t.usage.changes} description={t.usage.changesHint}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <HeatStrip rows={rows} columns={columns} caption={t.usage.changes} rowHead={t.usage.area} />
        </div>
        <div>
          <h3 className="mb-2 text-sm font-medium">{t.usage.mostActive}</h3>
          {r.top_people.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.usage.noChanges}</p>
          ) : (
            <ol className="flex flex-col gap-2.5">
              {r.top_people.map((p) => (
                <li key={p.id} className="text-sm">
                  <div className="flex justify-between gap-3">
                    {navigate ? (
                      <a {...linkTo({ name: 'audit', filter: { actor: p.id } }, navigate)} className={linkVariants({ className: 'truncate' })}>
                        {p.name}
                      </a>
                    ) : (
                      <span className="truncate">{p.name}</span>
                    )}
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{t.usage.changesCount(p.changes)}</span>
                  </div>
                  <div aria-hidden className="mt-1 h-1.5 rounded-full bg-muted">
                    <div className="h-full rounded-full bg-foreground/60" style={{ width: `${percent(p.changes, max)}%` }} />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </Panel>
  )
}

/** Counts by key, largest first. */
function ranked(counts: Map<string, number>): [string, number][] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

function Devices({ r }: { r: UsageReport }) {
  const kinds = new Map<string, number>()
  const systems = new Map<string, number>()
  const browsers = new Map<string, number>()
  const add = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n)
  for (const d of r.devices) {
    const { browser, system } = deviceName(d.user_agent)
    const kind = system === 'iPhone' || system === 'Android' ? 'phone' : system === 'iPad' ? 'tablet' : 'computer'
    add(kinds, t.usage.kinds[kind], d.people)
    add(systems, system ?? t.usage.unknown, d.people)
    add(browsers, browser ?? t.usage.unknown, d.people)
  }
  const list = (title: string, m: Map<string, number>) => (
    <div>
      {title ? <h3 className="mb-1 text-xs font-medium text-muted-foreground">{title}</h3> : null}
      <ul className="text-sm">
        {ranked(m).map(([k, n]) => (
          <li key={k} className="flex justify-between gap-3 py-0.5">
            <span className="truncate">{k}</span>
            <span className="tabular-nums text-muted-foreground">{formatNumber(n)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
  return (
    <Panel title={t.usage.devices} description={t.usage.devicesHint}>
      {r.devices.length === 0 ? (
        <EmptyState>{t.usage.noDevices}</EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          {list('', kinds)}
          <div className="grid grid-cols-2 gap-4">
            {list(t.usage.systems, systems)}
            {list(t.usage.browsers, browsers)}
          </div>
        </div>
      )}
    </Panel>
  )
}

function Languages({ r }: { r: UsageReport }) {
  const names = new Intl.DisplayNames([intlLocale()], { type: 'language' })
  const list = (title: string, counts: Record<string, number>) => {
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    return (
      <div>
        <h3 className="mb-1 text-xs font-medium text-muted-foreground">{title}</h3>
        <ul className="text-sm">
          {ranked(new Map(Object.entries(counts))).map(([lang, n]) => (
            <li key={lang || 'none'} className="py-0.5">
              <div className="flex justify-between gap-3">
                <span>{lang ? (names.of(lang) ?? lang) : t.usage.noLanguage}</span>
                <span className="tabular-nums text-muted-foreground">{formatNumber(n)}</span>
              </div>
              <div aria-hidden className="mt-0.5 h-1 rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary/70" style={{ width: `${percent(n, total)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    )
  }
  return (
    <Panel title={t.usage.languages}>
      <div className="flex flex-col gap-4">
        {list(t.usage.users, r.user_languages)}
        {list(t.usage.employees, r.employee_languages)}
      </div>
    </Panel>
  )
}

function Quality({ r }: { r: UsageReport }) {
  const q = r.quality
  const last = q[q.length - 1]
  const first = q[0]
  // Each opens where it is fixed, in the staff app: Employees missing a size, the catalogue's Incomplete items.
  const trend = (label: string, href: string, values: number[], part: number, total: number) => (
    <div>
      <div className="flex justify-between gap-3 text-sm">
        <a href={href} className={linkVariants()}>
          {label}
        </a>
        <span className="tabular-nums text-muted-foreground">{t.usage.ofTotal(part, total)}</span>
      </div>
      <Sparkline values={values} label={`${label}: ${t.usage.trend(values[0] ?? 0, values[values.length - 1] ?? 0)}`} className="mt-1" />
    </div>
  )
  return (
    <Panel title={t.usage.quality} description={t.usage.qualityHint}>
      {!last || !first ? (
        <p className="text-sm text-muted-foreground">{t.usage.noSamples}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {trend(t.usage.missingSizes, staffHref('/employees?missing=1'), q.map((s) => s.employees_missing_sizes), last.employees_missing_sizes, last.employees)}
          {trend(t.usage.unpriced, staffHref('/catalogue?status=incomplete'), q.map((s) => s.catalogue_unpriced), last.catalogue_unpriced, last.catalogue_active)}
        </div>
      )}
    </Panel>
  )
}
