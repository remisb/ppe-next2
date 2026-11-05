import { CheckingSignIn, ConfirmPassword, Offline, type Session, SignIn, applyDensity, loadDensity, useApi } from '@ppe/app-shell'
import { launcherHref } from '@ppe/routing'
import { Button, buttonVariants } from '@ppe/ui/components/button'
import { Brand } from '@ppe/ui/components/main-nav'
import { cn } from '@ppe/ui/lib/utils'
import { ArrowLeft, Grip, LogOut } from 'lucide-react'
import { type MouseEvent, type ReactNode, useEffect } from 'react'

import { hasSeveralApps } from './catalogue.ts'
import { ChannelStripe } from './channel-stripe.tsx'
import { useLauncher } from './load.ts'
import { launcherText } from './text.ts'

/**
 * A small app's way in (ADR 0006): checking the sign-in, offline, Sign in
 * with the app's name, the user's density, and Confirm your password; the
 * app itself once signed in. The sign-in is the staff app's, shared.
 */
export function SignedIn({ appName, tagline, children }: { appName: string; tagline: string; children: (session: Session) => ReactNode }) {
  const { session, status, retry, passwordPrompt } = useApi()
  useEffect(() => applyDensity(session ? loadDensity(session.userId) : null), [session?.userId])
  if (status === 'starting') return <CheckingSignIn />
  if (status === 'offline') return <Offline onRetry={retry} />
  if (!session) return <SignIn appName={appName} tagline={tagline} />
  return (
    <>
      {children(session)}
      <ConfirmPassword prompt={passwordPrompt} />
    </>
  )
}

/** One of a small app's screens in its tabs. */
export interface FrameTab {
  key: string
  label: string
  current: boolean
  href: string
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void
}

/**
 * The frame of a small app on this site, such as Scan SIMs (ADR 0006): a
 * published app's stripe off Stable, the app's name, the way back to where
 * it came from, App Launcher (for users with several apps) and Sign out, its
 * screens as tabs, then the screen.
 *
 * The bar scrolls away: each screen's own header (PageHeader) is the one that
 * sticks, as in the staff app. Two sticky headers cover each other, which is
 * how Scan SIMs' overlapped (8eb4fc0); the e2e Scan SIMs step checks it.
 */
export function AppFrame({
  slug,
  name,
  back,
  navLabel,
  tabs = [],
  children,
}: {
  /** The app's slug in App Launcher: its channel stripe's. */
  slug: string
  name: string
  /** Where the app came from, such as SIM Cards in the staff app. */
  back?: { href: string; label: string }
  /** The tabs' name for screen readers. */
  navLabel: string
  /** Shown when there are two or more. */
  tabs?: FrameTab[]
  children: ReactNode
}) {
  const { signOut } = useApi()
  const severalApps = hasSeveralApps(useLauncher().list?.apps ?? [])
  const t = launcherText()
  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-background px-4 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:ring-2 focus:ring-ring"
      >
        {t.skipToContent}
      </a>
      <header data-slot="app-frame-bar" className="border-b border-border bg-background pt-[env(safe-area-inset-top)]">
        <ChannelStripe slug={slug} />
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4 md:px-6">
          <Brand name={name} />
          {back ? (
            <a href={back.href} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'ml-auto')}>
              <ArrowLeft aria-hidden className="size-4" />
              {back.label}
            </a>
          ) : (
            <span className="ml-auto" />
          )}
          {severalApps ? (
            <a href={launcherHref('/')} aria-label={t.apps} title={t.apps} className={buttonVariants({ variant: 'ghost', size: 'icon' })}>
              <Grip aria-hidden className="size-4" />
            </a>
          ) : null}
          <Button variant="ghost" size="icon" aria-label={t.signOut} title={t.signOut} onClick={() => void signOut()}>
            <LogOut aria-hidden className="size-4" />
          </Button>
        </div>
        {tabs.length > 1 ? (
          <nav aria-label={navLabel} className="mx-auto flex max-w-5xl gap-1 px-4 pb-2 md:px-6">
            {tabs.map((x) => (
              <a
                key={x.key}
                href={x.href}
                onClick={x.onClick}
                aria-current={x.current ? 'page' : undefined}
                className={cn(buttonVariants({ variant: x.current ? 'secondary' : 'ghost', size: 'sm' }), 'aria-[current=page]:font-semibold')}
              >
                {x.label}
              </a>
            ))}
          </nav>
        ) : null}
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl min-w-0 px-4 pt-5 pb-10 outline-none md:px-6 md:py-8">
        {children}
      </main>
    </div>
  )
}
