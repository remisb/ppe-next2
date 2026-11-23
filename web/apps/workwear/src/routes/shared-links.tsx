import type { Share } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { Button, buttonVariants } from '@ppe/ui/components/button'
import { ActionError, Loaded, PageHeader } from '@ppe/ui/components/states'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@ppe/ui/components/table'
import { formatDateTime } from '@ppe/ui/lib/dates'
import { useAction } from '@ppe/ui/lib/use-action'
import { useLoad } from '@ppe/ui/lib/use-load'
import { Link2Off } from 'lucide-react'
import { useState } from 'react'

import { t } from '@/i18n'
import { type Route, linkTo } from '@/lib/router'

/**
 * Shared Links (/shared-links, WARE-51 and WARE-49): the user's own links that
 * are still open, newest first, each with its name, type, rows, when it was
 * shared and until when it opens, and Revoke (asked first: it closes the link
 * at once and erases what it held). Reached from Employees' ⋯, Share Link's
 * result and ⌘K. Everyone has it: anyone may share.
 */
export function SharedLinks({ navigate }: { navigate: (to: Route) => void }) {
  const { client } = useApi()
  const list = useLoad(() => client.shares.list())
  const action = useAction()
  const [notice, setNotice] = useState<string>()

  const revoke = (s: Share) =>
    action.run(
      async () => {
        await client.shares.revoke(s.id)
        setNotice(t.shares.revoked(s.name))
        list.reload()
      },
      { confirm: t.shares.revokeQuestion(s.name) },
    )

  return (
    <>
      <PageHeader title={t.shares.title} description={t.shares.description} />
      <ActionError error={action.error} />
      {notice ? (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
      <Loaded
        load={list}
        emptyState={
          <>
            <span className="block font-medium text-foreground">{t.shares.none}</span>
            <span className="mt-1 block">{t.shares.noneHelp}</span>
            <a {...linkTo({ name: 'employees' }, navigate)} className={buttonVariants({ variant: 'outline', size: 'sm', className: 'mt-3' })}>
              {t.shares.openEmployees}
            </a>
          </>
        }
      >
        {(shares) => (
          <Table stack>
            <TableHeader>
              <TableRow>
                <TableHead>{t.shares.name}</TableHead>
                <TableHead className="w-32">{t.shares.type}</TableHead>
                <TableHead className="w-20 text-right">{t.shares.rows}</TableHead>
                <TableHead className="w-44">{t.shares.shared}</TableHead>
                <TableHead className="w-44">{t.shares.openUntil}</TableHead>
                <TableHead className="w-28">
                  <span className="sr-only">{t.shares.revoke}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shares.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium break-words stacked:text-base">{s.name}</TableCell>
                  <TableCell label={t.shares.type}>{t.shares.kinds[s.kind] ?? s.kind}</TableCell>
                  <TableCell label={t.shares.rows} className="text-right tabular-nums">
                    {s.row_count}
                  </TableCell>
                  <TableCell label={t.shares.shared} className="tabular-nums">
                    {formatDateTime(s.created_at, undefined)}
                  </TableCell>
                  <TableCell label={t.shares.openUntil} className="tabular-nums">
                    {formatDateTime(s.expires_at, undefined)}
                  </TableCell>
                  <TableCell className="text-right stacked:text-left">
                    <Button size="sm" variant="outline" aria-label={t.shares.revokeName(s.name)} disabled={action.pending} onClick={() => void revoke(s)}>
                      <Link2Off aria-hidden />
                      {t.shares.revoke}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Loaded>
    </>
  )
}
