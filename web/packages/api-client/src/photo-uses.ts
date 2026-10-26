/** What an employee's photo may serve, in the order the API lists them; a photo has none, one or several. */
export const PHOTO_USES = ['profile', 'id_badge', 'sizing', 'receipt'] as const
export type PhotoUse = (typeof PHOTO_USES)[number]
