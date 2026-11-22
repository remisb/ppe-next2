import type { Client, IdentityDocumentKind, KeptScan } from '@ppe/api-client'
import { makePage } from '@ppe/id-docs/make-page'
import { loadReader, todayHere } from '@ppe/id-docs/reader'
import type { Mrz } from '@ppe/mrz'
import type { Quad } from '@ppe/scan-kit/perspective'

import { draftFrom, keepMetaOf, sideOf, type ScanDraft } from './flow'
import { pageOf, type ScanPage, type Session } from './sessions'

/** The order a document's pages are shown and saved in: a card's back (its code lines) first. */
const order = (pages: ScanPage[]) => [...pages].sort((a, b) => Number(a.side === 'front') - Number(b.side === 'front'))

/**
 * Pages from photos, one at a time (each turned the way up its MRZ reads, its corners found
 * and flattened: @ppe/id-docs' makePage), a card's sides by their code lines, in either order.
 */
export async function makePages(photos: readonly Blob[], kind: IdentityDocumentKind): Promise<ScanPage[]> {
  const out: ScanPage[] = []
  for (const photo of photos) {
    const made = await makePage(photo, { kind })
    out.push(
      pageOf(made.blob, sideOf(kind, !!made.reading?.found), {
        source: photo,
        turn: made.turn,
        corners: made.corners,
        size: made.size,
        ...(made.reading ? { reading: made.reading } : {}),
      }),
    )
  }
  return order(out)
}

/** The page made again from the corners the user set (Adjust Corners). */
export async function remakePage(page: ScanPage, corners: Quad, kind: IdentityDocumentKind): Promise<ScanPage> {
  if (!page.source) return page
  const made = await makePage(page.source, { kind, corners, ...(page.turn !== undefined ? { turn: page.turn } : {}) })
  return pageOf(made.blob, sideOf(kind, !!made.reading?.found || page.side !== 'front'), {
    source: page.source,
    turn: made.turn,
    corners: made.corners,
    size: made.size,
    ...(made.reading ? { reading: made.reading } : {}),
  })
}

/** The pages' reading: the first that passes, else the first read at all. */
export function readingOf(pages: readonly ScanPage[]): Mrz | undefined {
  const read = pages.map((p) => p.reading?.mrz).filter((m): m is Mrz => !!m)
  return read.find((m) => m.valid) ?? read[0]
}

/** Keeps the scan on the server (sealed, 3 days, its maker's alone) and holds it here. */
export async function keepScan(
  client: Client,
  kind: IdentityDocumentKind,
  pages: ScanPage[],
  draft: ScanDraft,
  m: Mrz | undefined,
  replaces?: string,
): Promise<Session> {
  const kept = await client.personnel.scans.keep(keepMetaOf(kind, draft, m, replaces), pages.map((p) => p.blob))
  return { id: kept.id, kind: kept.kind, state: kept.state, pages, draft }
}

/** A kept scan opened from Scans in a tab that does not hold it: its pages fetched and read again. */
export async function reopenScan(client: Client, scan: KeptScan): Promise<Session> {
  const reader = await loadReader()
  const pages: ScanPage[] = []
  for (let n = 1; n <= scan.pages; n++) {
    const blob = await client.personnel.scans.page(scan.id, n)
    const reading = await reader.readPhoto(blob, todayHere())
    pages.push(pageOf(blob, sideOf(scan.kind, reading.found), { reading }))
  }
  const sorted = order(pages)
  const m = readingOf(sorted)
  const draft = draftFrom(m)
  // The names as kept (typed with their accents) over the MRZ's.
  if (scan.surname) Object.assign(draft, { surname: scan.surname, givenNames: scan.given_names })
  return { id: scan.id, kind: scan.kind, state: scan.state, pages: sorted, draft, ...(scan.employee_id ? { employeeId: scan.employee_id } : {}) }
}
