import type { OrderRecord } from '@ppe/api-client'

import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDateTime, statusLabel } from '@/lib/history'
import { cn, formatEuro, formatMonths, formatSize } from '@/lib/utils'

/**
 * The Items Given Record (manual §8), rendered only from the locked receipt
 * the API returns — never from live employee or catalogue data. English and
 * Russian confirmation texts are separate titled blocks. In print (A4) the
 * signature lines appear and app chrome is hidden by the caller.
 */
export function ReceiptDocument({ record, timeZone }: { record: OrderRecord; timeZone?: string | undefined }) {
  const r = record.receipt
  const given = record.status === 'GIVEN'
  const th = 'h-auto border-b border-border px-2 py-1.5 text-left font-medium whitespace-normal print:border-black'
  const td = 'border-b border-border px-2 py-1.5 align-top whitespace-normal print:border-black/40 stacked:border-b-0'

  return (
    <article className="receipt mx-auto max-w-4xl rounded-lg border border-border bg-card p-4 text-card-foreground sm:p-6 print:max-w-none print:rounded-none print:border-0 print:bg-white print:p-0 print:text-black">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold sm:text-xl">Items Given Record / Акт выдачи</h1>
          <p className="text-sm text-muted-foreground print:text-black">Record / Номер: {r.record_number}</p>
        </div>
        <Badge variant={given ? 'default' : 'secondary'} className="print:hidden">
          {statusLabel[record.status]}
        </Badge>
      </header>

      <dl className="mb-6 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
        <Info label="Employee / Работник">
          {r.employee_first_name} {r.employee_last_name}
          {r.employee_code ? ` (${r.employee_code})` : ''}
        </Info>
        <Info label={given ? 'Date given / Дата выдачи' : 'Date ordered / Дата заказа'}>
          {formatDateTime(given && record.given_at ? record.given_at : r.ordered_at, timeZone)}
        </Info>
        <Info label="Given by / Выдал">{record.given_by_name ?? '—'}</Info>
        <Info label="Prepared by / Подготовил">{r.prepared_by_name}</Info>
      </dl>

      {/* A table on paper and wider screens; bilingual cards where it is narrow, as on a phone (Table `stack`, screen only). */}
      <Table stack className="mb-4 border-collapse">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={th}>Item / Предмет</TableHead>
            <TableHead className={th}>Size / Размер</TableHead>
            <TableHead className={cn(th, 'text-right')}>Qty / Кол-во</TableHead>
            <TableHead className={cn(th, 'text-right')}>Unit price / Цена</TableHead>
            <TableHead className={cn(th, 'text-right')}>Total / Сумма</TableHead>
            <TableHead className={th}>Service period / Срок службы</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {r.lines.map((l) => (
            <TableRow key={l.line_no} className="hover:bg-transparent">
              <TableCell className={cn(td, 'stacked:mb-1')}>
                <div className="font-medium">{l.item_name}</div>
                {l.item_details ? <div className="text-xs text-muted-foreground print:text-black/70">{l.item_details}</div> : null}
              </TableCell>
              <TableCell label="Size / Размер" className={td}>{formatSize(l.size)}</TableCell>
              <TableCell label="Qty / Кол-во" className={cn(td, 'text-right tabular-nums')}>{l.quantity}</TableCell>
              <TableCell label="Unit price / Цена" className={cn(td, 'text-right tabular-nums')}>{formatEuro(l.unit_price_cents)}</TableCell>
              <TableCell label="Total / Сумма" className={cn(td, 'text-right font-medium tabular-nums')}>{formatEuro(l.total_cents)}</TableCell>
              <TableCell label="Service period / Срок службы" className={td}>{formatMonths(l.service_period_months)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter className="border-t-0 bg-transparent">
          <TableRow className="hover:bg-transparent stacked:flex-nowrap stacked:justify-between stacked:bg-muted/50">
            <TableCell colSpan={4} className="px-2 py-2 text-right font-medium stacked:w-auto stacked:text-left">
              Total value / Общая стоимость
            </TableCell>
            <TableCell className="px-2 py-2 text-right font-semibold tabular-nums stacked:w-auto">{formatEuro(r.total_cents)}</TableCell>
            <TableCell className="stacked:hidden" />
          </TableRow>
        </TableFooter>
      </Table>

      <section className="mb-4 grid gap-4 sm:grid-cols-2 print:grid-cols-2">
        <div className="rounded-md border border-border p-3 print:border-black/40">
          <h2 className="mb-1 text-sm font-semibold">{r.confirmation_title_en}</h2>
          <p className="text-sm">{r.confirmation_text_en}</p>
        </div>
        <div className="rounded-md border border-border p-3 print:border-black/40" lang="ru">
          <h2 className="mb-1 text-sm font-semibold">{r.confirmation_title_ru}</h2>
          <p className="text-sm">{r.confirmation_text_ru}</p>
        </div>
      </section>

      {record.confirmation?.confirmed_at ? (
        <p className="mb-4 text-sm">
          Confirmed {record.confirmation.method === 'ELECTRONIC' ? 'electronically' : 'on paper'} by{' '}
          <strong>{record.confirmation.confirmed_name}</strong> on {formatDateTime(record.confirmation.confirmed_at, timeZone)}.
        </p>
      ) : null}

      <div className="hidden grid-cols-3 gap-8 pt-10 text-sm print:grid">
        <SignatureLine label="Employee name and surname / Имя и фамилия работника" />
        <SignatureLine label="Signature / Подпись" />
        <SignatureLine label="Date / Дата" />
      </div>

      <p className="mt-6 break-all text-[10px] text-muted-foreground print:text-black/60">
        Document {r.text_version} · SHA-256 {record.document_hash}
      </p>
    </article>
  )
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground print:text-black/70">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  )
}

function SignatureLine({ label }: { label: string }) {
  return (
    <div>
      <div className="mb-1 h-8 border-b border-black" />
      <div className="text-xs">{label}</div>
    </div>
  )
}
