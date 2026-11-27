// Package extract reads the text of a vault file for search (ADR 0008 phase 4,
// docs/specs/vault-service.md "Reading text"): a PDF's own text with
// pdftotext, and when that is sparse (a scan) its pages drawn with pdftoppm
// and read by Tesseract; a photo read by Tesseract. Lithuanian or Russian is
// chosen from the script Tesseract sees. The tools run as child processes in
// a temp folder of the job's own, killed with their children when the job's
// context ends. It runs in the worker (`api -worker`), never in the API.
package extract

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/remisb/ppe-next2/internal/files"
)

// Methods: how the text was read (vault.version_text.method).
const (
	MethodPDFText = "pdf_text"
	MethodOCR     = "ocr"
)

// Sparse is the fewest letters a page of a PDF's own text must average to
// be taken as the text; fewer, and the pages are read as pictures.
const Sparse = 50

// MaxText is the most text kept, in bytes (vault.version_text.content's limit).
const MaxText = 1 << 20

var (
	// ErrUnsupported is a file of a kind this package does not read.
	ErrUnsupported = errors.New("extract: not a PDF or a picture")
	// ErrNoText is a file with no words in it.
	ErrNoText = errors.New("extract: no text found")
	// ErrMissingTool is a worker without the tools.
	ErrMissingTool = errors.New("extract: tool missing")
)

// Result is what was read.
type Result struct {
	Text   string
	Method string
	// Language is Tesseract's language set for OCR ("lit+eng", "rus+eng"),
	// or the script seen in a PDF's own text ("lit", "rus", "eng").
	Language string
	// Pages is the number of pages read (at most MaxPages).
	Pages int
}

// Reader reads files with the tools on PATH.
type Reader struct {
	// MaxPages is the most pages read of a PDF (API_WORKER_MAX_PAGES).
	MaxPages int
	// TempDir holds each job's folder; "" is the system's.
	TempDir string
	// DPI is how finely a scanned page is drawn for OCR (300).
	DPI int
}

func (r Reader) maxPages() int {
	if r.MaxPages < 1 {
		return 50
	}
	return r.MaxPages
}

func (r Reader) dpi() int {
	if r.DPI < 72 {
		return 300
	}
	return r.DPI
}

// Read reads data, a file of contentType (files.PDF, JPEG or PNG).
func (r Reader) Read(ctx context.Context, contentType string, data []byte) (Result, error) {
	if contentType != files.PDF && contentType != files.JPEG && contentType != files.PNG {
		return Result{}, ErrUnsupported
	}
	dir, err := os.MkdirTemp(r.TempDir, "ppe-extract-")
	if err != nil {
		return Result{}, err
	}
	defer os.RemoveAll(dir)
	var res Result
	switch contentType {
	case files.PDF:
		res, err = r.readPDF(ctx, dir, data)
	default:
		name := filepath.Join(dir, "page"+files.Ext(contentType))
		if err := os.WriteFile(name, data, 0o600); err != nil {
			return Result{}, err
		}
		res, err = r.ocr(ctx, []string{name})
	}
	if err != nil {
		return Result{}, err
	}
	res.Text = Clip(Tidy(res.Text), MaxText)
	if letters(res.Text) == 0 {
		return Result{}, ErrNoText
	}
	return res, nil
}

func (r Reader) readPDF(ctx context.Context, dir string, data []byte) (Result, error) {
	in := filepath.Join(dir, "in.pdf")
	if err := os.WriteFile(in, data, 0o600); err != nil {
		return Result{}, err
	}
	last := fmt.Sprint(r.maxPages())
	out := filepath.Join(dir, "text.txt")
	if _, err := run(ctx, dir, "pdftotext", "-q", "-layout", "-enc", "UTF-8", "-l", last, in, out); err != nil {
		return Result{}, err
	}
	raw, err := readCapped(out, 4*MaxText)
	if err != nil {
		return Result{}, err
	}
	text := string(raw)
	pages := Pages(text)
	if pages > 0 && letters(text)/pages >= Sparse {
		return Result{Text: text, Method: MethodPDFText, Language: Script(text), Pages: pages}, nil
	}
	// Too few words for its pages: a scan. Draw the pages and read them.
	if _, err := run(ctx, dir, "pdftoppm", "-q", "-r", fmt.Sprint(r.dpi()), "-gray", "-png", "-l", last, in, filepath.Join(dir, "page")); err != nil {
		return Result{}, err
	}
	imgs, err := filepath.Glob(filepath.Join(dir, "page-*.png"))
	if err != nil {
		return Result{}, err
	}
	if len(imgs) == 0 {
		return Result{}, ErrNoText
	}
	sortPages(imgs)
	return r.ocr(ctx, imgs)
}

