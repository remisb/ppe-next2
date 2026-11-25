package document

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/vault"
)

// signedForm is a signed copy as Company Assets keeps one: the assignment
// assignment's form, of the equipment item linked to ana.
func signedForm(assignment uuid.UUID, data []byte, events *[]string) Sourced {
	return Sourced{
		Type: vault.SignedFormType, SourceID: assignment, Title: "EQ-0001 · 2026-11-20", DocumentDate: ptr("2026-11-20"),
		Links: []Link{
			{Kind: vault.Asset, ID: equipment, Label: "EQ-0001 Laptop", Requires: []string{"equipment.read"}},
			{Kind: vault.Employee, ID: ana, Label: "Ana Žukauskaitė"},
		},
		FileID: uuid.New(), Upload: Upload{FileName: "scan.pdf", Data: data}, Actor: manager.ID,
		Event: func(f SourcedFile) (audit.Event, error) {
			*events = append(*events, f.SHA256)
			return audit.New(uuid.New(), &manager.ID, "asset.signed_copy_uploaded", "asset", equipment, f.CreatedAt, nil, map[string]any{"sha256": f.SHA256})
		},
	}
}

func TestAddSourcedKeepsOneDocumentPerSource(t *testing.T) {
	ctx := context.Background()
	f := newFixture()
	assignment := uuid.New()
	var events []string
	first, err := f.svc.AddSourced(ctx, signedForm(assignment, pdf, &events))
	if err != nil {
		t.Fatal(err)
	}
	second := signedForm(assignment, append([]byte("%PDF-1.7 again"), pdf...), &events)
	got, err := f.svc.AddSourced(ctx, second)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != second.FileID || len(events) != 2 || events[1] != got.SHA256 {
		t.Errorf("second = %+v, events %v", got, events)
	}
	if len(f.repo.docs) != 1 {
		t.Fatalf("documents = %d, want one per source", len(f.repo.docs))
	}
	var d Document
	for _, d = range f.repo.docs {
	}
	if !d.Locked || d.Type != vault.SignedFormType || len(d.Versions) != 2 || d.Versions[0].Origin != VersionAdded ||
		d.Versions[1].Origin != VersionOriginal || d.Versions[1].ID != first.ID || d.Versions[1].File.ID != first.ID {
		t.Errorf("document = %+v", d)
	}
	if !strings.HasPrefix(d.Versions[0].File.ObjectKey, "vault/"+d.ID.String()+"/") {
		t.Errorf("object key = %q", d.Versions[0].File.ObjectKey)
	}
	if strings.Join(d.Requires, ",") != "equipment.read,vault.read" {
		t.Errorf("requires = %v", d.Requires)
	}
	for _, l := range d.Links {
		if !l.Locked {
			t.Errorf("link %+v is not locked", l)
		}
	}
	// Only the source's event: the vault records none of its own.
	if names := f.repo.eventNames(); len(names) != 2 || names[0] != "asset.signed_copy_uploaded" {
		t.Errorf("events = %v", names)
	}

	files, err := f.svc.SourcedFiles(ctx, vault.SignedFormType, []uuid.UUID{assignment, uuid.New()})
	if err != nil || len(files) != 1 || len(files[assignment]) != 2 {
		t.Fatalf("files = %+v, %v", files, err)
	}
	opened, data, err := f.svc.OpenSourced(ctx, vault.SignedFormType, assignment, first.ID)
	if err != nil || string(data) != string(pdf) || opened.FileName != "scan.pdf" {
		t.Errorf("opened %+v %q, %v", opened, data, err)
	}
	if _, _, err := f.svc.OpenSourced(ctx, vault.SignedFormType, uuid.New(), first.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("through another source: %v", err)
	}
	if ids, err := f.svc.Sources(ctx, vault.SignedFormType); err != nil || len(ids) != 1 || ids[0] != assignment {
		t.Errorf("sources = %v, %v", ids, err)
	}

	// No one manages it in the vault: not added to, removed or uploaded as.
	all := Reader{ID: manager.ID, Perms: []string{vault.PermRead, vault.PermManage, "equipment.read"}}
	if _, err := f.svc.AddVersion(ctx, all, d.ID, Upload{FileName: "x.pdf", Data: pdf}); !errors.Is(err, ErrForbidden) {
		t.Errorf("add version: %v", err)
	}
	if err := f.svc.Remove(ctx, all, d.ID); !errors.Is(err, ErrForbidden) {
		t.Errorf("remove: %v", err)
	}
	if _, err := f.svc.Upload(ctx, all, vault.SignedFormType, Details{Title: "x", Links: []LinkRef{{Kind: vault.Asset, ID: equipment}, {Kind: vault.Employee, ID: ana}}},
		Upload{FileName: "x.pdf", Data: pdf}); !errors.Is(err, ErrForbidden) {
		t.Errorf("upload: %v", err)
	}
	if _, err := f.svc.Get(ctx, all, d.ID); err != nil {
		t.Errorf("a reader with both permissions sees it: %v", err)
	}
}

func TestAddSourcedRefuses(t *testing.T) {
	ctx := context.Background()
	f := newFixture()
	var events []string
	for name, c := range map[string]struct {
		edit func(*Sourced)
		want error
	}{
		"not a sourced type": {func(k *Sourced) { k.Type = "other" }, nil},
		"without the asset":  {func(k *Sourced) { k.Links = k.Links[1:] }, ErrInvalid},
		"a web page":         {func(k *Sourced) { k.Upload.Data = []byte("<html>") }, ErrFileType},
		"no event":           {func(k *Sourced) { k.Event = nil }, ErrInvalid},
	} {
		k := signedForm(uuid.New(), pdf, &events)
		c.edit(&k)
		_, err := f.svc.AddSourced(ctx, k)
		if err == nil || (c.want != nil && !errors.Is(err, c.want)) {
			t.Errorf("%s: %v, want %v", name, err, c.want)
		}
	}
	if len(f.store.files) != 0 || len(f.repo.docs) != 0 {
		t.Errorf("refused files were kept: %d files, %d documents", len(f.store.files), len(f.repo.docs))
	}
}
