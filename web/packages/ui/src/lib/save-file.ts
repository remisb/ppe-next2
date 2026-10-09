/**
 * Saves a file the API sent (an export, a signed copy) under its name, as
 * the browser's own download would: the page itself never shows it.
 */
export function saveFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  // The download has started by then; the URL is not needed again.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
