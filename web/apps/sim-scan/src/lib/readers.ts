/**
 * The barcode and text readers (@ppe/sim-scan/readers), loaded on first use,
 * not with the app: with their files they are several megabytes, needed only
 * once a card is scanned.
 */
type Readers = typeof import('@ppe/sim-scan/readers')

let loading: Promise<Readers> | undefined

export function loadReaders(): Promise<Readers> {
  loading ??= import('@ppe/sim-scan/readers').then((r) => {
    // The readers' files are this app's own (@ppe/sim-scan/reader-files).
    r.configureReaders(`${import.meta.env.BASE_URL}readers/`)
    return r
  })
  loading.catch(() => {
    loading = undefined
  })
  return loading
}
