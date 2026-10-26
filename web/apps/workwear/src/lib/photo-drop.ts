import { ApiError, type Client, type Employee } from '@ppe/api-client'
import { type DragEvent, useRef, useState } from 'react'

import { t } from '@/i18n'

const MAX_BYTES = 10 << 20

/** Why a file chosen or dropped as a photo is not sent, or null; the API checks the bytes again. */
export function photoProblem(file: Pick<File, 'name' | 'size' | 'type'>): string | null {
  if (file.size === 0) return t.employees.photos.fileEmpty
  if (file.size > MAX_BYTES) return t.employees.photos.fileTooLarge
  return ['image/jpeg', 'image/png'].includes(file.type) || /\.(jpe?g|png)$/i.test(file.name) ? null : t.employees.photos.fileType
}

/** An upload the API refused, in the user's language; any other error as it is. */
export function photoRefusal(err: unknown): unknown {
  if (!(err instanceof ApiError)) return err
  if (err.status === 413) return new Error(t.employees.photos.fileTooLarge)
  if (err.status === 415) return new Error(t.employees.photos.fileType)
  if (err.status === 503) return new Error(t.employees.photos.noStorage)
  return err
}

/**
 * Adds the files as photos of the employee, one after another, and answers
 * the message to show. A file that is not a photo stops it before anything is
 * sent, so a drop of several is all or none as far as the browser can tell.
 */
export async function addPhotos(client: Client, employee: Pick<Employee, 'id' | 'full_name'>, files: File[]): Promise<string> {
  for (const f of files) {
    const why = photoProblem(f)
    if (why) throw new Error(files.length > 1 ? `${f.name}: ${why}` : why)
  }
  for (const f of files) await client.employeePhotos.upload(employee.id, f)
  return files.length > 1 ? t.employees.photos.addedMany(files.length, employee.full_name) : t.employees.photos.added(employee.full_name)
}

const carriesFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files')
// A drop already taken by an inner target (a Photos section inside a droppable pane).
const taken = new WeakSet<Event>()

/**
 * Makes an element a drop target for files: `over` while files are dragged
 * over it (children included), and onFiles with what was dropped. Drags of
 * anything else, text or a link, pass through untouched.
 */
export function useFileDrop(onFiles: (files: File[]) => void, enabled = true) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const props = enabled
    ? {
        onDragEnter: (e: DragEvent) => {
          if (!carriesFiles(e)) return
          e.preventDefault()
          depth.current += 1
          setOver(true)
        },
        onDragOver: (e: DragEvent) => {
          if (!carriesFiles(e)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        },
        onDragLeave: (e: DragEvent) => {
          if (!carriesFiles(e)) return
          depth.current = Math.max(0, depth.current - 1)
          if (depth.current === 0) setOver(false)
        },
        onDrop: (e: DragEvent) => {
          if (!carriesFiles(e)) return
          e.preventDefault()
          depth.current = 0
          setOver(false)
          // The innermost target takes the files; the outer ones only stop showing it.
          if (taken.has(e.nativeEvent)) return
          taken.add(e.nativeEvent)
          const files = [...e.dataTransfer.files]
          if (files.length > 0) onFiles(files)
        },
      }
    : {}
  return { over, props }
}

/**
 * Makes every row of a list a drop target for files: rowProps(id) on each row,
 * overId the row files are dragged over, onFiles with the row's id and what was
 * dropped on it.
 */
export function useRowFileDrop(onFiles: (id: string, files: File[]) => void) {
  const [overId, setOverId] = useState<string | null>(null)
  const rowProps = (id: string) => ({
    onDragOver: (e: DragEvent) => {
      if (!carriesFiles(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      if (overId !== id) setOverId(id)
    },
    onDragLeave: (e: DragEvent) => {
      // Moving onto one of the row's own cells is not leaving it.
      if (!carriesFiles(e) || e.currentTarget.contains(e.relatedTarget as Node | null)) return
      setOverId((cur) => (cur === id ? null : cur))
    },
    onDrop: (e: DragEvent) => {
      if (!carriesFiles(e)) return
      e.preventDefault()
      setOverId(null)
      const files = [...e.dataTransfer.files]
      if (files.length > 0) onFiles(id, files)
    },
  })
  return { overId, rowProps }
}
