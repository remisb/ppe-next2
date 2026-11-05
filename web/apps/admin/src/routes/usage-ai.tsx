import type { AICall, AIUsageReport } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { sourceLabel } from '@ppe/audit'
import { formatNumber } from '@ppe/i18n'
import { Button } from '@ppe/ui/components/button'
import { BarChart, BarList, type Column } from '@ppe/ui/components/charts'
import { KeyFigures, Kpi, Panel } from '@ppe/ui/components/panel'
import { Loaded } from '@ppe/ui/components/states'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, stackedBreak } from '@ppe/ui/components/table'
import { formatDateTime, isoDay } from '@ppe/ui/lib/dates'
import { saveFile } from '@ppe/ui/lib/save-file'
import { errorText, useLoad } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { Download } from 'lucide-react'
import { useState } from 'react'

import { intlLocale, t } from '@/i18n'
import { budgetShare, formatUSD, monthsTo, totalTokens } from '@/lib/ai'

const monthText = (month: string, long = false) =>
  new Date(`${month}-15T12:00:00Z`).toLocaleDateString(intlLocale(), long ? { month: 'long', year: 'numeric', timeZone: 'UTC' } : { month: 'short', timeZone: 'UTC' })

/**
 * AI Usage, on Usage (ai_usage.read; ADR 0007, docs/specs/ai-usage-service.md):
 * this month's cost against the budget, the last twelve months, the split by
 * operation, person and model, and the latest calls, each with its tokens and
 * cost. Every call is in the CSV.
 */
export function AIUsage({ timeZone }: { timeZone: string | undefined }) {
  const { client } = useApi()
  const report = useLoad(() => client.ai.report())
  const calls = useLoad(() => client.ai.calls({ limit: 20 }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const csv = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const file = await client.ai.callsCsv()
      saveFile(file.blob, file.filename)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title={t.usage.ai.title} description={t.usage.ai.hint} anchor="ai-usage">
      <Loaded load={report}>{(r) => <Figures r={r} timeZone={timeZone} />}</Loaded>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{t.usage.ai.latest}</h3>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void csv()}>
          <Download aria-hidden /> {t.usage.ai.csv}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Loaded load={calls}>{(c) => <Calls calls={c} timeZone={timeZone} />}</Loaded>
    </Panel>
  )
}

function Figures({ r, timeZone }: { r: AIUsageReport; timeZone: string | undefined }) {
  const share = budgetShare(r.this_month.cost_micro_usd, r.budget_micro_usd)
  const months = monthsTo(isoDay(new Date(), timeZone).slice(0, 7), 12)
  const cost = new Map(r.months.map((m) => [m.month, m.cost_micro_usd]))
  const columns: Column[] = months.map((m) => ({ key: m, short: monthText(m), long: monthText(m, true) }))
  const parts = [
    { title: t.usage.ai.byOperation, items: r.by_operation.map((k) => ({ ...k, label: t.usage.ai.operations[k.key as keyof typeof t.usage.ai.operations] ?? k.key })) },
    { title: t.usage.ai.byUser, items: r.by_user.map((k) => ({ ...k, label: k.name || t.usage.ai.unknownUser })) },
    { title: t.usage.ai.byModel, items: r.by_model.map((k) => ({ ...k, label: k.key })) },
  ]
  return (
    <div className="flex flex-col gap-6">
      <KeyFigures>
        <Kpi
          label={t.usage.ai.thisMonth}
          value={formatUSD(r.this_month.cost_micro_usd)}
          detail={r.budget_micro_usd === null ? t.usage.ai.noBudget : t.usage.ai.ofBudget(formatUSD(r.budget_micro_usd), Math.round((share ?? 0) * 100))}
          alert={share !== null && share >= 0.8}
        />
        <Kpi label={t.usage.ai.callsThisMonth} value={formatNumber(r.this_month.calls)} detail={t.usage.ai.callsHint} />
      </KeyFigures>
      <div>
        <h3 className="mb-2 text-sm font-medium">{t.usage.ai.months}</h3>
        <BarChart
          columns={columns}
          series={[{ label: t.usage.ai.cost, className: 'bg-primary/80', values: months.map((m) => cost.get(m) ?? 0) }]}
          format={(n) => formatUSD(n)}
          caption={t.usage.ai.months}
          cell={(s, i) => formatUSD(s.values[i] ?? 0)}
          columnHead={t.usage.ai.month}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        {parts.map((p) => (
          <div key={p.title}>
            <h3 className="mb-2 text-sm font-medium">{p.title}</h3>
            {p.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.usage.ai.none}</p>
            ) : (
              <BarList items={p.items.map((k) => ({ key: k.key, label: k.label, value: k.cost_micro_usd, text: `${formatUSD(k.cost_micro_usd)} · ${t.usage.ai.calls(k.calls)}` }))} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function Calls({ calls, timeZone }: { calls: AICall[]; timeZone: string | undefined }) {
  if (calls.length === 0) return <p className="mt-2 text-sm text-muted-foreground">{t.usage.ai.noCalls}</p>
  return (
    <div className="mt-2">
    <Table stack="list">
      <TableHeader>
        <TableRow>
          <TableHead>{t.usage.ai.when}</TableHead>
          <TableHead>{t.usage.ai.what}</TableHead>
          <TableHead>{t.usage.ai.who}</TableHead>
          <TableHead className="text-right">{t.usage.ai.tokens}</TableHead>
          <TableHead className="text-right">{t.usage.ai.cost}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {calls.map((c) => (
          <TableRow key={c.id} className={stackedBreak}>
            <TableCell className="whitespace-nowrap tabular-nums stacked:order-2 stacked:w-auto stacked:text-xs stacked:text-muted-foreground">
              {formatDateTime(c.at, timeZone)}
            </TableCell>
            <TableCell className="whitespace-normal stacked:order-1 stacked:w-auto stacked:min-w-0 stacked:flex-1">
              <span className="font-medium">{t.usage.ai.operations[c.operation] ?? c.operation}</span>
              <span className={cn('block text-xs', c.outcome === 'ok' ? 'text-muted-foreground' : 'text-destructive')}>
                {c.model} · {t.usage.ai.outcomes[c.outcome]}
                {c.error_code ? ` (${c.error_code})` : ''}
              </span>
            </TableCell>
            <TableCell className="whitespace-normal stacked:order-3 stacked:w-auto stacked:text-xs">
              {c.user_name || t.usage.ai.unknownUser}
              <span className="block text-xs text-muted-foreground">{sourceLabel(c.source)}</span>
            </TableCell>
            <TableCell className="text-right tabular-nums stacked:order-4 stacked:w-auto stacked:text-xs">{formatNumber(totalTokens(c.tokens))}</TableCell>
            <TableCell className="text-right tabular-nums stacked:order-5 stacked:w-auto stacked:text-xs">{formatUSD(c.cost_micro_usd, true)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
    </div>
  )
}
