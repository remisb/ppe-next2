/**
 * Scan SIMs (docs/specs/asset-service.md "Scan SIM cards"): the rules and
 * words. The readers (on @ppe/scan-kit's), the reader files' Vite plugin and
 * the review list are their own entry points, so a screen loads the readers
 * only when it scans. The camera, two-frame steadiness, the pictures and their
 * thumbnails are @ppe/scan-kit's.
 */
export * from './sim-scan.ts'
export { type SimScanText, simScanText } from './text.ts'
