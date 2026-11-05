/**
 * Reading with a phone's camera or from photos, in the browser (shared by Scan
 * SIMs and docs-import). The light parts are here; the camera, the readers,
 * the pictures, the thumbnail and the readers' files' Vite plugin are their own
 * entry points, so a screen loads the readers only when it reads.
 */
export { MAX_SIDE, canvasOf, imageDataOf } from './canvas.ts'
export { Steady } from './steady.ts'
