package settings

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// fakeRepo holds the settings in memory, with the events written beside them.
type fakeRepo struct {
	cur    Settings
	events []audit.Event
}

func (f *fakeRepo) Get(context.Context) (Settings, error) { return f.cur, nil }

func (f *fakeRepo) Update(_ context.Context, m Mutation) (Settings, error) {
	next, ev, err := m(f.cur)
	if err != nil {
		return Settings{}, err
	}
	if ev != nil {
		f.cur = next
		f.events = append(f.events, *ev)
	}
	return next, nil
}

var at = time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)

func newTestService() (*Service, *fakeRepo) {
	repo := &fakeRepo{}
	return NewService(repo, WithClock(func() time.Time { return at })), repo
}

func TestSupplierChatLinks(t *testing.T) {
	cases := []struct {
		name, link, want string
		ok               bool
	}{
		{"copied with WhatsApp's suffix", "https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv?mode=ems_copy_t", "https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv", true},
		{"spaces and a trailing slash", "  https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv/  ", "https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv", true},
		{"http becomes https", "http://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv", "https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv", true},
		{"another host", "https://chat.whatsapp.com.evil.example/AbCdEfGhIjKlMnOpQrStUv", "", false},
		{"a person's wa.me link", "https://wa.me/37060000000", "", false},
		{"no code", "https://chat.whatsapp.com/", "", false},
		{"a code with odd characters", "https://chat.whatsapp.com/AbCd<script>", "", false},
		{"javascript", "javascript:alert(1)", "", false},
		{"credentials in the address", "https://x@chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv", "", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := SupplierChatParams{Name: "Supplier", Link: c.link}
			err := p.Validate()
			if c.ok != (err == nil) {
				t.Fatalf("Validate(%q) = %v, want ok %v", c.link, err, c.ok)
			}
			if !c.ok && !errors.Is(err, ErrInvalid) {
				t.Fatalf("err = %v, want ErrInvalid", err)
			}
			if c.ok && p.Link != c.want {
				t.Fatalf("link = %q, want %q", p.Link, c.want)
			}
		})
	}
}

func TestUpdateSupplierChat(t *testing.T) {
	svc, repo := newTestService()
	ctx := context.Background()
	actor := uuid.New()
	link := "https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv"

	// Unset at first: the zero settings.
	s, err := svc.Get(ctx)
	if err != nil || s.SupplierChat.Set() {
		t.Fatalf("Get = %+v, %v; want no supplier chat", s, err)
	}

	s, err = svc.UpdateSupplierChat(ctx, SupplierChatParams{Name: "  Superman   Rubai Group ", Link: link + "?mode=ems_copy_t"}, actor)
	if err != nil {
		t.Fatal(err)
	}
	want := SupplierChat{Name: "Superman Rubai Group", Link: link}
	if s.SupplierChat != want || s.UpdatedByUserID != actor || !s.UpdatedAt.Equal(at) {
		t.Fatalf("settings = %+v", s)
	}
	if len(repo.events) != 1 || repo.events[0].Event != EventSupplierChatChanged || repo.events[0].EntityID != AuditEntityID {
		t.Fatalf("events = %+v", repo.events)
	}

	// The same values again change nothing and record nothing.
	if _, err := svc.UpdateSupplierChat(ctx, SupplierChatParams{Name: "Superman Rubai Group", Link: link}, actor); err != nil {
		t.Fatal(err)
	}
	if len(repo.events) != 1 {
		t.Fatalf("an unchanged save recorded %d events", len(repo.events)-1)
	}

	// Both empty clears it.
	s, err = svc.UpdateSupplierChat(ctx, SupplierChatParams{}, actor)
	if err != nil || s.SupplierChat.Set() || len(repo.events) != 2 {
		t.Fatalf("clear: %+v, %v, %d events", s, err, len(repo.events))
	}
}

