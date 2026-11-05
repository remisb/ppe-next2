import type { DocumentCopies, IdentityDocument } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { Button } from '@ppe/ui/components/button'
import { ActionError, PageHeader } from '@ppe/ui/components/states'
import { useEffect, useMemo, useState } from 'react'

import { t } from '@/i18n'
import { documentCopy } from '@/lib/copies'
import { COPY_PARTS, parseDraft, saveInput, type Box, type Draft, type Holder, type Photo, type Photos, type Slot } from '@/lib/flow'
import { PORTRAIT_WIDTH, cropRect, portraitBox } from '@/lib/portrait'
import { todayHere } from '@/lib/reader'

import { saveErrorText } from './issues'
import { HolderLine } from './person-step'
import { PortraitCrop } from './portrait-crop'

/**
 * Step 4 (FR-11, FR-13, FR-10): the portrait cut out of the document, found
 * from the MRZ band on a passport page, a card's front taken as filling its
 * picture, moved and resized by the user; kept as the document's sealed
 * Portrait copy, and, if chosen, as the employee's photo. Then Save, all or
 * none, with every photo as a Document Copy. Without a picture of the
 * portrait's side, Save goes on without one.
 */
export function PortraitStep({
  holder,
  draft,
  photos,
  pictures,
  file,
  onBack,
  onSaved,
}: {
  holder: Holder
  draft: Draft
  photos: Photos
  pictures: ReadonlyMap<string, string>
  /** A photo's file, by its picture's key. */
  file: (id: string) => Blob | undefined
  onBack: () => void
  onSaved: (doc: IdentityDocument) => void
}) {
  const { client } = useApi()
  const source: Photo | undefined = draft.type === 'passport' ? photos.page : photos.front
  const src = source ? pictures.get(source.id) : undefined
  const [aspect, setAspect] = useState<number | null>(null)
  const [box, setBox] = useState<Box | null>(null)
  const [keep, setKeep] = useState(true)
  const [asPhoto, setAsPhoto] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const m = useMemo(() => parseDraft(draft, todayHere()), [draft])

  // The picture's shape, then the box where the portrait should be.
  useEffect(() => {
    if (!src) return
    let live = true
    const img = new Image()
    img.onload = () => {
      if (!live) return
      const a = img.naturalWidth / img.naturalHeight
      setAspect(a)
      setBox(portraitBox(draft.type, a, source?.band))
    }
    img.src = src
    return () => {
      live = false
    }
  }, [src, draft.type, source?.band])

  const save = async () => {
    if (!m) return
    setSaving(true)
    setError(null)
    try {
      const parts: DocumentCopies = {}
      for (const [slot, p] of Object.entries(photos) as [Slot, Photo | undefined][]) {
        const f = p ? file(p.id) : undefined
        if (f) parts[COPY_PARTS[slot]] = await documentCopy(f)
      }
      const blob = keep && source && box ? await portraitOf(file(source.id), box) : undefined
      if (blob) parts.portrait = blob
      const doc = await client.personnel.save(saveInput(holder, draft, m), parts)
      // The employee's photo after the document: the document is what must not be lost.
      if (blob && asPhoto) {
        await client.employeePhotos.upload(doc.employee_id, new File([blob], 'portrait.jpg', { type: 'image/jpeg' }), ['profile'])
      }
      onSaved(doc)
    } catch (e) {
      setError(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader title={t.portrait.title} description={t.portrait.description} />
      <HolderLine holder={holder} />
      <section className="flex max-w-2xl flex-col gap-4">
        {src && aspect && box ? (
          <>
            <label className="flex min-h-11 items-start gap-2">
              <input type="checkbox" className="mt-1 size-4" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
              <span>
                <span className="font-medium">{t.portrait.keep}</span>
                <span className="block text-sm text-muted-foreground">{t.portrait.keepHint}</span>
              </span>
            </label>
            {keep ? (
              <>
                <PortraitCrop src={src} aspect={aspect} box={box} onBox={setBox} />
                <label className="flex min-h-11 items-start gap-2">
                  <input type="checkbox" className="mt-1 size-4" checked={asPhoto} onChange={(e) => setAsPhoto(e.target.checked)} />
                  <span>
                    <span className="font-medium">{t.portrait.asPhoto}</span>
                    <span className="block text-sm text-muted-foreground">{t.portrait.asPhotoHint}</span>
                  </span>
                </label>
              </>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{source ? t.portrait.loading : t.portrait.noPicture(draft.type)}</p>
        )}

        <div className="flex flex-col gap-3 border-t border-border pt-4">
          {saveErrorText(error) ? (
            <p role="alert" className="text-sm text-destructive">
              <span className="font-medium">{t.errors.title}:</span> {saveErrorText(error)}
            </p>
          ) : (
            <ActionError error={error} title={t.errors.title} />
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void save()} disabled={saving || !m}>
              {saving ? t.review.saving : t.review.save}
            </Button>
            <Button variant="outline" onClick={onBack} disabled={saving}>
              {t.review.back}
            </Button>
          </div>
        </div>
      </section>
    </>
  )
}

/** The box's part of the photo, at most PORTRAIT_WIDTH wide, as a JPEG drawn anew (no metadata). */
async function portraitOf(photo: Blob | undefined, box: Box): Promise<Blob | undefined> {
  if (!photo) return undefined
  const bitmap = await createImageBitmap(photo)
  const r = cropRect(box, bitmap.width, bitmap.height)
  const scale = Math.min(1, PORTRAIT_WIDTH / r.w)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(r.w * scale))
  canvas.height = Math.max(1, Math.round(r.h * scale))
  canvas.getContext('2d')!.drawImage(bitmap, r.x, r.y, r.w, r.h, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('the portrait could not be made'))), 'image/jpeg', 0.9),
  )
}
