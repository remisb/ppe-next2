/**
 * Every attention item the Overview can show, in the order Go lists them
 * (internal/overview Keys(); a Go test reads this file). The apps' words are
 * typed against this list.
 */
export const ATTENTION_KEYS = [
  'backups_not_running',
  'last_backup_failed',
  'copied_sign_in',
  'failed_sign_ins',
  'error_rate',
  'new_errors',
  'review_overdue',
  'database_growth',
] as const

export type AttentionKey = (typeof ATTENTION_KEYS)[number]

export function isAttentionKey(v: unknown): v is AttentionKey {
  return typeof v === 'string' && (ATTENTION_KEYS as readonly string[]).includes(v)
}
