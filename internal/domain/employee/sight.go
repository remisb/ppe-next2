package employee

import (
	"encoding/json"
	"strings"

	"github.com/remisb/ppe-next2/internal/audit"
)

// Sight is which of an employee's data a reader may see: the size defaults
// with employee_sizes.read, the profile (code, notes, preferred language,
// photos, and the birth date, nationality and sex from an identity document)
// with employee_profiles.read. The name is everyone's: Create Order, Orders
// and search need it. The caller decides it from the reader's permissions.
type Sight struct {
	Sizes   bool
	Profile bool
}

// Show is e as the reader may see it: what they may not see is blank, as if
// never recorded.
func (s Sight) Show(e Employee) Employee {
	if !s.Sizes {
		e.HeightCm, e.ClothingSize, e.ShoeSize = nil, nil, nil
	}
	if !s.Profile {
		e.Code, e.Notes, e.PreferredLanguage, e.DefaultPhotoID = nil, "", nil, nil
		e.BirthDate, e.Nationality, e.Sex = nil, nil, nil
	}
	return e
}

// ShowAll is Show for each of es.
func (s Sight) ShowAll(es []Employee) []Employee {
	out := make([]Employee, len(es))
	for i, e := range es {
		out[i] = s.Show(e)
	}
	return out
}

// profileDetails are employee.updated's keys that are the profile's; the
// name's are everyone's.
var profileDetails = []string{"code", "preferred_language", "notes_changed"}

// sizeDetails are employee.merged's keys that are the size defaults'.
var sizeDetails = []string{"height_cm", "clothing_size", "shoe_size"}

// Changes is an employee's Changes as the reader may see them: without
// Sizes, no size changes and no sizes on employee.created; without Profile,
// no code, language or notes in employee.updated (an event left with nothing
// is left out), and none of the photos' events. employee.merged keeps only
// what the reader may see of the fields it changed, and the moved photos' ids
// only with Profile. Personnel files' events
// (personnel.*) are theirs to decide (ADR 0007) and pass as they are.
func (s Sight) Changes(es []audit.Entry) []audit.Entry {
	out := make([]audit.Entry, 0, len(es))
	for _, e := range es {
		switch {
		case e.Event == EventSizesChanged && !s.Sizes:
			continue
		case e.Event == EventCreated && !s.Sizes:
			e.Before, e.After = nil, nil
		case e.Event == EventUpdated && !s.Profile:
			before, after := withoutKeys(e.Before, profileDetails), withoutKeys(e.After, profileDetails)
			if isEmptyObject(after) {
				continue
			}
			e.Before, e.After = before, after
		case !s.Profile && strings.HasPrefix(e.Event, "employee.photo_"):
			continue
		case e.Event == EventMerged:
			var hidden []string
			if !s.Profile {
				hidden = append(hidden, profileDetails...)
				hidden = append(hidden, "photos")
			}
			if !s.Sizes {
				hidden = append(hidden, sizeDetails...)
			}
			e.Before, e.After = withoutKeys(e.Before, hidden), withoutKeys(e.After, hidden)
		}
		out = append(out, e)
	}
	return out
}

// withoutKeys is the JSON object raw without keys; anything else is returned as it is.
func withoutKeys(raw json.RawMessage, keys []string) json.RawMessage {
	var m map[string]json.RawMessage
	if len(raw) == 0 || json.Unmarshal(raw, &m) != nil || m == nil {
		return raw
	}
	for _, k := range keys {
		delete(m, k)
	}
	b, err := json.Marshal(m)
	if err != nil {
		return raw
	}
	return b
}

// isEmptyObject says whether raw is empty or the JSON object {}.
func isEmptyObject(raw json.RawMessage) bool {
	var m map[string]json.RawMessage
	return len(raw) == 0 || (json.Unmarshal(raw, &m) == nil && len(m) == 0)
}

// Rights is which of an employee's data a writer may change: the size
// defaults with employee_sizes.manage, the profile and name with
// employee_profiles.manage (Add New Employee, Edit Employee, photos).
type Rights struct {
	Sizes   bool
	Profile bool
}
