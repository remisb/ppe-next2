import { type Session as UserSession, useApi } from '@ppe/app-shell'
import { AppFrame, SignedIn } from '@ppe/launcher'
import { staffHref } from '@ppe/routing'
import { Button, buttonVariants } from '@ppe/ui/components/button'
import { EmptyState, PageHeader } from '@ppe/ui/components/states'
import { Toaster } from '@ppe/ui/components/toast'

import { t } from '@/i18n'
import { RouterProvider, linkTo, useRouter } from '@/lib/router'
import { SessionsProvider } from '@/lib/sessions'

import { AdjustScreen } from './routes/adjust'
import { CameraScreen } from './routes/camera'
import { DetailsScreen } from './routes/details'
import { FindScreen } from './routes/find'
import { MergeScreen } from './routes/merge'
import { NewEmployeeScreen } from './routes/new-employee'
import { SavedScreen } from './routes/saved'
import { ScansScreen } from './routes/scans'
import { UpdateScreen } from './routes/update'

/*
 * Scan Documents (docs/apps/docs-scan-plan.md) in a small app's frame (@ppe/launcher's
 * SignedIn and AppFrame), for Personnel Documents (personnel.documents.manage), shown by
 * session.can(...), never by role. Each screen is an address (lib/router.ts); the scans being
 * worked on are held in SessionsProvider, this tab's memory only.
 */
export function App() {
  return (
    <SignedIn appName={t.shell.appName} tagline={t.shell.signInTagline}>
      {(session) => (
        <RouterProvider>
          <Screens session={session} />
        </RouterProvider>
      )}
    </SignedIn>
  )
}

function Screens({ session }: { session: UserSession }) {
  const { signOut } = useApi()
  const { route, navigate } = useRouter()
  if (!session.can('personnel.documents.manage')) return <NotForYou onSignOut={() => void signOut()} />
  return (
    <SessionsProvider>
      <AppFrame
        slug="docs-scan"
        name={t.shell.appName}
        back={{ href: staffHref('/employees'), label: t.shell.employees }}
        navLabel={t.shell.mainNav}
        tabs={[{ key: 'home', label: t.shell.scans, current: route.name === 'home', ...linkTo({ name: 'home' }, navigate) }]}
      >
        {route.name === 'home' ? <ScansScreen /> : null}
        {route.name === 'camera' ? <CameraScreen /> : null}
        {route.name === 'scan' ? <DetailsScreen id={route.id} /> : null}
        {route.name === 'find' ? <FindScreen id={route.id} /> : null}
        {route.name === 'update' ? <UpdateScreen id={route.id} employeeId={route.employee} /> : null}
        {route.name === 'merge' ? <MergeScreen id={route.id} /> : null}
        {route.name === 'new' ? <NewEmployeeScreen id={route.id} /> : null}
        {route.name === 'saved' ? <SavedScreen id={route.id} /> : null}
        {route.name === 'adjust' ? <AdjustScreen id={route.id} page={route.page} /> : null}
      </AppFrame>
      <Toaster />
    </SessionsProvider>
  )
}

/** A signed-in user whose roles do not open the app. */
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
