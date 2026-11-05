import type { IdentityDocument } from '@ppe/api-client'
import type { Mrz } from '@ppe/mrz'
import { usePictureStore } from '@ppe/scan-kit/pictures'
import { useEffect, useRef, useState } from 'react'

import { t } from '@/i18n'
import {
  draftFromReading,
  emptyDraft,
  placePhoto,
  readPhotoOf,
  type DocType,
  type Draft,
  type Holder,
  type Photo,
  type Photos,
  type Slot,
} from '@/lib/flow'
import { loadReader, todayHere } from '@/lib/reader'

import { CaptureStep } from './capture-step'
import { DoneStep } from './done-step'
import { PersonStep } from './person-step'
import { ReviewStep } from './review-step'

export type Step = 'person' | 'capture' | 'review' | 'done'

/**
 * Import Documents' one screen: Person → Document (photos) → Review → Saved,
 * as steps of one state, never routes, so going back and forth never loses
 * the work (plan PR-1, as Scan SIMs keeps its list). Photos and what was read
 * live in this screen's memory only: the pictures in a PictureStore (blob
 * URLs, revoked when they go), the files in a map, both dropped after Save,
 * on Import Another and when the screen goes. Leaving with a document read
 * and not saved asks first.
 */
export function ImportPage() {
  const [step, setStep] = useState<Step>('person')
  const [holder, setHolder] = useState<Holder | null>(null)
  const [type, setType] = useState<DocType>('passport')
  const [photos, setPhotos] = useState<Photos>({})
  const [draft, setDraft] = useState<Draft>(emptyDraft('passport'))
  const [reading, setReading] = useState(false)
  const [readerFailed, setReaderFailed] = useState(false)
  const [saved, setSaved] = useState<IdentityDocument | null>(null)
  const pictures = usePictureStore()
  const files = useRef(new Map<string, Blob>())

  const unsaved = step === 'capture' ? Object.keys(photos).length > 0 : step === 'review'
  useEffect(() => {
    if (!unsaved) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsaved])

  const forget = (ids: (string | undefined)[]) => {
    pictures.forget(ids)
    for (const id of ids) if (id) files.current.delete(id)
  }

  const chooseType = (next: DocType) => {
    if (next === type) return
    forget(Object.values(photos).map((p) => p?.id))
    setPhotos({})
    setType(next)
    setDraft(emptyDraft(next))
  }

  /** A picture whose MRZ the live view has read the same in two frames (FR-4): no second reading. */
  const addLiveRead = (picture: Blob, mrz: Mrz) => {
    const id = crypto.randomUUID()
    pictures.keep(id, picture)
    files.current.set(id, picture)
    const placed = placePhoto(type, photos, { id, found: true, agreed: true, mrz })
    forget([placed.dropped?.id])
    setPhotos(placed.photos)
  }

  const addPhoto = async (file: Blob) => {
    setReaderFailed(false)
    setReading(true)
    try {
      const reader = await loadReader()
      const r = await reader.readPhoto(file, todayHere())
      const id = crypto.randomUUID()
      pictures.keep(id, file)
      files.current.set(id, file)
      const photo: Photo = { id, found: r.found, agreed: r.agreed, ...(r.mrz ? { mrz: r.mrz } : {}) }
      const placed = placePhoto(type, photos, photo)
      forget([placed.dropped?.id])
      setPhotos(placed.photos)
    } catch {
      setReaderFailed(true)
    } finally {
      setReading(false)
    }
  }

  const read = readPhotoOf(type, photos)
  const review = () => {
    setDraft(read?.found ? draftFromReading(type, read) : emptyDraft(type))
    setStep('review')
  }

  const startAgain = () => {
    forget(Object.values(photos).map((p) => p?.id))
    setPhotos({})
    setDraft(emptyDraft(type))
    setSaved(null)
    setHolder(null)
    setStep('person')
  }

  const copies = () => {
    const out: Partial<Record<Slot, Blob>> = {}
    for (const [slot, p] of Object.entries(photos) as [Slot, Photo | undefined][]) {
      const f = p ? files.current.get(p.id) : undefined
      if (f) out[slot] = f
    }
    return out
  }

  return (
    <>
      <StepsBar step={step} />
      {step === 'person' ? (
        <PersonStep
          onChoose={(h) => {
            setHolder(h)
            setStep('capture')
          }}
        />
      ) : null}
      {step === 'capture' && holder ? (
        <CaptureStep
          holder={holder}
          type={type}
          photos={photos}
          pictures={pictures.urls}
          reading={reading}
          readerFailed={readerFailed}
          onType={chooseType}
          onPhoto={(f) => void addPhoto(f)}
          onLiveRead={addLiveRead}
          onChangePerson={() => setStep('person')}
          onReview={review}
          onTypeLines={() => {
            setDraft(emptyDraft(type))
            setStep('review')
          }}
        />
      ) : null}
      {step === 'review' && holder ? (
        <ReviewStep
          holder={holder}
          draft={draft}
          onDraft={setDraft}
          photos={photos}
          pictures={pictures.urls}
          copies={copies}
          onBack={() => setStep('capture')}
          onSaved={(doc) => {
            forget(Object.values(photos).map((p) => p?.id))
            setPhotos({})
            setSaved(doc)
            setStep('done')
          }}
        />
      ) : null}
      {step === 'done' && saved ? <DoneStep saved={saved} onAnother={startAgain} /> : null}
    </>
  )
}

/** Where the user is, in words: Person, Document, Review, Saved. */
function StepsBar({ step }: { step: Step }) {
  const order: Step[] = ['person', 'capture', 'review', 'done']
  const at = order.indexOf(step)
  return (
    <ol aria-label={t.steps.label} className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {order.map((s, i) => (
        <li
          key={s}
          aria-current={s === step ? 'step' : undefined}
          className={i === at ? 'font-semibold text-foreground' : i < at ? 'text-muted-foreground' : 'text-muted-foreground/70'}
        >
          {i + 1}. {t.steps[s]}
        </li>
      ))}
    </ol>
  )
}
