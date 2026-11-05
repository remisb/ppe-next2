package document

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/remisb/ppe-next2/internal/personnel/mrz"
	"github.com/remisb/ppe-next2/internal/sealbox"
)

// today is the tests' clock: the shared vectors' day.
var today = time.Date(2026, 11, 5, 9, 0, 0, 0, time.UTC)

// person is a made-up holder of a made-up Lithuanian passport.
type person struct {
	surname, given string
	number         string // up to 9 characters
	birth, expiry  string // YYMMDD
	sex            string
	personalCode   string // 11 digits, or ""
	issuingState   string
}

// jonas is the shared vectors' Lithuanian passport holder.
var jonas = person{surname: "PAVYZDYS", given: "JONAS", number: "91234567", birth: "330924", sex: "M",
	expiry: "310515", personalCode: "33309240064", issuingState: "LTU"}

// ona is another person, with a code of her own (2005-05-05, F).
var ona = person{surname: "BANDOMOJI", given: "ONA", number: "92345678", birth: "050505", sex: "F",
	expiry: "300101", personalCode: "60505051230", issuingState: "LTU"}

func cd(s string) string {
	d, ok := mrz.CheckDigit(s)
	if !ok {
		panic("not MRZ characters: " + s)
	}
	return strconv.Itoa(d)
}

func pad(s string, n int) string { return s + strings.Repeat("<", n-len(s)) }

// td3 is p's passport MRZ, every check digit right.
func td3(p person) []string {
	line1 := pad("P<"+p.issuingState+p.surname+"<<"+p.given, 44)
	number := pad(p.number, 9)
	personal := pad(p.personalCode, 14)
	personalCheck := cd(personal)
	part1 := number + cd(number)
	part2 := p.birth + cd(p.birth)
	part3 := p.expiry + cd(p.expiry) + personal + personalCheck
	line2 := part1 + p.issuingState + part2 + p.sex + part3 + cd(part1+part2+part3)
	return []string{line1, line2}
}

// td1 is p's ID card MRZ.
func td1(p person) []string {
	number := pad(p.number, 9)
	line1 := pad("ID"+p.issuingState+number+cd(number)+p.personalCode, 30)
	opt2 := pad("", 11)
	line2body := p.birth + cd(p.birth) + p.sex + p.expiry + cd(p.expiry) + p.issuingState + opt2
	composite := line1[5:30] + line2body[0:7] + line2body[8:15] + line2body[18:29]
	line2 := line2body + cd(composite)
	line3 := pad(p.surname+"<<"+p.given, 30)
	return []string{line1, line2, line3}
}

func jpegBytes(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for x := range w {
		img.Set(x, 0, color.RGBA{200, 100, 50, 255})
	}
	var b bytes.Buffer
	if err := jpeg.Encode(&b, img, nil); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func pngBytes(t *testing.T) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewRGBA(image.Rect(0, 0, 4, 4))); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func testKeys(t *testing.T) Keys {
	t.Helper()
	master, err := sealbox.NewKeyring(1, map[int16][]byte{1: bytes.Repeat([]byte{7}, sealbox.KeySize)})
	if err != nil {
		t.Fatal(err)
	}
	return Keys{Master: master, Index: bytes.Repeat([]byte{9}, sealbox.KeySize)}
}

func TestSpecimensParse(t *testing.T) {
	for name, lines := range map[string][]string{"jonas td3": td3(jonas), "ona td3": td3(ona), "jonas td1": td1(jonas)} {
		m := mrz.Parse(lines, mrz.Options{Today: "2026-11-05"})
		if m == nil || !m.Valid {
			t.Errorf("%s: %q does not parse as valid: %+v", name, lines, m)
		}
	}
	if got, want := td3(jonas)[1], "91234567<9LTU3309243M310515733309240064<<<42"; got != want {
		t.Errorf("td3(jonas) = %q, want the vectors' %q", got, want)
	}
}