func TestUpdateSupplierChatRejects(t *testing.T) {
	svc, repo := newTestService()
	ctx := context.Background()
	long := make([]byte, maxChatNameLen+1)
	for i := range long {
		long[i] = 'a'
	}
	for name, c := range map[string]struct {
		p     SupplierChatParams
		actor uuid.UUID
	}{
		"no actor":         {SupplierChatParams{Link: "https://chat.whatsapp.com/AbCdEfGhIjKl"}, uuid.Nil},
		"a name, no link":  {SupplierChatParams{Name: "Supplier"}, uuid.New()},
		"a link, no name":  {SupplierChatParams{Name: "  ", Link: "https://chat.whatsapp.com/AbCdEfGhIjKl"}, uuid.New()},
		"a name too long":  {SupplierChatParams{Name: string(long), Link: "https://chat.whatsapp.com/AbCdEfGhIjKl"}, uuid.New()},
		"not a group link": {SupplierChatParams{Name: "Supplier", Link: "https://example.com/AbCdEfGhIjKl"}, uuid.New()},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := svc.UpdateSupplierChat(ctx, c.p, c.actor); !errors.Is(err, ErrInvalid) {
				t.Fatalf("err = %v, want ErrInvalid", err)
			}
		})
	}
	if len(repo.events) != 0 {
		t.Fatalf("a refused save recorded events: %+v", repo.events)
	}
}

func TestUpdateSIMProviders(t *testing.T) {
	svc, repo := newTestService()
	ctx := context.Background()
	actor := uuid.New()
	// Trimmed, empty ones dropped, the administrator's order kept; the default takes the list's spelling.
	s, err := svc.UpdateSIMProviders(ctx, SIMProvidersParams{Providers: []string{"  Telia ", "", "Bitė", " "}, Default: " telia"}, actor)
	if err != nil || !slices.Equal(s.SIMProviders, []string{"Telia", "Bitė"}) || s.DefaultSIMProvider != "Telia" ||
		s.UpdatedByUserID != actor || !s.UpdatedAt.Equal(at) {
		t.Fatalf("set: %+v, %v", s, err)
	}
	if len(repo.events) != 1 || repo.events[0].Event != EventSIMProvidersChanged || repo.events[0].EntityID != AuditEntityID {
		t.Fatalf("events = %+v", repo.events)
	}
	if got := string(repo.events[0].Before); got != `{"providers":[],"default_provider":"","default_non_return_value_cents":null,"default_plan":""}` {
		t.Fatalf("before = %s", got)
	}
	if got := string(repo.events[0].After); got != `{"providers":["Telia","Bitė"],"default_provider":"Telia","default_non_return_value_cents":null,"default_plan":""}` {
		t.Fatalf("after = %s", got)
	}
	// The same again records nothing; the supplier's group is left alone.
	repo.cur.SupplierChat = SupplierChat{Name: "Supplier", Link: "https://chat.whatsapp.com/AbCdEfGhIjKl"}
	if s, err := svc.UpdateSIMProviders(ctx, SIMProvidersParams{Providers: []string{"Telia", "Bitė"}, Default: "Telia"}, actor); err != nil ||
		len(repo.events) != 1 || !s.SupplierChat.Set() {
		t.Fatalf("unchanged: %+v, %v, %d events", s, err, len(repo.events))
	}
	// Another order, or only the default cleared, is a change.
	if s, err := svc.UpdateSIMProviders(ctx, SIMProvidersParams{Providers: []string{"Bitė", "Telia"}, Default: "Telia"}, actor); err != nil || len(repo.events) != 2 || s.SIMProviders[0] != "Bitė" {
		t.Fatalf("reordered: %+v, %v, %d events", s, err, len(repo.events))
	}
	if s, err := svc.UpdateSIMProviders(ctx, SIMProvidersParams{Providers: []string{"Bitė", "Telia"}}, actor); err != nil || s.DefaultSIMProvider != "" || len(repo.events) != 3 {
		t.Fatalf("no default: %+v, %v, %d events", s, err, len(repo.events))
	}
	// A default Non-return Value is a change; the same value again is not; none is one more.
	value := int64(2500)
	if s, err := svc.UpdateSIMProviders(ctx, SIMProvidersParams{Providers: []string{"Bitė", "Telia"}, DefaultNonReturnValueCents: &value}, actor); err != nil ||
		s.DefaultSIMNonReturnValueCents == nil || *s.DefaultSIMNonReturnValueCents != 2500 || len(repo.events) != 4 {
		t.Fatalf("value: %+v, %v, %d events", s, err, len(repo.events))
	}
	if got := string(repo.events[3].After); got != `{"providers":["Bitė","Telia"],"default_provider":"","default_non_return_value_cents":2500,"default_plan":""}` {
		t.Fatalf("after = %s", got)
	}
	same := int64(2500)
	if _, err := svc.UpdateSIMProviders(ctx, SIMProvidersParams{Providers: []string{"Bitė", "Telia"}, DefaultNonReturnValueCents: &same}, actor); err != nil || len(repo.events) != 4 {
		t.Fatalf("same value: %v, %d events", err, len(repo.events))
	}
	zero := int64(0)
	if s, err := svc.UpdateSIMProviders(ctx, SIMProvidersParams{Providers: []string{"Bitė", "Telia"}, DefaultNonReturnValueCents: &zero}, actor); err != nil ||
		s.DefaultSIMNonReturnValueCents == nil || *s.DefaultSIMNonReturnValueCents != 0 || len(repo.events) != 5 {
		t.Fatalf("zero: %+v, %v, %d events", s, err, len(repo.events))
	}
	// A default plan, trimmed, is a change; the same again is not.
	if s, err := svc.UpdateSIMProviders(ctx, SIMProvidersParams{Providers: []string{"Bitė", "Telia"}, DefaultNonReturnValueCents: &zero, DefaultPlan: " Biz 10 GB "}, actor); err != nil ||
		s.DefaultSIMPlan != "Biz 10 GB" || len(repo.events) != 6 {
		t.Fatalf("plan: %+v, %v, %d events", s, err, len(repo.events))
	}
	if got := string(repo.events[5].After); got != `{"providers":["Bitė","Telia"],"default_provider":"","default_non_return_value_cents":0,"default_plan":"Biz 10 GB"}` {
		t.Fatalf("after = %s", got)
	}
	if _, err := svc.UpdateSIMProviders(ctx, SIMProvidersParams{Providers: []string{"Bitė", "Telia"}, DefaultNonReturnValueCents: &zero, DefaultPlan: "Biz 10 GB"}, actor); err != nil || len(repo.events) != 6 {
		t.Fatalf("same plan: %v, %d events", err, len(repo.events))
	}
	// None at all.
	if s, err := svc.UpdateSIMProviders(ctx, SIMProvidersParams{}, actor); err != nil || len(s.SIMProviders) != 0 ||
		s.DefaultSIMNonReturnValueCents != nil || s.DefaultSIMPlan != "" || len(repo.events) != 7 {
		t.Fatalf("none: %+v, %v, %d events", s, err, len(repo.events))
	}
}

