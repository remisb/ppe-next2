package launcher

import (
	"context"
	"errors"
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/domain/role"
)

// memRepo keeps tiles in order, as the database does by position.
type memRepo struct {
	apps     []App
	pins     map[uuid.UUID][]uuid.UUID
	feedback []Feedback
	events   []audit.Event
}

func newMem() *memRepo {
	m := &memRepo{pins: map[uuid.UUID][]uuid.UUID{}}
	for i, d := range Defaults {
		d.ID, d.Position = uuid.New(), (i+1)*positionStep
		m.apps = append(m.apps, d)
	}
	return m
}

func (m *memRepo) sorted() []App {
	out := slices.Clone(m.apps)
	slices.SortStableFunc(out, func(a, b App) int { return a.Position - b.Position })
	return out
}

func (m *memRepo) List(context.Context) ([]App, error) { return m.sorted(), nil }

func (m *memRepo) Get(_ context.Context, slug string) (App, error) {
	for _, a := range m.apps {
		if a.Slug == slug {
			return a, nil
		}
	}
	return App{}, ErrNotFound
}

func (m *memRepo) Create(_ context.Context, a App, ev audit.Event) (App, error) {
	if _, err := m.Get(context.Background(), a.Slug); err == nil {
		return App{}, ErrSlugTaken
	}
	m.apps = append(m.apps, a)
	m.events = append(m.events, ev)
	return a, nil
}

func (m *memRepo) Update(_ context.Context, slug string, f Mutation) (App, error) {
	for i, a := range m.apps {
		if a.Slug == slug {
			next, evs, err := f(a)
			if err != nil {
				return App{}, err
			}
			m.apps[i] = next
			m.events = append(m.events, evs...)
			return next, nil
		}
	}
	return App{}, ErrNotFound
}

func (m *memRepo) Reorder(_ context.Context, f OrderMutation) ([]App, error) {
	changed, evs, err := f(m.sorted())
	if err != nil {
		return nil, err
	}
	for _, c := range changed {
		for i := range m.apps {
			if m.apps[i].ID == c.ID {
				m.apps[i] = c
			}
		}
	}
	m.events = append(m.events, evs...)
	return m.sorted(), nil
}

func (m *memRepo) Pins(_ context.Context, user uuid.UUID) ([]string, error) {
	out := []string{}
	for _, id := range m.pins[user] {
		for _, a := range m.apps {
			if a.ID == id {
				out = append(out, a.Slug)
			}
		}
	}
	return out, nil
}

func (m *memRepo) SetPins(_ context.Context, user uuid.UUID, apps []uuid.UUID) error {
	m.pins[user] = apps
	return nil
}

func (m *memRepo) AddFeedback(_ context.Context, f Feedback) error {
	m.feedback = append(m.feedback, f)
	return nil
}

func (m *memRepo) Feedback(_ context.Context, app uuid.UUID) ([]Feedback, error) {
	out := []Feedback{}
	for _, f := range m.feedback {
		if f.AppID == app {
			out = append(out, f)
		}
	}
	return out, nil
}

func holding(perms ...role.Permission) func(role.Permission) bool {
	return func(p role.Permission) bool { return slices.Contains(perms, p) }
}

func slugs(apps []App) []string {
	out := make([]string, len(apps))
	for i, a := range apps {
		out[i] = a.Slug
	}
	return out
}

// valid is a POC on this site, everything filled in.
func valid() CreateParams {
	return CreateParams{Slug: "size-helper", Kind: KindApp, Fields: Fields{
		Group: "workwear", Icon: "flask", Color: "#a33a7c", Href: "/apps/size-helper/", Tier: TierHere, Stage: StagePOC,
		Names: Names{"Size Helper", "Dydžių pagalbininkas", "Помощник по размерам"},
	}}
}

