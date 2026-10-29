import { CheckingSignIn, ConfirmPassword, Offline, SignIn, applyDensity, loadDensity, useApi } from '@ppe/app-shell'
import { staffHref } from '@ppe/routing'
import { Button, buttonVariants } from '@ppe/ui/components/button'
import { Brand } from '@ppe/ui/components/main-nav'
import { EmptyState, PageHeader } from '@ppe/ui/components/states'
import { cn } from '@ppe/ui/lib/utils'
import { ArrowLeft, LogOut } from 'lucide-react'
import { useEffect } from 'react'

import { t } from '@/i18n'
import { type Route, linkTo, useRouter } from '@/lib/router'

import { FindPage } from './routes/find'
import { ScanPage } from './routes/scan'

/*
 * The trial's frame, kept small: its name, its two screens as tabs (Scan,
 * which needs assets.manage, and PIN and PUK, which needs sim_codes.read),
 * the way back to SIM Cards and Sign out. It shares the staff app's sign-in,
 * so signing in or out here does so there too.
 */
export function App() {
  const { session, status, retry, signOut, passwordPrompt } = useApi()
  const { route: asked, navigate } = useRouter()

  useEffect(() => applyDensity(session ? loadDensity(session.userId) : null), [session?.userId])

  if (status === 'starting') return <CheckingSignIn />
  if (status === 'offline') return <Offline onRetry={retry} />
  if (!session) return <SignIn appName={t.shell.appName} tagline={t.shell.signInTagline} />

  const tabs: { route: Route; label: string; shown: boolean }[] = [
    { route: { name: 'scan' }, label: t.shell.scan, shown: session.can('assets.manage') },
    { route: { name: 'find' }, label: t.shell.find, shown: session.can('sim_codes.read') },
  ]
  const shown = tabs.filter((x) => x.shown)
  const route = shown.find((x) => x.route.name === asked.name)?.route ?? shown[0]?.route
  if (!route) return <NotForYou onSignOut={signOut} />

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-background px-4 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:ring-2 focus:ring-ring"
      >
        {t.shell.skipToContent}
      </a>
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4 md:px-6">
          <Brand name={t.shell.appName} />
          <a href={staffHref('/assets/sim-cards')} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'ml-auto')}>
            <ArrowLeft aria-hidden className="size-4" />
            {t.shell.simCards}
          </a>
          <Button variant="ghost" size="icon" aria-label={t.shell.signOut} title={t.shell.signOut} onClick={() => void signOut()}>
            <LogOut aria-hidden className="size-4" />
          </Button>
        </div>
        {shown.length > 1 ? (
          <nav aria-label={t.shell.mainNav} className="mx-auto flex max-w-5xl gap-1 px-4 pb-2 md:px-6">
            {shown.map((x) => (
              <a
                key={x.route.name}
                {...linkTo(x.route, navigate)}
                aria-current={route.name === x.route.name ? 'page' : undefined}
                className={cn(
                  buttonVariants({ variant: route.name === x.route.name ? 'secondary' : 'ghost', size: 'sm' }),
                  'aria-[current=page]:font-semibold',
                )}
              >
                {x.label}
              </a>
            ))}
          </nav>
        ) : null}
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl min-w-0 px-4 pt-5 pb-10 outline-none md:px-6 md:py-8">
        {route.name === 'scan' ? <ScanPage /> : <FindPage />}
      </main>
      <ConfirmPassword prompt={passwordPrompt} />
    </div>
  )
}

/** A signed-in user whose roles open neither screen. */
function NotForYou({ onSignOut }: { onSignOut: () => void }) {
  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-xl content-center px-4 py-8">
      <PageHeader title={t.shell.notForYouTitle} />
      <EmptyState
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <a href={staffHref('/')} className={buttonVariants()}>
              {t.shell.backToWorkwear}
            </a>
            <Button variant="outline" onClick={onSignOut}>
              {t.shell.signOut}
            </Button>
          </div>
        }
      >
        {t.shell.notForYou}
      </EmptyState>
    </main>
  )
}