func TestUpdateSIMProvidersRejects(t *testing.T) {
	svc, repo := newTestService()
	ctx := context.Background()
	long := strings.Repeat("a", maxProviderLen+1)
	negative, tooMuch := int64(-1), int64(maxValueCents+1)
	many := make([]string, maxProviders+1)
	for i := range many {
		many[i] = fmt.Sprintf("Provider %d", i)
	}
	for name, c := range map[string]struct {
		p     SIMProvidersParams
		actor uuid.UUID
	}{
		"no actor":           {SIMProvidersParams{Providers: []string{"Telia"}}, uuid.Nil},
		"a name too long":    {SIMProvidersParams{Providers: []string{long}}, uuid.New()},
		"one twice":          {SIMProvidersParams{Providers: []string{"Telia", " telia "}}, uuid.New()},
		"too many":           {SIMProvidersParams{Providers: many}, uuid.New()},
		"a default unlisted": {SIMProvidersParams{Providers: []string{"Telia"}, Default: "Bitė"}, uuid.New()},
		"a default, no list": {SIMProvidersParams{Default: "Telia"}, uuid.New()},
		"a negative value":   {SIMProvidersParams{DefaultNonReturnValueCents: &negative}, uuid.New()},
		"a value too large":  {SIMProvidersParams{DefaultNonReturnValueCents: &tooMuch}, uuid.New()},
		"a plan too long":    {SIMProvidersParams{DefaultPlan: strings.Repeat("a", maxPlanLen+1)}, uuid.New()},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := svc.UpdateSIMProviders(ctx, c.p, c.actor); !errors.Is(err, ErrInvalid) {
				t.Fatalf("err = %v, want ErrInvalid", err)
			}
		})
	}
	if len(repo.events) != 0 {
		t.Fatalf("a refused save recorded events: %+v", repo.events)
	}
}
