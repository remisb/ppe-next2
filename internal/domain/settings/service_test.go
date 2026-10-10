package settings

import (
	"context"
	"errors"
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

func TestUpdateDefaultSIMProvider(t *testing.T) {
	svc, repo := newTestService()
	ctx := context.Background()
	actor := uuid.New()

	s, err := svc.UpdateDefaultSIMProvider(ctx, "  Telia  ", actor)
	if err != nil || s.DefaultSIMProvider != "Telia" || s.UpdatedByUserID != actor || !s.UpdatedAt.Equal(at) {
		t.Fatalf("set: %+v, %v", s, err)
	}
	if len(repo.events) != 1 || repo.events[0].Event != EventDefaultSIMProviderChanged || repo.events[0].EntityID != AuditEntityID {
		t.Fatalf("events = %+v", repo.events)
	}

	// The same provider again records nothing; the supplier's group is left alone.
	repo.cur.SupplierChat = SupplierChat{Name: "Supplier", Link: "https://chat.whatsapp.com/AbCdEfGhIjKl"}
	if s, err := svc.UpdateDefaultSIMProvider(ctx, "Telia", actor); err != nil || len(repo.events) != 1 || !s.SupplierChat.Set() {
		t.Fatalf("unchanged: %+v, %v, %d events", s, err, len(repo.events))
	}

	// Empty clears it.
	if s, err := svc.UpdateDefaultSIMProvider(ctx, " ", actor); err != nil || s.DefaultSIMProvider != "" || len(repo.events) != 2 {
		t.Fatalf("clear: %+v, %v, %d events", s, err, len(repo.events))
	}

	long := make([]byte, maxProviderLen+1)
	for i := range long {
		long[i] = 'a'
	}
	for name, c := range map[string]struct {
		provider string
		actor    uuid.UUID
	}{
		"no actor": {"Telia", uuid.Nil},
		"too long": {string(long), actor},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := svc.UpdateDefaultSIMProvider(ctx, c.provider, c.actor); !errors.Is(err, ErrInvalid) {
				t.Fatalf("err = %v, want ErrInvalid", err)
			}
		})
	}
	if len(repo.events) != 2 {
		t.Fatalf("a refused save recorded events: %+v", repo.events)
	}
}
