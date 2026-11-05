import type { Employee } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { Button } from '@ppe/ui/components/button'
import { Field, Input, controlProps } from '@ppe/ui/components/field'
import { ActionError, PageHeader } from '@ppe/ui/components/states'
import { UserPlus } from 'lucide-react'
import { useEffect, useState } from 'react'

import { t } from '@/i18n'
import type { Holder } from '@/lib/flow'

/** Step 1 (FR-1): an employee on file, found by name or code, or a new one made from the document (D6). */
export function PersonStep({ onChoose }: { onChoose: (holder: Holder) => void }) {
  const { client } = useApi()
  const [q, setQ] = useState('')
  const [found, setFound] = useState<Employee[] | null>(null)
  const [error, setError] = useState<unknown>(null)

  // The employees' search, a moment after typing stops; a late answer to an earlier query is dropped.
  useEffect(() => {
    const query = q.trim()
    if (query === '') return setFound(null)
    let live = true
    const timer = setTimeout(() => {
      client.employees.search(query).then(
        (list) => live && setFound(list),
        (e: unknown) => live && setError(e),
      )
    }, 250)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [client, q])

  return (
    <>
      <PageHeader title={t.person.title} description={t.person.description} />
      <section className="flex max-w-xl flex-col gap-3">
        <Field label={t.person.search} hint={t.person.searchHint}>
          {(p) => <Input {...controlProps(p)} type="search" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />}
        </Field>
        <ActionError error={error} />
        {found && found.length === 0 ? <p className="text-sm text-muted-foreground">{t.person.noMatch}</p> : null}
        {found && found.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {found.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{e.full_name}</span>
                  {e.code ? <span className="block text-sm text-muted-foreground">{e.code}</span> : null}
                </span>
                <Button variant="outline" onClick={() => onChoose({ kind: 'existing', employee: e })}>
                  {t.person.choose}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-2 flex flex-col gap-1 border-t border-border pt-4">
          <div>
            <Button variant="outline" onClick={() => onChoose({ kind: 'new' })}>
              <UserPlus aria-hidden className="size-4" />
              {t.person.newEmployee}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">{t.person.newEmployeeHint}</p>
        </div>
      </section>
    </>
  )
}

/** Whose document it is, said above the later steps, with a way back. */
export function HolderLine({ holder, onChange }: { holder: Holder; onChange?: () => void }) {
  return (
    <p className="mb-4 flex flex-wrap items-center gap-x-2 text-sm">
      <span className="text-muted-foreground">{t.person.chosen}:</span>
      <span className="font-medium">{holder.kind === 'existing' ? holder.employee.full_name : t.person.newChosen}</span>
      {onChange ? (
        <Button variant="link" className="h-auto p-0" onClick={onChange}>
          {t.person.change}
        </Button>
      ) : null}
    </p>
  )
}
