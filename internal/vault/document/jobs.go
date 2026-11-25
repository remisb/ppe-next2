package document

// JobKinds lists every job the vault gives the worker, as System's Worker card
// names them; @ppe/api-client's JOB_KINDS must list the same (a test keeps
// them in step, so a new kind cannot reach the card without its words).
func JobKinds() []string {
	return []string{KindReadText, KindArchive, KindRenderDocx}
}
