/** The worker's job kinds, as Go's vault document.JobKinds() lists them (System's Worker card). */
export const JOB_KINDS = ['vault.extract_text', 'vault.archive', 'vault.render_docx'] as const

export type JobKind = (typeof JOB_KINDS)[number]
