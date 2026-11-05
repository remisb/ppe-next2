import { type Session, useApi } from '@ppe/app-shell'
import { AppFrame, SignedIn } from '@ppe/launcher'
import { staffHref } from '@ppe/routing'
import { Button, buttonVariants } from '@ppe/ui/components/button'
import { EmptyState, PageHeader } from '@ppe/ui/components/states'

import { t } from '@/i18n'
import { type Route, linkTo, useRouter } from '@/lib/router'

import { FindPage } from './routes/find'
import { ScanPage } from './routes/scan'

/*
 * The trial, in a small app's frame (@ppe/launcher's SignedIn and AppFrame):
 * its name, its two screens as tabs (Scan, which needs assets.manage, and PIN
 * and PUK, which needs sim_codes.read), the way back to SIM Cards, App
 * Launcher and Sign out. It shares the staff app's sign-in, so signing in or
 * out here does so there too. Published under App Launcher (ADR 0006): off
 * Stable, the frame's stripe says which channel and version.
 */
export function App() {
  return (
    <SignedIn appName={t.shell.appName} tagline={t.shell.signInTagline}>
      {(session) => <Screens session={session} />}
    </SignedIn>
  )
}

function Screens({ session }: { session: Session }) {
  const { signOut } = useApi()
  const { route: asked, navigate } = useRouter()
  const tabs: { route: Route; label: string; shown: boolean }[] = [
    { route: { name: 'scan' }, label: t.shell.scan, shown: session.can('assets.manage') },
    { route: { name: 'find' }, label: t.shell.find, shown: session.can('sim_codes.read') },
  ]
  const shown = tabs.filter((x) => x.shown)
  const route = shown.find((x) => x.route.name === asked.name)?.route ?? shown[0]?.route
  if (!route) return <NotForYou onSignOut={() => void signOut()} />

  return (
    <AppFrame
      slug="sim-scan"
      name={t.shell.appName}
      back={{ href: staffHref('/assets/sim-cards'), label: t.shell.simCards }}
      navLabel={t.shell.mainNav}
      tabs={shown.map((x) => ({ key: x.route.name, label: x.label, current: route.name === x.route.name, ...linkTo(x.route, navigate) }))}
    >
      {route.name === 'scan' ? <ScanPage /> : <FindPage />}
    </AppFrame>
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
