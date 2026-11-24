import type { Employee } from '@ppe/api-client'
import { ApiError } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { Alert, AlertDescription, AlertTitle } from '@ppe/ui/components/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@ppe/ui/components/card'
import { GavortEmblem } from '@ppe/ui/components/gavort-logo'
import { Loaded } from '@ppe/ui/components/states'
import { formatDateTime } from '@ppe/ui/lib/dates'
import { useLoad } from '@ppe/ui/lib/use-load'

import { t } from '@/i18n'
import { employeeExportColumns } from '@/lib/employee-export'

/**
 * A shared link's public page (/shared/<token>, WARE-51): opened by anyone who
 * has the link, with no sign-in and no app navigation; the token is the only
 * credential. Each person is a card: the first column chosen as its title, the
 * others as label and value, empty ones left out, in the columns' order and
 * words (Employees' export columns, so the page reads as the sheet did). A
 * revoked or expired link says so (410); its details are already erased.
 */
export function SharedPage({ token }: { token: string }) {
  const { client } = useApi()
  const view = useLoad(() => client.shares.view(token), [token])
  const status = view.error instanceof ApiError ? view.error.status : undefined
  // The link holds the columns chosen, by their keys; the export's own definitions read the values.
  const all = employeeExportColumns({ sizes: true, profile: true })
  const columns = (view.data?.columns ?? []).flatMap((k) => all.filter((c) => c.key === k))
  const [first, ...rest] = columns

  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-8">
      <header className="mb-6 flex items-center gap-3">
        <span className="flex items-center text-brand-mark">
          <GavortEmblem className="size-9" />
        </span>
        <span className="text-sm text-muted-foreground">{t.common.appName}</span>
      </header>
      {status === 410 || status === 404 ? (
        <Alert variant="destructive">
          <AlertTitle>{status === 410 ? t.shares.pageGone : t.shares.pageNotFound}</AlertTitle>
          <AlertDescription>{status === 410 ? t.shares.pageGoneHelp : t.shares.pageNotFoundHelp}</AlertDescription>
        </Alert>
      ) : (
        <Loaded load={view}>
          {(data) => (
        <>
          <div className="mb-5 grid gap-1">
            <h1 className="text-2xl font-semibold tracking-tight break-words">{data.name}</h1>
            <p className="text-sm text-muted-foreground">
              {t.shares.kinds[data.kind] ?? data.kind} · {t.shares.pageCount(data.rows.length)} · {t.shares.pageSharedBy(data.shared_by, formatDateTime(data.created_at, undefined))}
            </p>
            <p className="text-sm text-muted-foreground">
              {t.shares.pageOpenUntil(formatDateTime(data.expires_at, undefined))} {t.shares.pageAsOf}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {data.rows.map((row, i) => {
              const e = row as unknown as Employee
              const lines = rest
                .map((c) => ({ key: c.key, label: c.label, value: c.value(e) }))
                .filter((l) => l.value !== null && l.value !== undefined && String(l.value).trim() !== '')
              return (
                <Card key={i}>
                  <CardHeader>
                    <CardTitle className="break-words">{first ? String(first.value(e) ?? '—') : '—'}</CardTitle>
                  </CardHeader>
                  {lines.length > 0 ? (
                    <CardContent>
                      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
                        {lines.map((l) => (
                          <div key={l.key} className="contents">
                            <dt className="text-muted-foreground">{l.label}</dt>
                            <dd className="break-words">{String(l.value)}</dd>
                          </div>
                        ))}
                      </dl>
                    </CardContent>
                  ) : null}
                </Card>
              )
            })}
          </div>
        </>
          )}
        </Loaded>
      )}
    </main>
  )
}
