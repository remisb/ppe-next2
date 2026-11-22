package main

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// TestAPIImageHasTmp keeps a writable /tmp in the API's scratch image. Go's
// ParseMultipartForm writes every part over the memory it is given (1 MiB,
// parseMultipart) to a temp file in os.TempDir(); scratch has no /tmp, so
// without it every upload over 1 MiB (a phone's photo, a signed form, a scan)
// answers 400 in production while it works on a developer's machine.
func TestAPIImageHasTmp(t *testing.T) {
	b, err := os.ReadFile("../../Dockerfile")
	if err != nil {
		t.Fatal(err)
	}
	src := string(b)
	last := strings.LastIndex(src, "\nFROM ")
	if last < 0 {
		t.Fatal("Dockerfile has no final stage")
	}
	build, final := src[:last], src[last:]
	if !strings.HasPrefix(final, "\nFROM scratch") {
		t.Skip("the final stage is not scratch: its base image provides /tmp")
	}
	// COPY of a folder copies its contents and creates the target as root's
	// 0755, so /tmp must come as a child of a copied folder to keep its 1777.
	root := regexp.MustCompile(`(?m)^COPY --from=build (\S+?)/? /\s*$`).FindStringSubmatch(final)
	if root == nil {
		t.Fatal("the scratch stage copies no folder holding tmp to / from the build stage: uploads over 1 MiB would fail")
	}
	if !regexp.MustCompile(`chmod 1777 ` + regexp.QuoteMeta(root[1]) + `/tmp\b`).MatchString(build) {
		t.Errorf("the build stage does not chmod 1777 %s/tmp: the API's user (65532) could not write /tmp", root[1])
	}
}
