package document

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/vault"
)

// stubIdentity holds employees' identity documents, a superseded one among them.
type stubIdentity struct {
	docs  map[uuid.UUID][]IdentityDocument
	asked []uuid.UUID
}

func (s *stubIdentity) Of(_ context.Context, id uuid.UUID, full bool) ([]IdentityDocument, error) {
	s.asked = append(s.asked, id)
	var out []IdentityDocument
	for _, d := range s.docs[id] {
		if d.Superseded && !full {
			continue
		}
		if !full {
			d.IssuedOn = nil
		}
		out = append(out, d)
	}
	return out, nil
}

func TestNameMatches(t *testing.T) {
	for _, c := range []struct {
		name, words string
		want        bool
	}{
		{"Ana Žukauskaitė", "zuk", true},
		{"Ana Žukauskaitė", "ANA žukausk", true},
		{"Ana Žukauskaitė", "kauskaite", false},
		{"Ana Žukauskaitė", "ana petr", false},
		{"Анна Петрова", "петр", true},
		{"Ana Žukauskaitė", "  ", false},
	} {
		if got := NameMatches(c.name, c.words); got != c.want {
			t.Errorf("NameMatches(%q, %q) = %v", c.name, c.words, got)
		}
	}
}

// A search about an employee lists their identity documents beside the
// vault's own: by the employee's name, or filtered by them; the current
// ones' kind, state and expiry for any vault reader, superseded ones and
// issue dates with Personnel files' read permission; never on a later page,
// filtered by type, or for words that name no linked employee.
func TestSearchListsIdentityDocuments(t *testing.T) {
	f := newFixture()
	ctx := context.Background()
	issued := "2020-03-01"
	ids := &stubIdentity{docs: map[uuid.UUID][]IdentityDocument{ana: {
		{ID: uuid.New(), Kind: "passport", IssuingState: "LTU", IssuedOn: &issued, ExpiresOn: "2030-03-01"},
		{ID: uuid.New(), Kind: "passport", IssuingState: "LTU", ExpiresOn: "2020-03-01", Superseded: true},
	}}}
	WithIdentityDocuments(ids)(f.svc)
	if _, err := f.svc.Upload(ctx, manager, "employee.certificate", certificate(LinkRef{vault.Employee, ana}), Upload{FileName: "c.pdf", Data: pdf}); err != nil {
		t.Fatal(err)
	}

	p, err := f.svc.Search(ctx, reader, Query{Words: "zukausk", Page: 1})
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Identity) != 1 || p.Identity[0].EmployeeID != ana || p.Identity[0].Holder != "Ana Žukauskaitė" ||
		p.Identity[0].Kind != "passport" || p.Identity[0].IssuedOn != nil || p.Total != 1 {
		t.Fatalf("identity = %+v, total %d", p.Identity, p.Total)
	}

	personnel := Reader{ID: uuid.New(), Perms: []string{vault.PermRead, vault.PermPersonnelRead}}
	p, _ = f.svc.Search(ctx, personnel, Query{Subject: &LinkRef{vault.Employee, ana}, Page: 1})
	if len(p.Identity) != 2 || p.Identity[0].IssuedOn == nil || !p.Identity[1].Superseded {
		t.Fatalf("in full = %+v", p.Identity)
	}

	asked := len(ids.asked)
	for name, q := range map[string]Query{
		"page 2":           {Words: "zukausk", Page: 2},
		"a type":           {Words: "zukausk", Types: []string{"employee.certificate"}, Page: 1},
		"other words":      {Words: "heights", Page: 1},
		"no words":         {Page: 1},
		"an asset subject": {Subject: &LinkRef{vault.Asset, equipment}, Page: 1},
	} {
		p, err := f.svc.Search(ctx, reader, q)
		if err != nil || len(p.Identity) != 0 || p.Identity == nil {
			t.Errorf("%s: identity %v, %v", name, p.Identity, err)
		}
	}
	if len(ids.asked) != asked {
		t.Errorf("Personnel files asked %d more times", len(ids.asked)-asked)
	}
}
