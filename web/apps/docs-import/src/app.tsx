import { type Session, useApi } from '@ppe/app-shell'
import { AppFrame, SignedIn } from '@ppe/launcher'
import { staffHref } from '@ppe/routing'
import { Button, buttonVariants } from '@ppe/ui/components/button'
import { EmptyState, PageHeader } from '@ppe/ui/components/states'

import { t } from '@/i18n'

import { ImportPage } from './routes/import/import-page'

/*
 * Import Documents in a small app's frame (@ppe/launcher's SignedIn and
 * AppFrame): its name, the way back to Employees, App Launcher and Sign out.
 * It shares the staff app's sign-in. It is for Personnel Documents
 * (personnel.documents.manage, ADR 0007), shown by session.can(...), never by
 * role. Published under App Launcher (ADR 0006): off Stable, the frame's
 * stripe says which channel and version.
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
  if (!session.can('personnel.documents.manage')) return <NotForYou onSignOut={() => void signOut()} />
  return (
    <AppFrame slug="docs-import" name={t.shell.appName} back={{ href: staffHref('/employees'), label: t.shell.employees }} navLabel={t.shell.mainNav} tabs={[]}>
      <ImportPage />
    </AppFrame>
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
