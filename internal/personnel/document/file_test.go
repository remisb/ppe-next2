package document

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"

	"github.com/google/uuid"
)

var quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

func ptr(s string) *string { return &s }

func savedPassport(t *testing.T, svc *Service) Document {
	t.Helper()
	d, err := svc.Save(context.Background(), passportParams(t, jonas, uuid.Nil), uuid.New())
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func TestShowRecordsBeforeItOpens(t *testing.T) {
	svc, repo, store := newTestService(t)
	doc := savedPassport(t, svc)
	actor := uuid.New()
	shown, err := svc.Show(context.Background(), doc.ID, actor)
	if err != nil {
		t.Fatal(err)
	}
	if shown.Fields.Number != "91234567" || shown.Fields.PersonalCode != "33309240064" || shown.Document.ID != doc.ID {
		t.Errorf("shown = %+v", shown)
	}
	last := repo.events[len(repo.events)-1]
	if last.Event != EventShown || *last.ActorUserID != actor || !strings.Contains(string(last.After), `"shown":"fields"`) {
		t.Errorf("event = %s %s", last.Event, last.After)
	}

	jpg, err := svc.ShowCopy(context.Background(), doc.ID, SidePage, actor)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(jpg, []byte{0xff, 0xd8}) {
		t.Error("the copy did not open to a JPEG")
	}
	if last := repo.events[len(repo.events)-1]; !strings.Contains(string(last.After), `"shown":"page"`) {
		t.Errorf("copy event = %s", last.After)
	}
	if _, err := svc.ShowCopy(context.Background(), doc.ID, SideFront, actor); !errors.Is(err, ErrNotFound) {
		t.Errorf("a side it has not = %v", err)
	}
	// A changed object does not open, and nothing is recorded as shown.
	for k, v := range store.objects {
		v[len(v)-1] ^= 1
		store.objects[k] = v
	}
	n := len(repo.events)
	if _, err := svc.ShowCopy(context.Background(), doc.ID, SidePage, actor); !errors.Is(err, ErrUnopenable) {
		t.Errorf("a changed object = %v, want ErrUnopenable", err)
	}
	if len(repo.events) != n {
		t.Error("a copy that did not open was recorded as shown")
	}
	noLeak(t, repo, store, "91234567", "33309240064")
}

func TestEmployeeRecordSwitchAndRemove(t *testing.T) {
	svc, repo, store := newTestService(t)
	doc := savedPassport(t, svc)
	actor := uuid.New()
	n := len(repo.events)
	if err := svc.SetEmployeeRecord(context.Background(), doc.ID, false, actor); err != nil || len(repo.events) != n {
		t.Errorf("no change = %v, %d events", err, len(repo.events)-n)
	}
	if err := svc.SetEmployeeRecord(context.Background(), doc.ID, true, actor); err != nil {
		t.Fatal(err)
	}
	if !repo.documents[doc.ID].OnEmployeeRecord || repo.events[len(repo.events)-1].Event != EventUpdated {
		t.Error("Add to Employee Record did not change")
	}
	if err := svc.Remove(context.Background(), doc.ID, actor); err != nil {
		t.Fatal(err)
	}
	if len(store.objects) != 0 || repo.events[len(repo.events)-1].Event != EventRemoved {
		t.Errorf("after Remove: %d objects, last event %s", len(store.objects), repo.events[len(repo.events)-1].Event)
	}
	if _, err := svc.Show(context.Background(), doc.ID, actor); !errors.Is(err, ErrNotFound) {
		t.Errorf("Show of a removed document = %v", err)
	}
	if err := svc.Remove(context.Background(), doc.ID, actor); !errors.Is(err, ErrNotFound) {
		t.Errorf("removing twice = %v", err)
	}
}

func TestRetentionAndLegalHold(t *testing.T) {
	svc, repo, store := newTestService(t)
	doc := savedPassport(t, svc)
	emp, actor := doc.EmployeeID, uuid.New()
	ctx := context.Background()

	if _, err := svc.SetEmploymentEnded(ctx, uuid.New(), ptr("2023-01-01"), actor); !errors.Is(err, ErrNotFound) {
		t.Errorf("an employee without a file = %v", err)
	}
	if _, err := svc.SetEmploymentEnded(ctx, emp, ptr("2027-01-01"), actor); !errors.Is(err, ErrInvalid) {
		t.Errorf("an end in the future = %v", err)
	}
	// Ended under three years ago: nothing goes.
	if _, err := svc.SetEmploymentEnded(ctx, emp, ptr("2024-01-01"), actor); err != nil {
		t.Fatal(err)
	}
	if res, err := svc.ShredDue(ctx, 36, quiet); err != nil || res.Files != 0 {
		t.Errorf("before the period = %+v, %v", res, err)
	}
	// Ended over three years ago, but held: nothing goes.
	if _, err := svc.SetEmploymentEnded(ctx, emp, ptr("2023-01-01"), actor); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SetHold(ctx, emp, ptr("2027-06-30"), "", actor); !errors.Is(err, ErrInvalid) {
		t.Errorf("a hold without a reason = %v", err)
	}
	if _, err := svc.SetHold(ctx, emp, ptr("2027-06-30"), "Labour inspectorate check", actor); err != nil {
		t.Fatal(err)
	}
	if res, _ := svc.ShredDue(ctx, 36, quiet); res.Files != 0 {
		t.Errorf("held = %+v", res)
	}
	// The hold cleared: the file goes, with its objects, and only once.
	if _, err := svc.SetHold(ctx, emp, nil, "", actor); err != nil {
		t.Fatal(err)
	}
	res, err := svc.ShredDue(ctx, 36, quiet)
	if err != nil || res.Files != 1 {
		t.Fatalf("due = %+v, %v", res, err)
	}
	if len(store.objects) != 0 || len(repo.documents) != 0 || len(repo.subjects) != 0 {
		t.Errorf("after shredding: %d objects, %d documents, %d subjects", len(store.objects), len(repo.documents), len(repo.subjects))
	}
	if last := repo.events[len(repo.events)-1]; last.Event != EventFileShredded || last.ActorUserID != nil || !strings.Contains(string(last.After), `"documents":1`) {
		t.Errorf("shredded event = %s %v %s", last.Event, last.ActorUserID, last.After)
	}
	if res, _ := svc.ShredDue(ctx, 36, quiet); res.Files != 0 {
		t.Errorf("run again = %+v", res)
	}
	var names []string
	for _, e := range repo.events {
		names = append(names, e.Event)
	}
	want := []string{EventEmploymentEnded, EventEmploymentEnded, EventHoldSet, EventHoldCleared, EventFileShredded}
	if got := strings.Join(names[len(names)-len(want):], ","); got != strings.Join(want, ",") {
		t.Errorf("events = %v", names)
	}
}
