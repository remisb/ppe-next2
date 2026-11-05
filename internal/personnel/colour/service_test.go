package colour

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/jpeg"
	"math"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/aiusage"
)

type fakeSettings struct {
	s   aiusage.Settings
	key string
}

func (f fakeSettings) Settings(context.Context) (aiusage.Settings, error) { return f.s, nil }
func (f fakeSettings) Key(context.Context) (string, error) {
	if f.key == "" {
		return "", aiusage.ErrNoKey
	}
	return f.key, nil
}

type fakeProvider struct {
	got  []Edit
	fail error
}

func (f *fakeProvider) Colorize(_ context.Context, e Edit, grey image.Image) (image.Image, aiusage.Result, error) {
	f.got = append(f.got, e)
	if f.fail != nil {
		return nil, aiusage.Result{Tokens: aiusage.Tokens{InputImage: 500}}, f.fail
	}
	return model(1024, 1536), aiusage.Result{Tokens: aiusage.Tokens{InputImage: 1000, OutputImage: 4160}, ProviderRequestID: "req"}, nil
}

type memLedger struct{ calls []aiusage.Call }

func (m *memLedger) Insert(_ context.Context, c aiusage.Call) error {
	m.calls = append(m.calls, c)
	return nil
}
func (m *memLedger) CostSince(context.Context, time.Time) (int64, error) {
	var sum int64
	for _, c := range m.calls {
		sum += c.CostMicroUSD
	}
	return sum, nil
}

func jpegOf(t *testing.T, img image.Image) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := jpeg.Encode(&b, img, &jpeg.Options{Quality: 95}); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func on() aiusage.Settings {
	s := aiusage.DefaultSettings()
	s.Enabled = true
	return s
}

func TestColorizeLocksAndRecords(t *testing.T) {
	ledger := &memLedger{}
	provider := &fakeProvider{}
	svc := NewService(fakeSettings{s: on(), key: "sk-test-key-1234567890"}, aiusage.NewService(ledger), provider)
	portrait := grey(90, 120)
	emp, actor := uuid.New(), uuid.New()
	out, err := svc.Colorize(context.Background(), jpegOf(t, portrait), emp, actor)
	if err != nil {
		t.Fatal(err)
	}
	img, err := jpeg.Decode(bytes.NewReader(out))
	if err != nil || img.Bounds().Dx() != 90 || img.Bounds().Dy() != 120 {
		t.Fatalf("answer %v, %v", img.Bounds(), err)
	}
	// JPEG on both sides moves L* a little more than the lock alone.
	want, got := Lightness(portrait), Lightness(img)
	sum := 0.0
	for i := range want {
		sum += math.Abs(want[i] - got[i])
	}
	if mean := sum / float64(len(want)); mean > 3 {
		t.Errorf("mean L* moved %.2f", mean)
	}
	if e := provider.got[0]; e.Key != "sk-test-key-1234567890" || e.Model != "gpt-image-2" || e.Quality != "medium" {
		t.Errorf("edit = %+v", e)
	}
	c := ledger.calls[0]
	if c.Outcome != aiusage.OK || c.Operation != aiusage.PortraitColorize || *c.EmployeeID != emp || c.UserID != actor || c.CostMicroUSD != 132800 {
		t.Errorf("call = %+v", c)
	}
}

func TestColorizeRefuses(t *testing.T) {
	ok := jpegOf(t, grey(30, 40))
	off := aiusage.DefaultSettings()
	cases := map[string]struct {
		settings fakeSettings
		portrait []byte
		want     error
	}{
		"switched off": {fakeSettings{s: off, key: "sk-test-key-1234567890"}, ok, ErrOff},
		"no key":       {fakeSettings{s: on()}, ok, aiusage.ErrNoKey},
		"not a JPEG":   {fakeSettings{s: on(), key: "sk-test-key-1234567890"}, []byte("\x89PNG"), ErrNotPortrait},
	}
	for name, c := range cases {
		ledger := &memLedger{}
		provider := &fakeProvider{}
		_, err := NewService(c.settings, aiusage.NewService(ledger), provider).Colorize(context.Background(), c.portrait, uuid.New(), uuid.New())
		if !errors.Is(err, c.want) || len(provider.got) != 0 {
			t.Errorf("%s: %v, %d calls made", name, err, len(provider.got))
		}
	}
	// A provider's refusal is recorded as failed, its tokens kept.
	ledger := &memLedger{}
	_, err := NewService(fakeSettings{s: on(), key: "sk-test-key-1234567890"}, aiusage.NewService(ledger), &fakeProvider{fail: &Error{Status: 400, Code: "moderation_blocked"}}).
		Colorize(context.Background(), ok, uuid.New(), uuid.New())
	if err == nil || ledger.calls[0].Outcome != aiusage.Failed || ledger.calls[0].ErrorCode != "moderation_blocked" || ledger.calls[0].Tokens.InputImage != 500 {
		t.Errorf("refused: %v, %+v", err, ledger.calls)
	}
}

func TestColorizeRateLimit(t *testing.T) {
	svc := NewService(fakeSettings{s: on(), key: "sk-test-key-1234567890"}, aiusage.NewService(&memLedger{}), &fakeProvider{})
	actor := uuid.New()
	p := jpegOf(t, grey(30, 40))
	for i := range RateLimit {
		if _, err := svc.Colorize(context.Background(), p, uuid.Nil, actor); err != nil {
			t.Fatalf("call %d: %v", i+1, err)
		}
	}
	if _, err := svc.Colorize(context.Background(), p, uuid.Nil, actor); !errors.Is(err, ErrTooOften) {
		t.Errorf("over the limit = %v", err)
	}
	if _, err := svc.Colorize(context.Background(), p, uuid.Nil, uuid.New()); err != nil {
		t.Errorf("another user = %v", err)
	}
}
