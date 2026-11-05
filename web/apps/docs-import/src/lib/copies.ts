/**
 * A photo as a Document Copy: drawn again as a JPEG at most COPY_MAX_SIDE on
 * its longer side. Drawing it anew leaves the camera's metadata behind, its
 * location included, so none of it leaves the phone (PR-3).
 */
import { COPY_MAX_SIDE } from './flow'

export async function documentCopy(photo: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(photo)
  const scale = Math.min(1, COPY_MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('the copy could not be made'))), 'image/jpeg', 0.88),
  )
}
