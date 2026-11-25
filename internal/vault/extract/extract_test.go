package extract

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"
)

func TestScript(t *testing.T) {
	for text, want := range map[string]string{
		"Darbo sutartis Nr. 12, Žukauskas": "lit",
		"Трудовой договор с работником":    "rus",
		"Employment contract, page 1":      "eng",
		"Трудовой договор Nr. 5 с Jonas":   "rus",
		"": "eng",
	} {
		if got := Script(text); got != want {
			t.Errorf("Script(%q) = %s, want %s", text, got, want)
		}
	}
}

func TestOSDAndLanguages(t *testing.T) {
	out := []byte("Page number: 0\nOrientation in degrees: 0\nRotate: 0\nOrientation confidence: 9.1\nScript: Cyrillic\nScript confidence: 3.2\n")
	if s := OSDScript(out); s != "Cyrillic" || LanguagesFor(s) != "rus+eng" {
		t.Fatalf("OSDScript = %q", s)
	}
	if LanguagesFor("Latin") != "lit+eng" || LanguagesFor("") != "lit+eng" {
		t.Fatal("Latin should read as lit+eng")
	}
	langs := Languages("List of available languages in \"/usr/share/tesseract-ocr/5/tessdata/\" (4):\neng\nlit\nosd\nrus\n")
	if !slices.Equal(langs, []string{"eng", "lit", "osd", "rus"}) {
		t.Fatalf("Languages = %v", langs)
	}
	tools := map[string]string{"pdftotext": "24.02.0", "pdftoppm": "24.02.0", "tesseract": "5.3.0", "tesseract_languages": "eng+lit+osd+rus"}
	if !Ready(tools) {
		t.Fatal("Ready = false with every tool")
	}
	tools["tesseract_languages"] = "eng+osd"
	if Ready(tools) {
		t.Fatal("Ready = true without lit and rus")
	}
	if version("pdftotext version 24.02.0\nCopyright") != "24.02.0" || version("tesseract 5.3.0\n leptonica-1.82.0") != "5.3.0" {
		t.Fatal("version")
	}
}

func TestPagesTidyClip(t *testing.T) {
	if Pages("a\fb\f") != 2 || Pages("one page, no feed") != 1 || Pages("  \n") != 0 {
		t.Fatal("Pages")
	}
	got := Tidy("  Darbo\t\tsutartis \x00\n\n\n\nNr.   12\xff\n")
	if got != "Darbo sutartis\n\nNr. 12" {
		t.Fatalf("Tidy = %q", got)
	}
	if c := Clip("ąčę", 3); c != "ą" {
		t.Fatalf("Clip = %q", c)
	}
	imgs := []string{"/t/page-10.png", "/t/page-2.png", "/t/page-1.png"}
	sortPages(imgs)
	if !slices.Equal(imgs, []string{"/t/page-1.png", "/t/page-2.png", "/t/page-10.png"}) {
		t.Fatalf("sortPages = %v", imgs)
	}
}

func TestReadRefusesOtherFiles(t *testing.T) {
	if _, err := (Reader{}).Read(context.Background(), "text/plain", []byte("x")); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("Read = %v, want ErrUnsupported", err)
	}
}

func TestReasonIsShort(t *testing.T) {
	r := reason(errors.New("exit status 1"), "Syntax Error: Couldn't read xref table\nmore lines with "+strings.Repeat("x", 500))
	if r != "exit status 1: Syntax Error: Couldn't read xref table" {
		t.Fatalf("reason = %q", r)
	}
}
