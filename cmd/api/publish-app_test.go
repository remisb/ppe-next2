package main

import (
	"archive/tar"
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// entry is one tar header and, for a file, its content.
type entry struct {
	h    tar.Header
	body string
}

func file(name, body string) entry {
	return entry{tar.Header{Name: name, Typeflag: tar.TypeReg, Mode: 0o644, Size: int64(len(body))}, body}
}

func tarOf(t *testing.T, entries ...entry) *bytes.Buffer {
	t.Helper()
	var b bytes.Buffer
	tw := tar.NewWriter(&b)
	for _, e := range entries {
		h := e.h
		if err := tw.WriteHeader(&h); err != nil {
			t.Fatal(err)
		}
		if e.body != "" {
			if _, err := tw.Write([]byte(e.body)); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	return &b
}

// untar takes a build's folders and files and nothing else: no links or
// devices, no name outside the build or twice, within the limits.
func TestUntar(t *testing.T) {
	limits := buildLimits{bytes: 64, files: 3}
	ok := tarOf(t, entry{h: tar.Header{Name: "./", Typeflag: tar.TypeDir, Mode: 0o755}}, file("./index.html", "<head></head>"),
		entry{h: tar.Header{Name: "assets/", Typeflag: tar.TypeDir, Mode: 0o755}}, file("assets/a.js", "1"), file("b/../c.js", "2"))
	dir := t.TempDir()
	if err := untar(ok, dir, limits); err != nil {
		t.Fatalf("a build: %v", err)
	}
	for _, name := range []string{"index.html", "assets/a.js", "c.js"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Errorf("%s: %v", name, err)
		}
	}

	// tar pads its archive to a whole 10 KB record after the end marker: all of it is read, or the
	// writer at the pipe's other end (make prod-up's tar, the e2e setup) fails though the build was published.
	padded := tarOf(t, file("index.html", "<head></head>"))
	padded.Write(make([]byte, 10240-padded.Len()%10240))
	if err := untar(padded, t.TempDir(), limits); err != nil {
		t.Fatalf("a padded build: %v", err)
	}
	if padded.Len() != 0 {
		t.Errorf("%d bytes of the padding were left unread", padded.Len())
	}

	refused := map[string]struct {
		build *bytes.Buffer
		says  string
	}{
		"a symbolic link":         {tarOf(t, entry{h: tar.Header{Name: "evil", Typeflag: tar.TypeSymlink, Linkname: "/etc/passwd"}}), "not a file or a folder"},
		"a hard link":             {tarOf(t, file("a", "x"), entry{h: tar.Header{Name: "b", Typeflag: tar.TypeLink, Linkname: "a"}}), "not a file or a folder"},
		"a device":                {tarOf(t, entry{h: tar.Header{Name: "null", Typeflag: tar.TypeChar, Devmajor: 1, Devminor: 3}}), "not a file or a folder"},
		"an absolute name":        {tarOf(t, file("/tmp/evil.js", "x")), "outside the build"},
		"a name outside it":       {tarOf(t, file("assets/../../evil.js", "x")), "outside the build"},
		"a name twice":            {tarOf(t, file("index.html", "a"), file("./index.html", "b")), "exists"},
		"a folder named as file":  {tarOf(t, entry{h: tar.Header{Name: "x/", Typeflag: tar.TypeDir, Mode: 0o755}}, file("x", "1")), "exists"},
		"too many files":          {tarOf(t, file("1", "1"), file("2", "2"), file("3", "3"), file("4", "4")), "more than 3 files"},
		"more bytes than allowed": {tarOf(t, file("big", strings.Repeat("x", 65))), "larger than"},
	}
	for name, c := range refused {
		dir := t.TempDir()
		err := untar(c.build, dir, limits)
		if err == nil || !strings.Contains(err.Error(), c.says) {
			t.Errorf("%s: %v, want %q", name, err, c.says)
		}
	}
}
