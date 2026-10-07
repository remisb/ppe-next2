import { type AttentionItem, type AttentionKey, type Overview, isAttentionKey } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { formatBytes } from '@ppe/backups'
import { buttonVariants } from '@ppe/ui/components/button'
import { KeyFigures, Kpi, RefreshButton } from '@ppe/ui/components/panel'
import { ErrorState, Loading, PageHeader } from '@ppe/ui/components/states'
import { capitalize, formatRelative } from '@ppe/ui/lib/dates'
import { useLoad } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { AlertOctagon, AlertTriangle, CheckCircle2, Info } from 'lucide-react'

import { intlLocale, t } from '@/i18n'
import { type Route, linkTo } from '@/lib/router'

/** Where each attention item is put right. */
const resolveAt: Record<AttentionKey, Route> = {
  backups_not_running: { name: 'system', tab: 'backups' },
  last_backup_failed: { name: 'system', tab: 'backups' },
  copied_sign_in: { name: 'security', tab: 'sign-ins', filter: { kind: 'refresh_reused' } },
  failed_sign_ins: { name: 'security', tab: 'sign-ins', filter: { kind: 'sign_in_failed' } },
  error_rate: { name: 'system', tab: 'errors' },
  new_errors: { name: 'system', tab: 'errors' },
  review_overdue: { name: 'security', tab: 'review', filter: {} },
  database_growth: { name: 'system', tab: 'status' },
}

const severityStyle = {
  critical: { icon: AlertOctagon, className: 'border-destructive/40 bg-destructive/10', iconClass: 'text-destructive' },
  warning: { icon: AlertTriangle, className: 'border-amber-500/40 bg-amber-500/10', iconClass: 'text-amber-600 dark:text-amber-400' },
  info: { icon: Info, className: 'border-border bg-card', iconClass: 'text-muted-foreground' },
} as const

/**
 * The Overview (/), Administration's first screen: what needs attention,
 * worst first, each with the way to where it is put right; then the figures.
 * Each part is there only for whoever may open the area it comes from.
 */
export function OverviewPage({ navigate }: { navigate: (to: Route) => void }) {
  const { client } = useApi()
  const loaded = useLoad(() => client.overview())
  const tz = useLoad(() => client.settings()).data?.timezone
  const o = loaded.data
  return (
    <>
      <PageHeader title={t.overview.title} description={t.overview.description} actions={<RefreshButton loading={loaded.loading} onClick={loaded.reload} />} />
      {loaded.error ? (
        <ErrorState error={loaded.error} onRetry={loaded.reload} />
      ) : !o ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-6">
          <section aria-labelledby="attention">
            <h2 id="attention" className="mb-3 text-base font-semibold">
              {t.overview.attention}
            </h2>
            {o.attention.length === 0 ? (
              <div role="status" className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-sm">
                <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span>
                  <span className="block font-medium">{t.overview.allClear}</span>
                  <span className="text-muted-foreground">{t.overview.allClearHint}</span>
                </span>
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {o.attention.map((item) => (
                  <AttentionRow key={item.key} item={item} navigate={navigate} />
                ))}
              </ul>
            )}
          </section>
          <Figures o={o} timeZone={tz} />
        </div>
      )}
    </>
  )
}

function AttentionRow({ item, navigate }: { item: AttentionItem; navigate: (to: Route) => void }) {
  const style = severityStyle[item.severity] ?? severityStyle.info
  const Icon = style.icon
  if (!isAttentionKey(item.key)) {
    // An item a newer API raises that this app has no words for yet.
    return (
      <li className={cn('rounded-xl border p-4 text-sm', style.className)}>
        <span className="font-medium">{item.key}</span>
      </li>
    )
  }
  const words = t.overview.items[item.key]
  return (
    <li className={cn('flex flex-col gap-3 rounded-xl border p-4 text-sm sm:flex-row sm:items-center', style.className)}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Icon aria-hidden className={cn('mt-0.5 size-5 shrink-0', style.iconClass)} />
        <div className="min-w-0">
          <p className="font-medium">
            <span className="sr-only">{t.overview.severity[item.severity]}: </span>
            {words.title}
          </p>
          <p className="text-muted-foreground">{words.detail({ count: item.count ?? 0, percent: item.percent ?? 0, days: item.days ?? 0 })}</p>
        </div>
      </div>
      <a {...linkTo(resolveAt[item.key], navigate)} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'shrink-0 self-start sm:self-center')}>
        {words.action}
      </a>
    </li>
  )
}

/** The figures of the areas the reader may see. */
function Figures({ o, timeZone }: { o: Overview; timeZone: string | undefined }) {
  const tiles = [
    o.users ? <Kpi key="users" label={t.overview.activeUsers} value={String(o.users.active)} detail={t.overview.inactiveUsers(o.users.inactive)} /> : null,
    o.security ? (
      <Kpi key="signed-in" label={t.overview.signedIn} value={String(o.security.signed_in)} detail={t.overview.signedInDetail(o.security.devices)} />
    ) : null,
    o.security ? (
      <Kpi
        key="sign-ins"
        label={t.overview.signInsToday}
        value={String(o.security.sign_ins_today)}
        detail={t.overview.failedToday(o.security.failed_today)}
        alert={o.security.failed_today > 0}
      />
    ) : null,
    o.requests ? (
      <Kpi
        key="requests"
        label={t.overview.requests}
        value={new Intl.NumberFormat(intlLocale()).format(o.requests.requests)}
        detail={t.overview.requestErrors(o.requests.errors)}
        alert={o.requests.errors > 0}
      />
    ) : null,
    o.requests ? <Kpi key="db" label={t.overview.database} value={formatBytes(o.requests.database_bytes)} detail={t.overview.databaseDetail} /> : null,
    o.backups ? (
      <Kpi
        key="backup"
        label={t.overview.lastBackup}
        value={o.backups.last_success_at ? capitalize(formatRelative(o.backups.last_success_at, new Date(), timeZone, { time: true })) : t.overview.noBackup}
        detail={t.backups.title}
        alert={o.backups.stale || o.backups.agent_offline || o.backups.last_run_failed}
      />
    ) : null,
  ].filter(Boolean)
  if (tiles.length === 0) return null
  return (
    <section aria-labelledby="figures">
      <h2 id="figures" className="mb-3 text-base font-semibold">
        {t.overview.figures}
      </h2>
      <KeyFigures>{tiles}</KeyFigures>
    </section>
  )
}
