package document

import (
	"os"
	"regexp"
	"slices"
	"testing"
)

// TestWebClientListsTheJobKinds keeps @ppe/api-client's JOB_KINDS, which
// Administration's words for System's Worker card are typed against, in step
// with Go.
func TestWebClientListsTheJobKinds(t *testing.T) {
	src, err := os.ReadFile("../../../web/packages/api-client/src/jobs.ts")
	if err != nil {
		t.Fatal(err)
	}
	list := regexp.MustCompile(`(?s)JOB_KINDS = \[(.*?)\] as const`).FindSubmatch(src)
	if list == nil {
		t.Fatal("no JOB_KINDS list in jobs.ts")
	}
	var web []string
	for _, m := range regexp.MustCompile(`'([^']+)'`).FindAllSubmatch(list[1], -1) {
		web = append(web, string(m[1]))
	}
	if !slices.Equal(web, JobKinds()) {
		t.Errorf("jobs.ts lists %v, Go %v", web, JobKinds())
	}
}
