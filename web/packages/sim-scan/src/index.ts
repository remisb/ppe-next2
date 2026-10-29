/**
 * Scan SIMs (docs/specs/asset-service.md "Scan SIM cards"): the rules and
 * words. The readers, the camera, the reader files' Vite plugin and the
 * review list are their own entry points, so a screen loads the readers
 * only when it scans.
 */
export * from './sim-scan.ts'
export { type SimScanText, simScanText } from './text.ts'
