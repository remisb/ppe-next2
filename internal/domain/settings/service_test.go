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

// names are providers with only a name.
func names(list ...string) []SIMProvider {
	out := make([]SIMProvider, len(list))
	for i, n := range list {
		out[i] = SIMProvider{Name: n}
	}
	return out
}

func TestUpdateSIMProviders(t *testing.T) {
	svc, repo := newTestService()
	ctx := context.Background()
	actor := uuid.New()
	// Trimmed, empty ones dropped, the administrator's order kept; the default takes the list's spelling.
	s, err := svc.UpdateSIMProviders(ctx, SIMProvidersParams{Providers: []SIMProvider{{Name: "  Telia "}, {Name: "", Email: "x@y.lt"}, {Name: "Bitė"}, {Name: " "}}, Default: " telia"}, actor)
	if err != nil || !slices.Equal(s.SIMProviders, names("Telia", "Bitė")) || s.DefaultSIMProvider != "Telia" ||
		s.UpdatedByUserID != actor || !s.UpdatedAt.Equal(at) {
		t.Fatalf("set: %+v, %v", s, err)
	}
	if len(repo.events) != 1 || repo.events[0].Event != EventSIMProvidersChanged || repo.events[0].EntityID != AuditEntityID {
		t.Fatalf("events = %+v", repo.events)
	}
	if got := string(repo.events[0].Before); got != `{"providers":[],"default_provider":"","default_non_return_value_cents":null}` {
		t.Fatalf("before = %s", got)
	}
	if got := string(repo.events[0].After); got != `{"providers":[{"name":"Telia","email":"","default_plan":""},{"name":"Bitė","email":"","default_plan":""}],"default_provider":"Telia","default_non_return_value_cents":null}` {
		t.Fatalf("after = %s", got)
	}
	// The same again records nothing; the supplier's group is left alone.
	repo.cur.SupplierChat = SupplierChat{Name: "Supplier", Link: "https://chat.whatsapp.com/AbCdEfGhIjKl"}
	if s, err := svc.UpdateSIMProviders(ctx, SIMProvidersParams{Providers: names("Telia", "Bitė"), Default: "Telia"}, actor); err != nil ||
		len(repo.events) != 1 || !s.SupplierChat.Set() {
		t.Fatalf("unchanged: %+v, %v, %d events", s, err, len(repo.events))
	}
	// Another order, or only the default cleared, is a change.
	if s, err := svc.UpdateSIMProviders(ctx, SIMProvidersParams{Providers: names("Bitė", "Telia"), Default: "Telia"}, actor); err != nil || len(repo.events) != 2 || s.SIMProviders[0].Name != "Bitė" {
		t.Fatalf("reordered: %+v, %v, %d events", s, err, len(repo.events))
	}
	if s, err := svc.UpdateSIMProviders(ctx, SIMProvidersParams{Providers: names("Bitė", "Telia")}, actor); err != nil || s.DefaultSIMProvider != "" || len(repo.events) != 3 {
		t.Fatalf("no default: %+v, %v, %d events", s, err, len(repo.events))
	}
	// A default Non-return Value is a change; the same value again is not; none is one more.
	value := int64(2500)
	if s, err := svc.UpdateSIMProviders(ctx, SIMProvidersParams{Providers: names("Bitė", "Telia"), DefaultNonReturnValueCents: &value}, actor); err != nil ||
		s.DefaultSIMNonReturnValueCents == nil || *s.DefaultSIMNonReturnValueCents != 2500 || len(repo.events) != 4 {
		t.Fatalf("value: %+v, %v, %d events", s, err, len(repo.events))
	}
	same := int64(2500)
	if _, err := svc.UpdateSIMProviders(ctx, SIMProvidersParams{Providers: names("Bitė", "Telia"), DefaultNonReturnValueCents: &same}, actor); err != nil || len(repo.events) != 4 {
		t.Fatalf("same value: %v, %d events", err, len(repo.events))
	}
	zero := int64(0)
	if s, err := svc.UpdateSIMProviders(ctx, SIMProvidersParams{Providers: names("Bitė", "Telia"), DefaultNonReturnValueCents: &zero}, actor); err != nil ||
		s.DefaultSIMNonReturnValueCents == nil || *s.DefaultSIMNonReturnValueCents != 0 || len(repo.events) != 5 {
		t.Fatalf("zero: %+v, %v, %d events", s, err, len(repo.events))
	}
	// A provider's e-mail and plan, trimmed, are a change; the same again is not.
	withContacts := []SIMProvider{{Name: "Bitė", Email: " verslas@bite.lt ", DefaultPlan: " Biz 10 GB "}, {Name: "Telia"}}
	if s, err := svc.UpdateSIMProviders(ctx, SIMProvidersParams{Providers: withContacts, DefaultNonReturnValueCents: &zero}, actor); err != nil ||
		s.SIMProviders[0] != (SIMProvider{Name: "Bitė", Email: "verslas@bite.lt", DefaultPlan: "Biz 10 GB"}) || len(repo.events) != 6 {
		t.Fatalf("contacts: %+v, %v, %d events", s, err, len(repo.events))
	}
	if got := string(repo.events[5].After); got != `{"providers":[{"name":"Bitė","email":"verslas@bite.lt","default_plan":"Biz 10 GB"},{"name":"Telia","email":"","default_plan":""}],"default_provider":"","default_non_return_value_cents":0}` {
		t.Fatalf("after = %s", got)
	}
	again := []SIMProvider{{Name: "Bitė", Email: "verslas@bite.lt", DefaultPlan: "Biz 10 GB"}, {Name: "Telia"}}
	if _, err := svc.UpdateSIMProviders(ctx, SIMProvidersParams{Providers: again, DefaultNonReturnValueCents: &zero}, actor); err != nil || len(repo.events) != 6 {
		t.Fatalf("same contacts: %v, %d events", err, len(repo.events))
	}
	if p, ok := repo.cur.Provider(" bitė"); !ok || p.Email != "verslas@bite.lt" {
		t.Fatalf("Provider(bitė) = %+v, %v", p, ok)
	}
	if _, ok := repo.cur.Provider(""); ok {
		t.Fatal("Provider(\"\") found one")
	}
	// None at all.
	if s, err := svc.UpdateSIMProviders(ctx, SIMProvidersParams{}, actor); err != nil || len(s.SIMProviders) != 0 ||
		s.DefaultSIMNonReturnValueCents != nil || len(repo.events) != 7 {
		t.Fatalf("none: %+v, %v, %d events", s, err, len(repo.events))
	}
}

