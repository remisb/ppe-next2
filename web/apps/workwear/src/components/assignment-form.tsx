import type { AssignmentForm } from '@ppe/api-client'

// The form reads the same whatever the staff member's interface language, as
// the Items Given Record does: English / Russian words, the amount as printed.
// A plain layout (template 2026-10-plain) until the company's own form is
// added (assets brief §8): the data and signature lines only, no wording of
// terms, which the template will bring. The data and its hash come from the API.
const euro = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' })

/**
 * The assignment form of a SIM card or a computer (§8): who receives what, its
 * numbers, the non-return value and the given date, with signature lines on
 * paper. Built only from the API's form, never from live data.
 */
export function AssignmentFormDocument({ form, documentHash }: { form: AssignmentForm; documentHash: string }) {
  const sim = form.kind === 'SIM'
  const e = form.employee
  return (
    <article className="receipt mx-auto max-w-3xl rounded-lg border border-border bg-card p-4 text-card-foreground sm:p-6 print:max-w-none print:min-w-[179mm] print:rounded-none print:border-0 print:bg-white print:p-0 print:text-black">
      <header className="mb-6">
        <h1 className="text-lg font-semibold">{sim ? 'SIM Assignment Form / Акт выдачи SIM' : 'Equipment Assignment Form / Акт выдачи оборудования'}</h1>
        <p className="text-sm text-muted-foreground print:text-black">Inventory No. / Инвентарный №: {form.inventory_no}</p>
      </header>
      <dl className="mb-6 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 print:grid-cols-2">
        <Info label="Employee / Работник">
          {e.first_name} {e.last_name}
          {e.code ? ` (${e.code})` : ''}
        </Info>
        <Info label="Given date / Дата выдачи">{form.given_date}</Info>
        {sim ? (
          <>
            <Info label="SIM No. / № SIM">{form.sim_no}</Info>
            <Info label="Phone No. / № телефона">{form.phone_no}</Info>
            <Info label="Provider / Оператор">{form.provider}</Info>
            <Info label="Plan / Тариф">{form.plan ?? '—'}</Info>
          </>
        ) : (
          <>
            <Info label="Item / Предмет">{form.name}</Info>
            <Info label="Serial No. / Серийный №">{form.serial_no ?? '—'}</Info>
          </>
        )}
        <Info label="Non-return value / Стоимость при невозврате">{euro.format(form.non_return_value_cents / 100)}</Info>
      </dl>
      <div className="print:break-inside-avoid">
        <div className="hidden grid-cols-3 gap-8 pt-10 text-sm print:grid">
          <SignatureLine label="Employee signature / Подпись работника" />
          <SignatureLine label="Given by / Выдал" />
          <SignatureLine label="Date / Дата" value={form.given_date} />
        </div>
      </div>
      <p className="mt-6 break-all text-[0.625rem] text-muted-foreground print:text-black/60">
        Document {form.template_version} · SHA-256 {documentHash}
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

function SignatureLine({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <div className="mb-1 flex h-8 items-end border-b border-black pb-0.5 font-medium">{value}</div>
      <div className="text-xs">{label}</div>
    </div>
  )
}
