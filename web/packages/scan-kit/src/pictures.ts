/**
 * A screen's pictures: each photo or camera snapshot as a blob URL, by its
 * id, for the thumbnails. A picture is kept before whatever shows it (so the
 * render that shows it finds it), and forgotten, its URL revoked, once nothing
 * shows it (Scan SIMs' list lets it go as `released`) or the screen goes.
 * Pictures live in memory only, never in browser storage: they may show codes
 * or a person's documents (docs/specs/asset-service.md "Scan SIM cards",
 * docs/apps/docs-import-plan.md PR-1).
 */
import { useEffect, useState } from 'react'

export interface BlobUrls {
  create: (blob: Blob) => string
  revoke: (url: string) => void
}

const browserUrls: BlobUrls = { create: (b) => URL.createObjectURL(b), revoke: (u) => URL.revokeObjectURL(u) }

export class PictureStore {
  readonly #urls = new Map<string, string>()
  readonly #blobUrls: BlobUrls

  constructor(blobUrls: BlobUrls = browserUrls) {
    this.#blobUrls = blobUrls
  }

  /** Keeps blob as id's picture, in place of any it had. */
  keep(id: string, blob: Blob): void {
    this.forget([id])
    this.#urls.set(id, this.#blobUrls.create(blob))
  }

  /** The picture's URL, or undefined once forgotten. */
  url(id: string | undefined): string | undefined {
    return id === undefined ? undefined : this.#urls.get(id)
  }

  /** Revokes and drops each id's picture; unknown ids and undefined are no matter. */
  forget(ids: readonly (string | undefined)[]): void {
    for (const id of ids) {
      if (id === undefined) continue
      const url = this.#urls.get(id)
      if (url !== undefined) this.#blobUrls.revoke(url)
      this.#urls.delete(id)
    }
  }

  forgetAll(): void {
    this.forget([...this.#urls.keys()])
  }

  get size(): number {
    return this.#urls.size
  }

  /** The thumbnails' map, as the review list reads it. */
  get urls(): ReadonlyMap<string, string> {
    return this.#urls
  }
}

/** A PictureStore for the screen's life: every picture is forgotten when it goes. */
export function usePictureStore(): PictureStore {
  const [store] = useState(() => new PictureStore())
  useEffect(() => () => store.forgetAll(), [store])
  return store
}