func TestUpdateSIMProvidersRejects(t *testing.T) {
	svc, repo := newTestService()
	ctx := context.Background()
	long := strings.Repeat("a", maxProviderLen+1)
	negative, tooMuch := int64(-1), int64(maxValueCents+1)
	many := make([]SIMProvider, maxProviders+1)
	for i := range many {
		many[i] = SIMProvider{Name: fmt.Sprintf("Provider %d", i)}
	}
	for name, c := range map[string]struct {
		p     SIMProvidersParams
		actor uuid.UUID
	}{
		"no actor":           {SIMProvidersParams{Providers: names("Telia")}, uuid.Nil},
		"a name too long":    {SIMProvidersParams{Providers: names(long)}, uuid.New()},
		"one twice":          {SIMProvidersParams{Providers: names("Telia", " telia ")}, uuid.New()},
		"too many":           {SIMProvidersParams{Providers: many}, uuid.New()},
		"a default unlisted": {SIMProvidersParams{Providers: names("Telia"), Default: "Bitė"}, uuid.New()},
		"a default, no list": {SIMProvidersParams{Default: "Telia"}, uuid.New()},
		"a negative value":   {SIMProvidersParams{DefaultNonReturnValueCents: &negative}, uuid.New()},
		"a value too large":  {SIMProvidersParams{DefaultNonReturnValueCents: &tooMuch}, uuid.New()},
		"a plan too long":    {SIMProvidersParams{Providers: []SIMProvider{{Name: "Telia", DefaultPlan: strings.Repeat("a", maxPlanLen+1)}}}, uuid.New()},
		"not an e-mail":      {SIMProvidersParams{Providers: []SIMProvider{{Name: "Telia", Email: "telia"}}}, uuid.New()},
		"an e-mail and name": {SIMProvidersParams{Providers: []SIMProvider{{Name: "Telia", Email: "Telia <sim@telia.lt>"}}}, uuid.New()},
		"two e-mails":        {SIMProvidersParams{Providers: []SIMProvider{{Name: "Telia", Email: "a@telia.lt, b@telia.lt"}}}, uuid.New()},
		"no domain's dot":    {SIMProvidersParams{Providers: []SIMProvider{{Name: "Telia", Email: "sim@telia"}}}, uuid.New()},
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

func TestUpdateCompany(t *testing.T) {
	svc, repo := newTestService()
	ctx := context.Background()
	actor := uuid.New()
	s, err := svc.UpdateCompany(ctx, CompanyParams{Name: "  UAB   Gavort "}, actor)
	if err != nil || s.CompanyName != "UAB Gavort" || s.UpdatedByUserID != actor {
		t.Fatalf("set: %+v, %v", s, err)
	}
	if len(repo.events) != 1 || repo.events[0].Event != EventCompanyChanged || string(repo.events[0].Before) != `{"name":""}` ||
		string(repo.events[0].After) != `{"name":"UAB Gavort"}` {
		t.Fatalf("events = %+v", repo.events)
	}
	if _, err := svc.UpdateCompany(ctx, CompanyParams{Name: "UAB Gavort"}, actor); err != nil || len(repo.events) != 1 {
		t.Fatalf("unchanged: %v, %d events", err, len(repo.events))
	}
	if s, err := svc.UpdateCompany(ctx, CompanyParams{}, actor); err != nil || s.CompanyName != "" || len(repo.events) != 2 {
		t.Fatalf("cleared: %+v, %v, %d events", s, err, len(repo.events))
	}
	if _, err := svc.UpdateCompany(ctx, CompanyParams{Name: strings.Repeat("a", maxCompanyNameLen+1)}, actor); !errors.Is(err, ErrInvalid) {
		t.Fatalf("too long: err = %v", err)
	}
	if _, err := svc.UpdateCompany(ctx, CompanyParams{Name: "X"}, uuid.Nil); !errors.Is(err, ErrInvalid) {
		t.Fatalf("no actor: err = %v", err)
	}
}
