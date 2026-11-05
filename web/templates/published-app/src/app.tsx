import { AppFrame, SignedIn } from '@ppe/launcher'

import { t } from '@/i18n'
import { type Route, linkTo, useRouter } from '@/lib/router'

import { HomePage } from './routes/home'

/*
 * A small app's frame (@ppe/launcher's SignedIn and AppFrame): its name, its
 * screens as tabs (shown from two), App Launcher and Sign out. It shares the
 * staff app's sign-in. Off Stable, the frame's stripe says which channel and
 * version. A screen that needs a permission is a tab shown by SignedIn's
 * session.can(...), never by role (as Scan SIMs' app.tsx does).
 */
export function App() {
  return (
    <SignedIn appName={t.shell.appName} tagline={t.shell.signInTagline}>
      {() => <Screens />}
    </SignedIn>
  )
}

function Screens() {
  const { route, navigate } = useRouter()
  const tabs: { route: Route; label: string }[] = [{ route: { name: 'home' }, label: t.shell.home }]
  return (
    <AppFrame
      slug="__SLUG__"
      name={t.shell.appName}
      navLabel={t.shell.mainNav}
      tabs={tabs.map((x) => ({ key: x.route.name, label: x.label, current: route.name === x.route.name, ...linkTo(x.route, navigate) }))}
    >
      <HomePage />
    </AppFrame>
  )
}
