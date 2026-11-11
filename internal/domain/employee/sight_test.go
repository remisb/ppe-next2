package employee

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// The name is everyone's; sizes need Sizes and the rest of the profile Profile.
func TestSightShow(t *testing.T) {
	photo := uuid.New()
	e := Employee{FirstName: "Ona", LastName: "Jonaitė", Code: sp2("E-7"), HeightCm: ip(170), ClothingSize: ip(48), ShoeSize: sp2("39"),
		Notes: "left-handed", PreferredLanguage: sp2("lt"), DefaultPhotoID: &photo, BirthDate: sp2("1990-01-02"), Nationality: sp2("LTU"), Sex: sp2("F")}

	if got := (Sight{Sizes: true, Profile: true}).Show(e); got.Code == nil || got.HeightCm == nil || got.Notes == "" || got.BirthDate == nil {
		t.Errorf("everything = %+v", got)
	}
	names := Sight{}.Show(e)
	if names.FirstName != "Ona" || names.LastName != "Jonaitė" {
		t.Errorf("the name is everyone's: %+v", names)
	}
	if names.HeightCm != nil || names.ClothingSize != nil || names.ShoeSize != nil || names.Code != nil || names.Notes != "" ||
		names.PreferredLanguage != nil || names.DefaultPhotoID != nil || names.BirthDate != nil || names.Nationality != nil || names.Sex != nil {
		t.Errorf("nothing but the name = %+v", names)
	}
	sizes := Sight{Sizes: true}.Show(e)
	if sizes.HeightCm == nil || sizes.ShoeSize == nil || sizes.Code != nil || sizes.Notes != "" {
		t.Errorf("sizes only = %+v", sizes)
	}
	profile := Sight{Profile: true}.Show(e)
	if profile.HeightCm != nil || profile.Code == nil || profile.Notes == "" || profile.DefaultPhotoID == nil {
		t.Errorf("profile only = %+v", profile)
	}
	if e.HeightCm == nil || e.Code == nil {
		t.Error("Show changed the employee it was given")
	}
}

// An employee's Changes leave out what the reader may not see.
func TestSightChanges(t *testing.T) {
	entry := func(event, before, after string) audit.Entry {
		e := audit.Entry{Event: event}
		if before != "" {
			e.Before = json.RawMessage(before)
		}
		if after != "" {
			e.After = json.RawMessage(after)
		}
		return e
	}
	all := []audit.Entry{
		entry(EventCreated, "", `{"height_cm":170,"clothing_size":48,"shoe_size":"39"}`),
		entry(EventUpdated, `{"last_name":"B","code":"E-1"}`, `{"last_name":"Jonaitė","code":"E-7"}`),
		entry(EventUpdated, `{}`, `{"notes_changed":true}`),
		entry(EventSizesChanged, `{"height_cm":170}`, `{"height_cm":172}`),
		entry("employee.photo_added", "", `{"photo_id":"x"}`),
		entry("personnel.document_recorded", "", `{"kind":"passport"}`),
		entry(EventDeleted, "", ""),
	}
	events := func(es []audit.Entry) []string {
		out := make([]string, len(es))
		for i, e := range es {
			out[i] = e.Event
		}
		return out
	}

	if got := (Sight{Sizes: true, Profile: true}).Changes(all); len(got) != len(all) {
		t.Errorf("everything = %v", events(got))
	}
	got := Sight{}.Changes(all)
	if want := []string{EventCreated, EventUpdated, "personnel.document_recorded", EventDeleted}; !slices.Equal(events(got), want) {
		t.Fatalf("names only = %v, want %v", events(got), want)
	}
	if got[0].After != nil {
		t.Errorf("created keeps sizes: %s", got[0].After)
	}
	if string(got[1].Before) != `{"last_name":"B"}` || string(got[1].After) != `{"last_name":"Jonaitė"}` {
		t.Errorf("updated = %s → %s, want the name alone", got[1].Before, got[1].After)
	}
	if got := (Sight{Profile: true}).Changes(all); slices.Contains(events(got), EventSizesChanged) || got[0].After != nil {
		t.Errorf("profile only = %v", events(got))
	}
	if got := (Sight{Sizes: true}).Changes(all); !slices.Contains(events(got), EventSizesChanged) || slices.Contains(events(got), "employee.photo_added") {
		t.Errorf("sizes only = %v", events(got))
	}
}

// Adding and editing need Profile; without Sizes the size defaults are left as they are.
func TestRights(t *testing.T) {
	svc, _ := newTestService()
	ctx := context.Background()
	if _, err := svc.Create(ctx, Params{FirstName: "A", LastName: "B"}, Rights{Sizes: true}, testActor); !errors.Is(err, ErrNotPermitted) {
		t.Errorf("create without Profile: %v, want ErrNotPermitted", err)
	}
	e, err := svc.Create(ctx, Params{FirstName: "A", LastName: "B", HeightCm: ip(180)}, Rights{Profile: true}, testActor)
	if err != nil || e.HeightCm != nil {
		t.Fatalf("create without Sizes = %+v, %v; want no sizes", e, err)
	}
	if _, err := svc.UpdateSizes(ctx, e.ID, SizesParams{HeightCm: ip(176), ShoeSize: sp2("42")}, testActor); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Update(ctx, e.ID, Params{FirstName: "A", LastName: "C"}, Rights{Sizes: true}, testActor); !errors.Is(err, ErrNotPermitted) {
		t.Errorf("update without Profile: %v, want ErrNotPermitted", err)
	}
	got, err := svc.Update(ctx, e.ID, Params{FirstName: "A", LastName: "C"}, Rights{Profile: true}, testActor)
	if err != nil || got.LastName != "C" || got.HeightCm == nil || *got.HeightCm != 176 || got.ShoeSize == nil {
		t.Errorf("update without Sizes = %+v, %v; want the name changed and the sizes kept", got, err)
	}
	got, err = svc.Update(ctx, e.ID, Params{FirstName: "A", LastName: "C"}, everything, testActor)
	if err != nil || got.HeightCm != nil {
		t.Errorf("update with Sizes = %+v, %v; want the sizes cleared", got, err)
	}
}

func TestChangesHideMergedDetails(t *testing.T) {
	merged := audit.Entry{Event: EventMerged,
		Before: json.RawMessage(`{"code":null,"height_cm":160,"first_name":"PALANJIL"}`),
		After:  json.RawMessage(`{"code":"192","height_cm":173,"first_name":"Abhijith","photos":[],"orders":[]}`)}
	got := Sight{}.Changes([]audit.Entry{merged})
	if len(got) != 1 {
		t.Fatalf("got %d entries", len(got))
	}
	for _, k := range []string{"code", "height_cm", "photos"} {
		if strings.Contains(string(got[0].After), `"`+k+`"`) || strings.Contains(string(got[0].Before), `"`+k+`"`) {
			t.Errorf("%s shown without sight: %s / %s", k, got[0].Before, got[0].After)
		}
	}
	if !strings.Contains(string(got[0].After), `"first_name"`) || !strings.Contains(string(got[0].After), `"orders"`) {
		t.Errorf("name or orders hidden: %s", got[0].After)
	}
}
