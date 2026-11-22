import type { DocumentCandidate, DocumentTake, IdentityDocumentKind, KeptScanState } from '@ppe/api-client'
import type { PrintedName } from '@ppe/id-docs/printed'
import type { PhotoReading, Turn } from '@ppe/mrz/reader'
import type { Quad } from '@ppe/scan-kit/perspective'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import type { ScanDraft, Side } from './flow'

/** One page of a scan, as the app holds it in memory. */
export interface ScanPage {
  key: string
  /** The flattened page, a JPEG, and its picture's URL. */
  blob: Blob
  url: string
  side: Side
  /** The page's own MRZ reading, when it has code lines. */
  reading?: PhotoReading
  /** The photo it was made from, for Adjust Corners: only for a scan taken in this tab. */
  source?: Blob
  turn?: Turn
  corners?: Quad
  size?: { width: number; height: number }
}

/** What a Save did, for the Saved screen. */
export interface Saved {
  employeeId: string
  name: string
  created: boolean
  changed: DocumentTake[]
  merged: string | null
  sides: Side[]
}

/** The printed text's reading: while it runs, and what it offered. */
export interface Printed {
  state: 'reading' | 'done' | 'failed'
  /** The page the names were read on, and their printed lines. */
  namesPage?: number
  surname?: PrintedName
  givenNames?: PrintedName
  issuedOn?: string
}

/** A scan the app is working on: its kept scan's id, pages and draft. */
export interface Session {
  id: string
  kind: IdentityDocumentKind
  state: KeptScanState
  pages: ScanPage[]
  draft: ScanDraft
  saved?: Saved
  /** Find Employee's candidates, for Update to compare with. */
  candidates?: DocumentCandidate[]
  /** The printed fields read after the MRZ (DS-14): names offered, the date of issue by its rule. */
  printed?: Printed
  /** The two candidates Merge Employees joins, as Find Employee offered them. */
  pair?: { a: string; b: string }
  /** The employee a saved scan's document went to. */
  employeeId?: string
  /** Merge Employees done for this scan: the removed record's name, said on Update. */
  merged?: string
}

/** What the camera starts for: a new scan, or one taken again in place of a kept one. */
export interface Retake {
  replaces: string
  kind: IdentityDocumentKind
}

interface Store {
  get: (id: string) => Session | undefined
  put: (s: Session) => void
  update: (id: string, fn: (s: Session) => Session) => void
  drop: (id: string) => void
  retake: Retake | null
  setRetake: (r: Retake | null) => void
}

const Sessions = createContext<Store | null>(null)

/**
 * The scans being worked on, in this tab's memory only (plan DSN-6): pages as blobs with
 * their URLs, revoked when a scan is dropped or the app goes. The kept scans themselves are
 * the server's, sealed; a scan opened from Scans in another tab is read again from its pages.
 */
export function SessionsProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<ReadonlyMap<string, Session>>(new Map())
  const [retake, setRetake] = useState<Retake | null>(null)
  const urls = useRef(new Set<string>())

  useEffect(() => {
    const all = urls.current
    return () => {
      for (const u of all) URL.revokeObjectURL(u)
      all.clear()
    }
  }, [])

  const revoke = useCallback((pages: readonly ScanPage[], keep: readonly ScanPage[] = []) => {
    const kept = new Set(keep.map((p) => p.url))
    for (const p of pages) {
      if (kept.has(p.url)) continue
      URL.revokeObjectURL(p.url)
      urls.current.delete(p.url)
    }
  }, [])

  const store = useMemo<Store>(
    () => ({
      get: (id) => map.get(id),
      put: (s) => {
        for (const p of s.pages) urls.current.add(p.url)
        setMap((m) => {
          const old = m.get(s.id)
          if (old) revoke(old.pages, s.pages)
          return new Map(m).set(s.id, s)
        })
      },
      update: (id, fn) =>
        setMap((m) => {
          const cur = m.get(id)
          if (!cur) return m
          const next = fn(cur)
          for (const p of next.pages) urls.current.add(p.url)
          revoke(cur.pages, next.pages)
          return new Map(m).set(id, next)
        }),
      drop: (id) =>
        setMap((m) => {
          const cur = m.get(id)
          if (!cur) return m
          revoke(cur.pages)
          const next = new Map(m)
          next.delete(id)
          return next
        }),
      retake,
      setRetake,
    }),
    [map, retake, revoke],
  )
  return <Sessions.Provider value={store}>{children}</Sessions.Provider>
}

export function useSessions(): Store {
  const s = useContext(Sessions)
  if (!s) throw new Error('useSessions outside SessionsProvider')
  return s
}

/** A page's picture URL, made for a blob: the store revokes it when the page goes. */
export const pageOf = (blob: Blob, side: Side, extra: Partial<ScanPage> = {}): ScanPage => ({
  key: crypto.randomUUID(),
  blob,
  url: URL.createObjectURL(blob),
  side,
  ...extra,
})
