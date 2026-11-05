import type { CursorPages } from '../lib/use-cursor-pages.ts'
import { Button } from './button.tsx'
import { ErrorState } from './states.tsx'

/** Under a list read a page at a time (useCursorPages): why the last older page failed, and the button that loads the next one while there is one. */
export function OlderButton({ pages, label }: { pages: Pick<CursorPages<unknown>, 'next' | 'older' | 'loadOlder'>; label: string }) {
  return (
    <>
      {pages.older.error ? <ErrorState error={pages.older.error} onRetry={pages.loadOlder} /> : null}
      {pages.next ? (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" disabled={pages.older.loading} onClick={pages.loadOlder}>
            {label}
          </Button>
        </div>
      ) : null}
    </>
  )
}