func TestDefaultsAreValid(t *testing.T) {
	for _, d := range Defaults {
		f := Fields{Parent: d.Parent, Group: d.Group, Icon: d.Icon, Color: d.Color, Href: d.Href, Tier: d.Tier, Stage: d.Stage, Names: d.Names, AnyOf: role.Strings(d.AnyOf)}
		if err := (CreateParams{Slug: d.Slug, Kind: d.Kind, Fields: f}).Validate(); err != nil {
			t.Errorf("default %s: %v", d.Slug, err)
		}
	}
	// Administration's tile follows every permission that opens one of its screens.
	for _, p := range []role.Permission{role.UsersManage, role.AuditRead, role.AppsManage} {
		if !slices.Contains(administration, p) {
			t.Errorf("Administration's tile misses %s", p)
		}
	}
}

func TestValidate(t *testing.T) {
	for _, c := range []struct {
		name  string
		edit  func(p *CreateParams)
		field string
	}{
		{"slug with capitals", func(p *CreateParams) { p.Slug = "Size" }, ""},
		{"slug starting with a digit", func(p *CreateParams) { p.Slug = "1st" }, "slug"},
		{"no group", func(p *CreateParams) { p.Group = "" }, "group"},
		{"unknown icon", func(p *CreateParams) { p.Icon = "rocket" }, "icon"},
		{"colour too light for white text", func(p *CreateParams) { p.Color = "#f5c518" }, "color"},
		{"colour not hex", func(p *CreateParams) { p.Color = "navy" }, "color"},
		{"leaving the origin", func(p *CreateParams) { p.Href = "//evil.example/" }, "href"},
		{"a site address on this site", func(p *CreateParams) { p.Href = "https://example.org/" }, "href"},
		{"a linked path", func(p *CreateParams) { p.Tier, p.Href = TierLinked, "/apps/x/" }, "href"},
		{"a linked http address", func(p *CreateParams) { p.Tier, p.Href = TierLinked, "http://example.org/" }, "href"},
		{"no Lithuanian name", func(p *CreateParams) { p.Names.LT = " " }, "names.lt"},
		{"a long name", func(p *CreateParams) { p.Names.EN = strings.Repeat("a", 61) }, "names.en"},
		{"unknown permission", func(p *CreateParams) { p.AnyOf = []string{"apps.everything"} }, "any_of"},
		{"an app with a parent", func(p *CreateParams) { p.Parent = "workwear" }, "parent"},
		{"a shortcut without one", func(p *CreateParams) { p.Kind = KindShortcut }, "parent"},
		{"a linked shortcut", func(p *CreateParams) {
			p.Kind, p.Parent, p.Tier, p.Href = KindShortcut, "workwear", TierLinked, "https://example.org/"
		}, "tier"},
	} {
		t.Run(c.name, func(t *testing.T) {
			p := valid()
			c.edit(&p)
			p.Normalize()
			err := p.Validate()
			if c.field == "" {
				if err != nil {
					t.Fatalf("Validate = %v, want it fixed by Normalize", err)
				}
				return
			}
			if !errors.Is(err, ErrInvalid) || !strings.Contains(err.Error(), c.field) {
				t.Fatalf("Validate = %v, want an error on %s", err, c.field)
			}
		})
	}
	ok := valid()
	ok.Tier, ok.Href = TierLinked, "https://crew.example.org/"
	if err := ok.Validate(); err != nil {
		t.Errorf("linked https: %v", err)
	}
}

