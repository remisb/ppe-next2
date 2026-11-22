import {
  ImageCropper as Root,
  ImageCropperHandle,
  ImageCropperImage,
  ImageCropperSelection,
  ImageCropperViewport,
  type ImageCrop,
} from '@ui-sdk/react/image-cropper'

import { cn } from '../lib/utils.ts'

/*
 * A box moved and resized over a picture, by finger, pinch, pointer or arrow keys
 * (ui-sdk's Image Cropper, docs: …/docs/components/image-cropper.md), for a portrait cut
 * out of a document. The crop is in the picture's own pixels; `cropImage` from
 * '@ui-sdk/react/image' turns it into a canvas.
 */
export type { ImageCrop }
export { cropImage } from '@ui-sdk/react/image'

const corner = 'size-6 -translate-1/2 rounded-full border-2 border-white bg-primary shadow outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function ImageCropper({ label, src, alt, aspectRatio, crop, defaultCrop, onCropChange, onCropCommit, className }: {
  /** The cropper's name ("Portrait"). */
  label: string
  src: string
  alt: string
  aspectRatio?: number
  crop?: ImageCrop
  defaultCrop?: ImageCrop
  onCropChange?: (crop: Required<ImageCrop>) => void
  /** Once a drag, key or wheel has ended: for saving. */
  onCropCommit?: (crop: Required<ImageCrop>) => void
  className?: string
}) {
  return (
    <Root
      aria-label={label}
      src={src}
      {...(aspectRatio !== undefined ? { aspectRatio } : {})}
      {...(crop ? { crop } : {})}
      {...(defaultCrop ? { defaultCrop } : {})}
      {...(onCropChange ? { onCropChange: (c: Required<ImageCrop>) => onCropChange(c) } : {})}
      {...(onCropCommit ? { onCropCommit: (c: Required<ImageCrop>) => onCropCommit(c) } : {})}
      className={cn('flex flex-col gap-2', className)}
    >
      <ImageCropperViewport className="aspect-(--image-cropper-aspect-ratio) max-h-[60dvh] w-full touch-none rounded-lg bg-black">
        <ImageCropperImage alt={alt} className="select-none" />
        <ImageCropperSelection className="outline-2 outline-white shadow-[0_0_0_9999px_rgb(0_0_0/0.55)] focus-visible:outline-primary" />
        <ImageCropperHandle position="nw" className={corner} />
        <ImageCropperHandle position="ne" className={corner} />
        <ImageCropperHandle position="sw" className={corner} />
        <ImageCropperHandle position="se" className={corner} />
      </ImageCropperViewport>
    </Root>
  )
}
