import { PHOTO_USES, type Employee, type EmployeePhoto, type PhotoUse } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { Badge } from '@ppe/ui/components/badge'
import { Button } from '@ppe/ui/components/button'
import { DisclosureSection } from '@ppe/ui/components/disclosure-section'
import { ActionError, Loaded } from '@ppe/ui/components/states'
import { useAction } from '@ppe/ui/lib/use-action'
import { useLoad } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { Plus } from 'lucide-react'
import { useRef, useState } from 'react'

import { PhotoImage } from '@/components/employee-photo'
import { t } from '@/i18n'
import { addPhotos, photoRefusal, useFileDrop } from '@/lib/photo-drop'

/** The Photos section's state, held by the employee page so a file dropped anywhere on it lands here too. */
export type EmployeePhotosState = ReturnType<typeof useEmployeePhotos>

/** An employee's photos and the actions on them; onChanged reloads what shows the default photo. */
export function useEmployeePhotos(employee: Pick<Employee, 'id' | 'full_name'>, onChanged: () => void) {
  const { client } = useApi()
  const photos = useLoad(() => client.employeePhotos.list(employee.id), [employee.id])
  const action = useAction()
  const [message, setMessage] = useState<string>()

  const run = (fn: () => Promise<string | unknown>, confirm?: string) =>
    action.run(
      async () => {
        setMessage(undefined)
        const said = await fn()
        if (typeof said === 'string') setMessage(said)
        photos.reload()
        onChanged()
      },
      { confirm, mapError: photoRefusal },
    )

  /** Add Photo and a drop: the files as new photos. */
  const add = (files: File[]) => run(() => addPhotos(client, employee, files))
  return { photos, action, message, run, add }
}

/**
 * An employee's photos: Add Photo (or drop photos on the section, or anywhere
 * on the employee), the default one marked and first, each photo's optional
 * uses as toggles, Make Default and Remove.
 */
export function EmployeePhotos({ employee, state, rememberAs }: { employee: Employee; state: EmployeePhotosState; rememberAs: string }) {
  const { client } = useApi()
  const { photos, action, message, run, add } = state
  const input = useRef<HTMLInputElement>(null)
  const drop = useFileDrop((files) => void add(files))
  const tx = t.employees.photos

  const toggle = (p: EmployeePhoto, use: PhotoUse) => {
    const uses = p.uses.includes(use) ? p.uses.filter((u) => u !== use) : [...p.uses, use]
    void run(() => client.employeePhotos.setUses(employee.id, p.id, uses))
  }

  return (
    <div {...drop.props} className={cn('rounded-lg transition-shadow', drop.over && 'ring-2 ring-ring ring-offset-4 ring-offset-background')}>
      <DisclosureSection id="photos" title={tx.title} count={photos.data?.length} description={tx.hint} rememberAs={rememberAs}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <input
            ref={input}
            type="file"
            accept=".jpg,.jpeg,.png,image/jpeg,image/png"
            className="hidden"
            multiple
            aria-label={tx.add}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])]
              e.target.value = ''
              if (files.length > 0) void add(files)
            }}
          />
          <Button variant="outline" size="sm" disabled={action.pending} onClick={() => input.current?.click()}>
            <Plus aria-hidden /> {action.pending ? tx.adding : tx.add}
          </Button>
          {/* Dragging and dropping needs a mouse; a phone has Add Photo. */}
          <span className="hidden text-xs text-muted-foreground pointer-fine:inline">{tx.dropHint}</span>
          {message ? (
            <p role="status" className="text-sm text-muted-foreground">
              {message}
            </p>
          ) : null}
        </div>
        <ActionError error={action.error} />
        <Loaded load={photos} empty={photos.data?.length === 0} emptyState={tx.none(employee.first_name)}>
          {(list) => (
            // Cards as wide as fits, never narrower than 9rem: two on a phone, more in a wide pane.
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(10rem,12rem))]">
              {list.map((p) => (
                // One column the card's width: a long file name or the uses never widen it past the card, so the photo scales to fit.
                <li key={p.id} className="grid grid-cols-[minmax(0,1fr)] gap-2 rounded-lg border border-border p-3">
                  <PhotoImage employeeId={employee.id} photoId={p.id} alt={tx.alt(employee.full_name)} className="aspect-square w-full rounded-md" />
                  <div className="flex flex-wrap items-center gap-2">
                    {p.is_default ? <Badge variant="secondary">{tx.default}</Badge> : null}
                    <span className="min-w-0 truncate text-xs text-muted-foreground" title={p.file_name}>
                      {p.file_name}
                    </span>
                  </div>
                  <fieldset className="grid gap-1">
                    <legend className="mb-1 text-xs text-muted-foreground">{tx.usesLabel}</legend>
                    <div className="flex flex-wrap gap-1.5">
                      {PHOTO_USES.map((u) => (
                        <button
                          key={u}
                          type="button"
                          aria-pressed={p.uses.includes(u)}
                          disabled={action.pending}
                          onClick={() => toggle(p, u)}
                          className="min-h-11 cursor-pointer rounded-full border border-border px-3 text-xs aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:font-medium md:min-h-7"
                        >
                          {tx.uses[u]}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <div className="flex flex-wrap gap-2">
                    {p.is_default ? null : (
                      <Button variant="outline" size="sm" disabled={action.pending} onClick={() => void run(() => client.employeePhotos.setDefault(employee.id, p.id))}>
                        {tx.makeDefault}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={action.pending}
                      onClick={() => void run(() => client.employeePhotos.remove(employee.id, p.id), tx.confirmRemove)}
                    >
                      {tx.remove}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Loaded>
      </DisclosureSection>
    </div>
  )
}