func TestVisible(t *testing.T) {
	all := newMem().sorted()
	admin := holding(administration...)
	// The employee role: Workwear and its shortcuts, no others.
	employee := Visible(all, holding(role.ItemSetsRead, role.DashboardEmployee))
	if got := slugs(employee); !slices.Equal(got, []string{"workwear", "dashboard", "create-order", "orders", "employees", "help", "sim-cards"}) {
		t.Errorf("employee sees %v", got)
	}
	if slices.Contains(slugs(Visible(all, admin)), "equipment") || !slices.Contains(slugs(Visible(all, admin)), "admin") {
		t.Errorf("administrator sees %v", slugs(Visible(all, admin)))
	}
	// Retired: no one. POC: testers only. A shortcut follows its app.
	for i := range all {
		switch all[i].Slug {
		case "crew":
			all[i].Stage = StageRetired
		case "sim-scan":
			all[i].Stage = StagePOC
		case "workwear":
			all[i].Stage = StageDev
		}
	}
	manager := holding(role.AssetsManage, role.DashboardManager)
	if got := slugs(Visible(all, manager)); len(got) != 0 {
		t.Errorf("manager sees %v, want nothing: Workwear is in development and the rest follow it or are retired", got)
	}
	tester := holding(role.AssetsManage, role.DashboardManager, role.AppsPreview)
	if got := slugs(Visible(all, tester)); !slices.Contains(got, "sim-scan") || !slices.Contains(got, "orders") || slices.Contains(got, "crew") {
		t.Errorf("tester sees %v", got)
	}
}

func TestCreateUpdateMove(t *testing.T) {
	repo := newMem()
	svc := NewService(repo, WithClock(func() time.Time { return time.Date(2026, 11, 4, 9, 0, 0, 0, time.UTC) }))
	ctx, actor := context.Background(), uuid.New()
	if err := svc.Refresh(ctx); err != nil || !svc.IsApp("sim-scan") || svc.IsApp("orders") {
		t.Fatalf("Refresh: %v, sim-scan %v, orders %v", err, svc.IsApp("sim-scan"), svc.IsApp("orders"))
	}

	if _, err := svc.Create(ctx, valid(), uuid.Nil); !errors.Is(err, ErrInvalid) {
		t.Errorf("no actor: %v", err)
	}
	a, err := svc.Create(ctx, valid(), actor)
	if err != nil || a.Position != (len(Defaults)+1)*positionStep || !svc.IsApp("size-helper") {
		t.Fatalf("Create = %+v, %v", a, err)
	}
	if _, err := svc.Create(ctx, valid(), actor); !errors.Is(err, ErrSlugTaken) {
		t.Errorf("same slug: %v", err)
	}
	sc := valid()
	sc.Slug, sc.Kind, sc.Parent = "size-chart", KindShortcut, "crew"
	if _, err := svc.Create(ctx, sc, actor); !errors.Is(err, ErrInvalid) {
		t.Errorf("a shortcut into a linked site: %v", err)
	}
	if last := repo.events[len(repo.events)-1]; last.Event != EventRegistered || last.EntityType != "app" {
		t.Errorf("event %+v", last)
	}

	// Nothing changed: no event. Stage and audience: one each.
	n := len(repo.events)
	up := UpdateParams{valid().Fields}
	if _, err := svc.Update(ctx, "size-helper", up, actor); err != nil || len(repo.events) != n {
		t.Fatalf("unchanged update: %v, %d events", err, len(repo.events)-n)
	}
	up.Stage, up.AnyOf = StagePilot, []string{"assets.manage"}
	got, err := svc.Update(ctx, "size-helper", up, actor)
	if err != nil || got.Stage != StagePilot || !slices.Equal(got.AnyOf, []role.Permission{role.AssetsManage}) {
		t.Fatalf("Update = %+v, %v", got, err)
	}
	if evs := repo.events[n:]; len(evs) != 2 || evs[0].Event != EventChanged || evs[1].Event != EventAudienceChanged {
		t.Errorf("events %v", evs)
	}
	if _, err := svc.Update(ctx, "nope", up, actor); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown slug: %v", err)
	}

	// Move it first; the others follow, numbered again.
	list, err := svc.Move(ctx, "size-helper", "workwear", actor)
	if err != nil || list[0].Slug != "size-helper" || list[1].Slug != "workwear" || list[0].Position != positionStep {
		t.Fatalf("Move = %v, %v", slugs(list), err)
	}
	if last := repo.events[len(repo.events)-1]; last.Event != EventMoved {
		t.Errorf("event %v", last.Event)
	}
	if list, err = svc.Move(ctx, "size-helper", "", actor); err != nil || list[len(list)-1].Slug != "size-helper" {
		t.Errorf("Move last = %v, %v", slugs(list), err)
	}
	if _, err := svc.Move(ctx, "size-helper", "size-helper", actor); !errors.Is(err, ErrInvalid) {
		t.Errorf("before itself: %v", err)
	}
}

