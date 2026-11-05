import type { IdentityDocument } from '@ppe/api-client'
import { staffHref } from '@ppe/routing'
import { Button, buttonVariants } from '@ppe/ui/components/button'
import { PageHeader } from '@ppe/ui/components/states'
import { CircleCheck } from 'lucide-react'

import { t } from '@/i18n'

/** Step 4: what was saved, never a sealed value; the employee's page, or the next document. */
export function DoneStep({ saved, onAnother }: { saved: IdentityDocument; onAnother: () => void }) {
  return (
    <>
      <PageHeader title={t.done.title} />
      <section className="flex max-w-xl flex-col gap-3" aria-live="polite">
        <p className="flex items-center gap-2 font-medium">
          <CircleCheck aria-hidden className="size-5 text-success" />
          {t.done.description(t.kinds[saved.kind], saved.issuing_state, saved.expires_on)}
        </p>
        <p className="text-sm text-muted-foreground">{t.done.sealed}</p>
        <div className="flex flex-wrap gap-2">
          <a href={staffHref(`/employees/${saved.employee_id}`)} className={buttonVariants({ variant: 'outline' })}>
            {t.done.openEmployee}
          </a>
          <Button onClick={onAnother}>{t.done.another}</Button>
        </div>
      </section>
    </>
  )
}
