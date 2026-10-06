import { ErrorState, Loading } from '@ppe/ui/components/states'

import { shellText } from './text.ts'

/** While the refresh cookie is asked whether this browser is signed in: neither the app nor Sign in. */
export function CheckingSignIn() {
  return (
    <main className="grid min-h-dvh place-items-center bg-background">
      <Loading label={shellText().checkingSignIn} />
    </main>
  )
}

/** The server could not be reached to ask; the app asks again on retry or once back online. */
export function Offline({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-5">
      <div className="w-full max-w-sm">
        <ErrorState title={shellText().offlineTitle} error={new Error(shellText().offlineHint)} onRetry={onRetry} />
      </div>
    </main>
  )
}