func TestPinsAndFeedback(t *testing.T) {
	repo := newMem()
	svc := NewService(repo)
	ctx, user := context.Background(), uuid.New()
	manager := holding(role.AssetsManage, role.DashboardManager)

	if _, err := svc.SetPins(ctx, user, []string{"sim-scan", "orders"}, manager); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SetPins(ctx, user, []string{"admin"}, manager); !errors.Is(err, ErrInvalid) {
		t.Errorf("pinning a tile not seen: %v", err)
	}
	if _, err := svc.SetPins(ctx, user, []string{"orders", "orders"}, manager); !errors.Is(err, ErrInvalid) {
		t.Errorf("pinning twice: %v", err)
	}
	_, pins, err := svc.ForUser(ctx, user, manager)
	if err != nil || !slices.Equal(pins, []string{"sim-scan", "orders"}) {
		t.Fatalf("pins %v, %v", pins, err)
	}
	// Pins of tiles no longer seen are left out.
	if _, pins, _ = svc.ForUser(ctx, user, holding(role.DashboardManager)); !slices.Equal(pins, []string{"orders"}) {
		t.Errorf("pins without assets.manage: %v", pins)
	}

	fp := FeedbackParams{App: "sim-scan", Rating: "confusing", Text: " The PUK was read wrong. ", Device: "phone", Language: "lt"}
	f, err := svc.GiveFeedback(ctx, user, fp, manager)
	if err != nil || f.Text != "The PUK was read wrong." {
		t.Fatalf("GiveFeedback = %+v, %v", f, err)
	}
	if _, err := svc.GiveFeedback(ctx, user, FeedbackParams{App: "admin", Rating: "works", Device: "phone", Language: "en"}, manager); !errors.Is(err, ErrNotFound) {
		t.Errorf("feedback on an app not seen: %v", err)
	}
	if _, err := svc.GiveFeedback(ctx, user, FeedbackParams{App: "orders", Rating: "works", Device: "phone", Language: "en"}, manager); !errors.Is(err, ErrNotFound) {
		t.Errorf("feedback on a shortcut: %v", err)
	}
	if _, err := svc.GiveFeedback(ctx, user, FeedbackParams{App: "sim-scan", Rating: "meh", Device: "phone", Language: "en"}, manager); !errors.Is(err, ErrInvalid) {
		t.Errorf("unknown rating: %v", err)
	}
	if list, err := svc.Feedback(ctx, "sim-scan"); err != nil || len(list) != 1 {
		t.Errorf("Feedback = %v, %v", list, err)
	}
}

// TestWebClientListsTheIcons: the web draws each picture the API accepts.
func TestWebClientListsTheIcons(t *testing.T) {
	src, err := os.ReadFile("../../../web/packages/api-client/src/app-icons.ts")
	if err != nil {
		t.Fatal(err)
	}
	list := regexp.MustCompile(`(?s)APP_ICONS = \[(.*?)\] as const`).FindSubmatch(src)
	if list == nil {
		t.Fatal("no APP_ICONS list in app-icons.ts")
	}
	var web []string
	for _, m := range regexp.MustCompile(`'([^']+)'`).FindAllSubmatch(list[1], -1) {
		web = append(web, string(m[1]))
	}
	if !slices.Equal(web, Icons) {
		t.Errorf("app-icons.ts lists %v, the API %v", web, Icons)
	}
}
