import { Carousel, CarouselContent, CarouselItem, CarouselViewport } from '@ui-sdk/react/carousel'
import { type ReactNode, useRef } from 'react'

import { cn } from '../lib/utils.ts'
import { uiText } from '../text.ts'

/*
 * Pages swiped one at a time, over a strip of their thumbnails, as Photos shows a photo:
 * two of ui-sdk's Carousels sharing the page (docs: …/docs/components/carousel.md,
 * "Thumbnails"). The page is the caller's, from 1, so a toolbar can act on it.
 */

export interface GalleryItem {
  id: string
  /** Read by a screen reader for the page and its thumbnail ("Back", "Front"). */
  label: string
  page: ReactNode
  thumb: ReactNode
}

export function Gallery({ label, items, page, onPageChange, className }: {
  label: string
  items: readonly GalleryItem[]
  page: number
  onPageChange: (page: number) => void
  className?: string
}) {
  const strip = useRef<HTMLDivElement>(null)
  const t = uiText()
  const show = (next: number) => {
    onPageChange(next)
    strip.current?.querySelectorAll('button')[next - 1]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  return (
    <div className={cn('flex min-h-0 flex-col gap-2', className)}>
      <Carousel aria-label={label} page={page} onPageChange={show} className="min-h-0 flex-1">
        <CarouselViewport className="h-full overflow-hidden">
          <CarouselContent className="h-full">
            {items.map((item, i) => (
              <CarouselItem key={item.id} aria-label={`${item.label} · ${t.pageOf(i + 1, items.length)}`} className="flex h-full min-w-0 shrink-0 basis-full items-center justify-center px-4">
                {item.page}
              </CarouselItem>
            ))}
          </CarouselContent>
        </CarouselViewport>
      </Carousel>
      {items.length > 1 ? (
        <Carousel ref={strip} aria-label={t.pages} dragFree slidesPerPage="auto" className="mx-auto max-w-full">
          <CarouselViewport className="overflow-hidden">
            <CarouselContent className="gap-1.5 px-1 py-1">
              {items.map((item, i) => (
                <CarouselItem key={item.id} aria-label={item.label} className="shrink-0">
                  <button
                    type="button"
                    aria-pressed={page === i + 1}
                    aria-label={item.label}
                    onClick={() => onPageChange(i + 1)}
                    className="flex h-11 w-14 items-center justify-center overflow-hidden rounded-md bg-muted opacity-60 outline-none ring-offset-2 ring-offset-background aria-pressed:opacity-100 aria-pressed:ring-2 aria-pressed:ring-primary focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {item.thumb}
                  </button>
                </CarouselItem>
              ))}
            </CarouselContent>
          </CarouselViewport>
        </Carousel>
      ) : null}
    </div>
  )
}
