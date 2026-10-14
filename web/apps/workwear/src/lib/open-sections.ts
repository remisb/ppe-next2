import { useSession } from '@ppe/app-shell'

/**
 * The key a collapsible section is remembered under on this device: per user
 * and per kind of section, not per record, so Items given left open is open
 * for every employee.
 */
export function useOpenKey(section: string): string {
  return `workwear.open.${useSession().userId}.${section}`
}
