import { Toast, ToastClose, ToastDescription, ToastRegion, ToastTitle, toast, type ToastType } from '@ui-sdk/react/toast'
import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert, X } from 'lucide-react'

import { uiText } from '../text.ts'

/*
 * ui-sdk's Toast (docs: packages/ui/node_modules/@ui-sdk/react/docs/components/toast.md):
 * call `toast('Saved')`, `toast.success(…)` or `toast.error(…)` from anywhere, and place
 * <Toaster /> once near the app's root. A stack at the top, as a phone's banners are,
 * swiped up or sideways to dismiss; errors are announced at once, others at a pause.
 * The stack's motion is `.ppe-toasts` in styles.css.
 */
export { toast }

const icons: Partial<Record<ToastType, { Icon: typeof Info; className: string }>> = {
  success: { Icon: CircleCheck, className: 'text-emerald-600 dark:text-emerald-400' },
  error: { Icon: CircleAlert, className: 'text-destructive' },
  warning: { Icon: TriangleAlert, className: 'text-amber-600 dark:text-amber-400' },
  info: { Icon: Info, className: 'text-primary' },
  loading: { Icon: LoaderCircle, className: 'animate-spin text-muted-foreground motion-reduce:animate-none' },
}

export function Toaster() {
  const t = uiText()
  return (
    <ToastRegion aria-label={t.notifications} side="top" align="center" className="ppe-toasts">
      {(data) => {
        const icon = data.type ? icons[data.type] : undefined
        return (
          <Toast className="flex items-start gap-3 rounded-2xl border border-border bg-background/95 px-4 py-3 text-foreground shadow-lg backdrop-blur-xl">
            {icon ? <icon.Icon aria-hidden className={`mt-0.5 size-5 shrink-0 ${icon.className}`} /> : null}
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <ToastTitle className="text-sm font-semibold" />
              <ToastDescription className="text-sm text-muted-foreground" />
            </div>
            {data.dismissible === false ? null : (
              <ToastClose aria-label={t.close} className="-m-2 flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                <X aria-hidden className="size-4" />
              </ToastClose>
            )}
          </Toast>
        )
      }}
    </ToastRegion>
  )
}
