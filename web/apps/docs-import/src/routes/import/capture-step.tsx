import { Thumb } from '@ppe/scan-kit/thumb'
import { Button } from '@ppe/ui/components/button'
import { PageHeader } from '@ppe/ui/components/states'
import { Segmented } from '@ppe/ui/components/segmented'
import { Camera, CircleCheck, ImagePlus, Keyboard, TriangleAlert } from 'lucide-react'
import { useRef } from 'react'

import { t } from '@/i18n'
import { readPhotoOf, slotsOf, type DocType, type Holder, type Photo, type Photos, type Slot } from '@/lib/flow'

import { HolderLine } from './person-step'

/**
 * Step 2 (FR-2, FR-3): the document photographed with the phone's camera
 * (Take Photo opens it) or chosen from photos. A passport needs its photo
 * page; a card its back, with the code lines, and its front, with the
 * portrait, in either order: the one with code lines is the back. Each photo
 * is read as it comes, twice (FR-4); Review opens once code lines are found,
 * and Type the Lines Instead whenever they are not.
 */
export function CaptureStep({
  holder,
  type,
  photos,
  pictures,
  reading,
  readerFailed,
  onType,
  onPhoto,
  onChangePerson,
  onReview,
  onTypeLines,
}: {
  holder: Holder
  type: DocType
  photos: Photos
  pictures: ReadonlyMap<string, string>
  reading: boolean
  readerFailed: boolean
  onType: (type: DocType) => void
  onPhoto: (file: File) => void
  onChangePerson: () => void
  onReview: () => void
  onTypeLines: () => void
}) {
  const camera = useRef<HTMLInputElement>(null)
  const chooser = useRef<HTMLInputElement>(null)
  const read = readPhotoOf(type, photos)
  const take = (input: HTMLInputElement) => {
    const f = input.files?.[0]
    input.value = ''
    if (f) onPhoto(f)
  }

  return (
    <>
      <PageHeader title={t.capture.title} description={t.capture.description} />
      <HolderLine holder={holder} onChange={onChangePerson} />
      <section className="flex max-w-2xl flex-col gap-4">
        <Segmented
          label={t.capture.typeLabel}
          layout="fit"
          value={type}
          onChange={onType}
          options={[
            { value: 'passport', label: t.capture.passport },
            { value: 'card', label: t.capture.card },
          ]}
        />
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => camera.current?.click()} disabled={reading}>
            <Camera aria-hidden className="size-4" />
            {t.capture.takePhoto}
          </Button>
          <Button variant="outline" onClick={() => chooser.current?.click()} disabled={reading}>
            <ImagePlus aria-hidden className="size-4" />
            {t.capture.choosePhoto}
          </Button>
          {/* capture="environment": the phone's back camera; on a computer, a file chooser. */}
          <input ref={camera} type="file" accept="image/*" capture="environment" hidden aria-label={t.capture.takePhoto} onChange={(e) => take(e.target)} />
          <input ref={chooser} type="file" accept="image/*" hidden aria-label={t.capture.choosePhoto} onChange={(e) => take(e.target)} />
        </div>
        {reading ? (
          <p role="status" className="text-sm">
            {t.capture.reading}
          </p>
        ) : null}
        {readerFailed ? (
          <p role="alert" className="text-sm text-destructive">
            {t.capture.readerFailed}
          </p>
        ) : null}

        <ul className="grid gap-3 sm:grid-cols-2">
          {slotsOf(type).map((slot) => (
            <PhotoSlot key={slot} slot={slot} photo={photos[slot]} src={photos[slot] ? pictures.get(photos[slot].id) : undefined} />
          ))}
        </ul>
        {type === 'card' && photos.front && !photos.back ? <p className="text-sm text-muted-foreground">{t.capture.frontOnly}</p> : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <Button onClick={onReview} disabled={reading || !read?.found}>
            {t.capture.continue}
          </Button>
          <Button variant="ghost" onClick={onTypeLines} disabled={reading}>
            <Keyboard aria-hidden className="size-4" />
            {t.capture.typeInstead}
          </Button>
        </div>
      </section>
    </>
  )
}

function PhotoSlot({ slot, photo, src }: { slot: Slot; photo: Photo | undefined; src: string | undefined }) {
  const label = t.capture[slot]
  const status = !photo
    ? null
    : slot === 'front'
      ? null
      : !photo.found
        ? { ok: false, text: t.capture.noMrz }
        : photo.agreed
          ? { ok: true, text: `${t.capture.found} ${t.capture.agreedNote}` }
          : { ok: false, text: t.capture.notAgreed }
  return (
    <li className="flex flex-col gap-2 rounded-md border border-border p-3">
      <span className="text-sm font-medium">{label}</span>
      <Thumb src={src} alt={label} className="h-40 object-contain" />
      {status ? (
        <span className={`flex items-start gap-1.5 text-sm ${status.ok ? 'text-success' : 'text-warning'}`}>
          {status.ok ? <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" /> : <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />}
          {status.text}
        </span>
      ) : null}
    </li>
  )
}
