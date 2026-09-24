import { ClipboardList, History as HistoryIcon, LogOut, Package, Shirt, Users } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useApi } from '@/lib/api'
import { type Route, pathOf, useRouter } from '@/lib/router'
import { cn } from '@/lib/utils'
import { basePath } from '@ppe/routing'

import { Catalogue } from './routes/catalogue'
import { CreateOrder } from './routes/create-order'
import { Employees } from './routes/employees'
import { History } from './routes/history'
import { ConfirmPage } from './routes/confirm'
import { ItemSets } from './routes/item-sets'
import { RecordPage } from './routes/record'
import { SignIn } from './routes/sign-in'

const tabs: { route: Route; label: string; icon: typeof Users }[] = [
  { route: { name: 'createOrder' }, label: 'Create Order', icon: ClipboardList },
  { route: { name: 'history' }, label: 'History', icon: HistoryIcon },
  { route: { name: 'employees' }, label: 'Employees', icon: Users },
  { route: { name: 'catalogue' }, label: 'Item Catalogue', icon: Shirt },
  { route: { name: 'itemSets' }, label: 'Item Sets', icon: Package },
]

export function App() {
  const { session, signOut } = useApi()
  const { route, navigate } = useRouter()

  // The public confirmation page is checked before the session gate: its
  // visitor is an employee with a link, not a signed-in user.
  if (route.name === 'confirm') return <ConfirmPage token={route.token} />
  if (!session) return <SignIn />

  return (
    <div className="min-h-dvh">
      <header className="border-b border-border print:hidden">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-3">
          <span className="mr-4 font-semibold">Workwear &amp; Equipment</span>
          <nav className="flex flex-1 flex-wrap gap-1" aria-label="Main">
            {tabs.map(({ route: r, label, icon: Icon }) => (
              <a
                key={r.name}
                href={basePath + pathOf(r)}
                aria-current={route.name === r.name || (route.name === 'record' && r.name === 'history') ? 'page' : undefined}
                onClick={(e) => {
                  e.preventDefault()
                  navigate(r)
                }}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-2 text-sm',
                  route.name === r.name || (route.name === 'record' && r.name === 'history')
                    ? 'bg-accent font-medium'
                    : 'text-muted-foreground hover:bg-accent',
                )}
              >
                <Icon aria-hidden className="size-4" />
                {label}
              </a>
            ))}
          </nav>
          <span className="text-sm text-muted-foreground">{session.name}</span>
          <Button size="sm" variant="ghost" onClick={signOut}>
            <LogOut aria-hidden /> Sign out
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 print:max-w-none print:p-0">
        {route.name === 'createOrder' ? <CreateOrder /> : null}
        {route.name === 'employees' ? <Employees /> : null}
        {route.name === 'catalogue' ? <Catalogue /> : null}
        {route.name === 'itemSets' ? <ItemSets /> : null}
        {route.name === 'history' ? <History onOpenRecord={(id, print) => navigate({ name: 'record', id, print })} /> : null}
        {route.name === 'record' ? (
          <RecordPage id={route.id} autoPrint={route.print ?? false} onBack={() => navigate({ name: 'history' })} />
        ) : null}
      </main>
    </div>
  )
}
