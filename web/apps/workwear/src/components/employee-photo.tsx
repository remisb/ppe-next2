import type { Employee } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { cn } from '@ppe/ui/lib/utils'
import { useEffect, useState } from 'react'

import { initials } from '@/lib/records'

// A picture is fetched once per photo and kept for the page's life: lists show
// the same avatars again as the user moves between screens.
const pictures = new Map<string, Promise<string>>()

/** The photo as an object URL; null while it loads or when it cannot be had. */
export function usePhotoUrl(employeeId: string, photoId: string | null): string | null {
  const { client } = useApi()
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    setUrl(null)
    if (!photoId) return
    const key = `${employeeId}/${photoId}`
    let hit = pictures.get(key)
    if (!hit) {
      hit = client.employeePhotos.file(employeeId, photoId).then((f) => URL.createObjectURL(f.blob))
      pictures.set(key, hit)
      hit.catch(() => pictures.delete(key))
    }
    let current = true
    hit.then((u) => current && setUrl(u)).catch(() => undefined)
    return () => {
      current = false
    }
  }, [client, employeeId, photoId])
  return url
}

/** A photo, whole and uncropped within its box (letterboxed on the muted background), or the box while it loads. */
export function PhotoImage({ employeeId, photoId, alt, className }: { employeeId: string; photoId: string; alt: string; className?: string }) {
  const url = usePhotoUrl(employeeId, photoId)
  return url ? <img src={url} alt={alt} className={cn('bg-muted object-contain', className)} /> : <span aria-hidden className={cn('bg-muted', className)} />
}

/**
 * The employee's avatar: their default photo, else their initials. Decorative:
 * the name is always beside it.
 */
export function EmployeeAvatar({ employee, className }: { employee: Pick<Employee, 'id' | 'first_name' | 'last_name' | 'default_photo_id'>; className?: string }) {
  const url = usePhotoUrl(employee.id, employee.default_photo_id)
  const size = cn('flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-semibold text-muted-foreground', className)
  return url ? (
    <span aria-hidden className={size}>
      <img src={url} alt="" className="size-full object-cover" />
    </span>
  ) : (
    <span aria-hidden className={size}>
      {initials(employee)}
    </span>
  )
}