// ocr reads pictures, one per page, in the language their script needs
// (chosen once, from the first picture that shows one).
func (r Reader) ocr(ctx context.Context, imgs []string) (Result, error) {
	lang := ""
	for _, img := range imgs {
		if lang != "" {
			break
		}
		out, err := run(ctx, filepath.Dir(img), "tesseract", img, "stdout", "--psm", "0", "-l", "osd")
		if err != nil && ctx.Err() != nil {
			return Result{}, ctx.Err()
		}
		// psm 0 fails on a page with few characters: try the next one.
		if err == nil {
			lang = LanguagesFor(OSDScript(out))
		}
	}
	if lang == "" {
		lang = LanguagesFor("")
	}
	var b strings.Builder
	for i, img := range imgs {
		out, err := run(ctx, filepath.Dir(img), "tesseract", img, "stdout", "-l", lang, "--psm", "1")
		if err != nil {
			return Result{}, err
		}
		if i > 0 {
			b.WriteString("\f")
		}
		b.Write(out)
		if b.Len() > 4*MaxText {
			break
		}
	}
	return Result{Text: b.String(), Method: MethodOCR, Language: lang, Pages: len(imgs)}, nil
}

// pageNumber is the number in pdftoppm's page-07.png.
var pageNumber = regexp.MustCompile(`-(\d+)\.png$`)

// sortPages orders pdftoppm's pictures by page number (page-2 before page-10).
func sortPages(imgs []string) {
	num := func(s string) int {
		m := pageNumber.FindStringSubmatch(s)
		if m == nil {
			return 0
		}
		n, _ := strconv.Atoi(m[1]) // the pattern matched digits only
		return n
	}
	sort.SliceStable(imgs, func(i, j int) bool { return num(imgs[i]) < num(imgs[j]) })
}

// Pages is how many pages pdftotext's output has: it ends each with a form feed.
func Pages(text string) int {
	n := strings.Count(text, "\f")
	if n == 0 && strings.TrimSpace(text) != "" {
		return 1
	}
	return n
}

// letters counts the letters in s.
func letters(s string) int {
	n := 0
	for _, r := range s {
		if unicode.IsLetter(r) {
			n++
		}
	}
	return n
}

// Script names the script most of text's letters are in: "rus" for Cyrillic,
// "lit" for Latin with Lithuanian letters, else "eng".
func Script(text string) string {
	var cyr, lat, lt int
	for _, r := range text {
		switch {
		case unicode.Is(unicode.Cyrillic, r):
			cyr++
		case unicode.Is(unicode.Latin, r):
			lat++
			if strings.ContainsRune("ąčęėįšųūžĄČĘĖĮŠŲŪŽ", r) {
				lt++
			}
		}
	}
	switch {
	case cyr > lat:
		return "rus"
	case lt > 0:
		return "lit"
	default:
		return "eng"
	}
}

// OSDScript is the script in Tesseract's `--psm 0` output ("Script: Cyrillic").
func OSDScript(out []byte) string {
	sc := bufio.NewScanner(bytes.NewReader(out))
	for sc.Scan() {
		if v, ok := strings.CutPrefix(strings.TrimSpace(sc.Text()), "Script:"); ok {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// LanguagesFor is the Tesseract language set for a script: Russian with
// English for Cyrillic, else Lithuanian with English (the organisation's own).
func LanguagesFor(script string) string {
	if strings.EqualFold(script, "Cyrillic") {
		return "rus+eng"
	}
	return "lit+eng"
}

// spaces are runs of blanks within a line.
var spaces = regexp.MustCompile(`[ \t\x{00A0}]+`)

// Tidy keeps text's words and page breaks: valid UTF-8, no control
// characters, blanks squeezed, at most one empty line in a row.
func Tidy(text string) string {
	text = strings.ToValidUTF8(text, " ")
	text = strings.Map(func(r rune) rune {
		if r == '\n' || r == '\f' {
			return r
		}
		if unicode.IsControl(r) || r == utf8.RuneError {
			return ' '
		}
		return r
	}, text)
	var b strings.Builder
	empty := 0
	for line := range strings.SplitSeq(text, "\n") {
		line = strings.TrimSpace(spaces.ReplaceAllString(line, " "))
		if strings.Trim(line, "\f ") == "" {
			empty++
			if empty > 1 {
				continue
			}
		} else {
			empty = 0
		}
		b.WriteString(line)
		b.WriteByte('\n')
	}
	return strings.TrimSpace(b.String())
}

// Clip cuts s to at most n bytes, at a rune's start.
func Clip(s string, n int) string {
	if len(s) <= n {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n]
}

// readCapped reads at most n bytes of the file at name.
func readCapped(name string, n int64) ([]byte, error) {
	f, err := os.Open(name)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return io.ReadAll(io.LimitReader(f, n))
}

// maxOutput is the most a tool may print before it is stopped.
const maxOutput = 8 << 20

// limited is a buffer that refuses more than maxOutput.
type limited struct{ bytes.Buffer }

var errTooMuch = errors.New("extract: tool printed too much")

func (l *limited) Write(p []byte) (int, error) {
	if l.Len()+len(p) > maxOutput {
		return 0, errTooMuch
	}
	return l.Buffer.Write(p)
}

// ToolError is a tool that failed, with a short reason (never the file's text).
type ToolError struct {
	Tool string
	Err  error
}

func (e *ToolError) Error() string { return e.Tool + ": " + e.Err.Error() }
func (e *ToolError) Unwrap() error { return e.Err }

// run runs a tool in dir and returns what it printed, killing its process
// group when ctx ends. Its environment is the worker's, limited to one
// thread for Tesseract, so one job takes one CPU.
func run(ctx context.Context, dir, tool string, args ...string) ([]byte, error) {
	path, err := exec.LookPath(tool)
	if err != nil {
		return nil, fmt.Errorf("%w: %s", ErrMissingTool, tool)
	}
	cmd := exec.CommandContext(ctx, path, args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "OMP_THREAD_LIMIT=1", "TMPDIR="+dir)
	var out limited
	var stderr limited
	cmd.Stdout = &out
	cmd.Stderr = &stderr
	cmd.WaitDelay = 5 * time.Second
	ownGroup(cmd)
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, &ToolError{Tool: tool, Err: errors.New(reason(err, stderr.String()))}
	}
	return out.Bytes(), nil
}

// reason is a tool's failure in a few words: its exit and the first line it
// wrote to stderr, cut short (the tools do not print the file's text there).
func reason(err error, stderr string) string {
	msg := err.Error()
	if line, _, _ := strings.Cut(strings.TrimSpace(stderr), "\n"); line != "" {
		msg += ": " + Clip(strings.TrimSpace(line), 120)
	}
	return msg
}

// Tools are the tools found and their versions, for the worker's heartbeat.
func Tools(ctx context.Context) map[string]string {
	out := map[string]string{}
	for _, t := range []struct{ name, arg string }{{"pdftotext", "-v"}, {"pdftoppm", "-v"}, {"tesseract", "--version"}} {
		path, err := exec.LookPath(t.name)
		if err != nil {
			continue
		}
		vctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		b, _ := exec.CommandContext(vctx, path, t.arg).CombinedOutput()
		cancel()
		out[t.name] = version(string(b))
	}
	if _, ok := out["tesseract"]; ok {
		vctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		b, _ := exec.CommandContext(vctx, "tesseract", "--list-langs").CombinedOutput()
		cancel()
		out["tesseract_languages"] = strings.Join(Languages(string(b)), "+")
	}
	return out
}

// Ready is whether tools hold everything Read needs: the three tools and
// Tesseract's lit, rus, eng and osd.
func Ready(tools map[string]string) bool {
	for _, t := range []string{"pdftotext", "pdftoppm", "tesseract"} {
		if _, ok := tools[t]; !ok {
			return false
		}
	}
	have := strings.Split(tools["tesseract_languages"], "+")
	for _, l := range []string{"eng", "lit", "rus", "osd"} {
		if !slices.Contains(have, l) {
			return false
		}
	}
	return true
}

var versionWord = regexp.MustCompile(`\d+\.\d+(\.\d+)?`)

// version is the first version number in a tool's banner.
func version(banner string) string {
	if v := versionWord.FindString(banner); v != "" {
		return v
	}
	return "unknown"
}

// Languages are the languages `tesseract --list-langs` lists, sorted.
func Languages(out string) []string {
	var langs []string
	for line := range strings.SplitSeq(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.Contains(line, " ") || strings.HasSuffix(line, ":") {
			continue
		}
		langs = append(langs, line)
	}
	sort.Strings(langs)
	return langs
}
