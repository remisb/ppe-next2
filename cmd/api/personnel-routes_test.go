package main

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/jpeg"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/domain/role"
	"github.com/remisb/ppe-next2/internal/domain/session"
	"github.com/remisb/ppe-next2/internal/domain/user"
	"github.com/remisb/ppe-next2/internal/personnel/document"
)

// stubDocuments is Personnel files with nothing on file, for the route policy.
type stubDocuments struct{}

func (stubDocuments) DocumentByNumber(context.Context, []byte, string) (document.Ref, bool, error) {
	return document.Ref{}, false, nil
}
func (stubDocuments) SubjectByPersonalCode(context.Context, []byte) (uuid.UUID, bool, error) {
	return uuid.Nil, false, nil
}
func (stubDocuments) Subject(context.Context, uuid.UUID) (document.Subject, bool, error) {
	return document.Subject{}, false, nil
}
func (stubDocuments) PossibleDuplicates(context.Context, string, string, *string) ([]uuid.UUID, error) {
	return []uuid.UUID{}, nil
}
func (stubDocuments) Save(context.Context, document.SaveRecord) error { return nil }
func (stubDocuments) Documents(context.Context, uuid.UUID) ([]document.Document, error) {
	return []document.Document{}, nil
}
func (stubDocuments) Document(context.Context, uuid.UUID) (document.Opened, error) {
	return document.Opened{}, document.ErrNotFound
}
func (stubDocuments) Record(context.Context, []audit.Event) error { return nil }
func (stubDocuments) UpdateDocument(context.Context, uuid.UUID, func(document.Document) (document.DocumentChange, []audit.Event, error)) error {
	return document.ErrNotFound
}
func (stubDocuments) UpdateSubject(context.Context, uuid.UUID, func(document.Retention) (document.Retention, []audit.Event, error)) error {
	return document.ErrNotFound
}
func (stubDocuments) Retention(context.Context, uuid.UUID) (document.Retention, bool, error) {
	return document.Retention{}, false, nil
}
func (stubDocuments) Due(context.Context, string, int) ([]uuid.UUID, error) { return nil, nil }
func (stubDocuments) Shred(context.Context, uuid.UUID, func(int) []audit.Event) ([]string, error) {
	return nil, nil
}

// tokenAs is a token for u carrying only perms, as tokenWith is for the administrator.
func (a *testAPI) tokenAs(t *testing.T, u user.User, perms ...role.Permission) string {
	t.Helper()
	s, _, err := a.svc.sessions.Start(context.Background(), session.StartParams{UserID: u.ID, KeepSignedIn: true})
	if err != nil {
		t.Fatal(err)
	}
	tok, _, err := a.tokens.issue(u, perms, s.ID, s.AuthenticatedAt)
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

const (
	testPersonnelKey      = "1111111111111111111111111111111111111111111111111111111111111111"
	testPersonnelIndexKey = "2222222222222222222222222222222222222222222222222222222222222222"
)

func testPersonnelKeys(t *testing.T) document.Keys {
	t.Helper()
	keys, err := personnelKeys(config{PersonnelKey: testPersonnelKey, PersonnelKeyID: 1, PersonnelIndexKey: testPersonnelIndexKey})
	if err != nil {
		t.Fatal(err)
	}
	return keys
}

func TestPersonnelKeyErrors(t *testing.T) {
	ok := config{JWTSecret: strings.Repeat("s", 32), SIMCodesKey: strings.Repeat("ab", 32), PersonnelKeyID: 1, PersonnelRetentionMonths: 36,
		PersonnelScanDays: 3}
	if errs := ok.personnelKeyErrors(); len(errs) != 0 {
		t.Errorf("no personnel keys (off) = %v", errs)
	}
	on := ok
	on.PersonnelKey, on.PersonnelIndexKey = testPersonnelKey, testPersonnelIndexKey
	if errs := on.personnelKeyErrors(); len(errs) != 0 {
		t.Errorf("both keys = %v", errs)
	}
	for name, change := range map[string]func(c *config){
		"master alone":          func(c *config) { c.PersonnelIndexKey = "" },
		"index alone":           func(c *config) { c.PersonnelKey = "" },
		"index is the master":   func(c *config) { c.PersonnelIndexKey = c.PersonnelKey },
		"the SIM codes key":     func(c *config) { c.PersonnelKey = c.SIMCodesKey },
		"a short key":           func(c *config) { c.PersonnelKey = "abcd" },
		"id 0":                  func(c *config) { c.PersonnelKeyID = 0 },
		"previous is current":   func(c *config) { c.PersonnelPreviousKeys = "2:" + testPersonnelKey },
		"previous has the id":   func(c *config) { c.PersonnelPreviousKeys = "1:" + strings.Repeat("cd", 32) },
		"previous is malformed": func(c *config) { c.PersonnelPreviousKeys = "x" },
		"retention of 6 months": func(c *config) { c.PersonnelRetentionMonths = 6 },
		"scans kept 0 days":     func(c *config) { c.PersonnelScanDays = 0 },
		"scans kept 15 days":    func(c *config) { c.PersonnelScanDays = 15 },
	} {
		c := on
		change(&c)
		if errs := c.personnelKeyErrors(); len(errs) == 0 {
			t.Errorf("%s: no error", name)
		}
	}
	keys := testPersonnelKeys(t)
	if keys.Master == nil || len(keys.Index) != 32 {
		t.Errorf("keys = %+v", keys)
	}
	if off, err := personnelKeys(ok); err != nil || off.Master != nil {
		t.Errorf("no keys = %+v, %v", off, err)
	}
}

// The specimen passport of testdata/mrz/vectors.json: a made-up Lithuanian
// passport holder, Jonas Pavyzdys, personal code 33309240064.
var specimenPassport = []string{
	"P<LTUPAVYZDYS<<JONAS<<<<<<<<<<<<<<<<<<<<<<<<",
	"91234567<9LTU3309243M310515733309240064<<<42",
}

func specimenJPEG(t *testing.T) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := jpeg.Encode(&b, image.NewRGBA(image.Rect(0, 0, 60, 40)), nil); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// saveDocument sends Save as docs-import does: the "document" part and the copies.
func (a *testAPI) saveDocument(t *testing.T, token string, doc map[string]any, copies map[string][]byte) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	js, _ := json.Marshal(doc)
	if err := mw.WriteField("document", string(js)); err != nil {
		t.Fatal(err)
	}
	for name, data := range copies {
		fw, err := mw.CreateFormFile(name, name+".jpg")
		if err != nil {
			t.Fatal(err)
		}
		fw.Write(data)
	}
	mw.Close()
	req := httptest.NewRequest("POST", "/api/v1/personnel/documents", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	a.handler.ServeHTTP(rec, req)
	return rec
}

// Check, Save, the summary and the validity line through the real
// repositories, as docs-import and the employee page use them.
func TestPostgresPersonnelDocumentsHTTP(t *testing.T) {
	api, _ := newPostgresAPI(t)
	_, clerk := api.userWith(t, role.KeyPersonnel)
	_, staff := api.userWith(t, role.KeyEmployee)
	jpg := specimenJPEG(t)

	rec := api.do(t, "POST", "/api/v1/personnel/documents/check", clerk,
		map[string]any{"mrz": specimenPassport, "surname": "Pavyzdys", "given_names": "Jonas"})
	if rec.Code != http.StatusOK || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("check = %d %s", rec.Code, rec.Body)
	}
	if c := decode[map[string]any](t, rec.Body.Bytes()); c["valid"] != true || c["document_on_file"] != nil || c["name_match"] != "same" {
		t.Errorf("check = %v", c)
	}

	doc := map[string]any{
		"employee": map[string]any{"new": map[string]any{"first_name": "Jonas", "last_name": "Pavyzdys"}},
		"mrz":      specimenPassport, "kind": "passport", "surname": "Pavyzdys", "given_names": "Jonas",
		"issued_on": "2021-05-16", "place_of_birth": "Vilnius", "add_to_employee_record": true, "take": []string{"birth_date", "sex"},
	}
	rec = api.saveDocument(t, clerk, doc, map[string][]byte{"copy_page": jpg})
	if rec.Code != http.StatusCreated {
		t.Fatalf("save = %d %s", rec.Code, rec.Body)
	}
	saved := decode[map[string]any](t, rec.Body.Bytes())
	empID := saved["employee_id"].(string)
	for _, v := range []string{"91234567", "33309240064", "Vilnius"} {
		if strings.Contains(rec.Body.String(), v) {
			t.Errorf("Save's answer holds %s: %s", v, rec.Body)
		}
	}

	// The employee was created, with the birth date and sex taken.
	rec = api.do(t, "GET", "/api/v1/employees/"+empID, staff, nil)
	if e := decode[map[string]any](t, rec.Body.Bytes()); e["last_name"] != "Pavyzdys" || e["birth_date"] != "1933-09-24" || e["sex"] != "M" || e["nationality"] != nil {
		t.Errorf("employee = %v", e)
	}

	// The same document again: 409, naming it, never its number.
	doc["employee"] = map[string]any{"id": empID}
	rec = api.saveDocument(t, clerk, doc, nil)
	body := decode[map[string]any](t, rec.Body.Bytes())
	if rec.Code != http.StatusConflict || body["conflict"] != "document_on_file" || body["existing_id"] != saved["id"] || strings.Contains(rec.Body.String(), "91234567") {
		t.Errorf("same document = %d %s", rec.Code, rec.Body)
	}

	// A misread check digit: 400 with the problems as codes.
	broken := map[string]any{"employee": map[string]any{"id": empID}, "mrz": []string{specimenPassport[0], strings.Replace(specimenPassport[1], "3309243", "3309253", 1)},
		"kind": "passport", "surname": "Pavyzdys"}
	rec = api.saveDocument(t, clerk, broken, nil)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), `"code":"check_digit"`) || strings.Contains(rec.Body.String(), "330925") {
		t.Errorf("broken MRZ = %d %s", rec.Code, rec.Body)
	}
	// A PNG copy is refused for its type.
	rec = api.saveDocument(t, clerk, broken, map[string][]byte{"copy_page": []byte("\x89PNG\r\n\x1a\n")})
	if rec.Code != http.StatusBadRequest && rec.Code != http.StatusUnsupportedMediaType {
		t.Errorf("PNG copy = %d %s", rec.Code, rec.Body)
	}
	// An unknown part is refused before anything is read.
	rec = api.saveDocument(t, clerk, doc, map[string][]byte{"selfie": jpg})
	if rec.Code != http.StatusBadRequest {
		t.Errorf("unknown part = %d %s", rec.Code, rec.Body)
	}

	// The summary for Personnel Documents; the validity line for anyone.
	rec = api.do(t, "GET", "/api/v1/personnel/documents/by-employee/"+empID, clerk, nil)
	docs := decode[[]map[string]any](t, rec.Body.Bytes())
	if rec.Code != http.StatusOK || len(docs) != 1 || docs[0]["issued_on"] != "2021-05-16" || docs[0]["on_employee_record"] != true {
		t.Errorf("summary = %d %s", rec.Code, rec.Body)
	}
	if rec := api.do(t, "GET", "/api/v1/personnel/documents/by-employee/"+empID, staff, nil); rec.Code != http.StatusForbidden {
		t.Errorf("summary for the employee role = %d", rec.Code)
	}
	rec = api.do(t, "GET", "/api/v1/personnel/documents/by-employee/"+empID+"/validity", staff, nil)
	v := decode[[]map[string]any](t, rec.Body.Bytes())
	if rec.Code != http.StatusOK || len(v) != 1 || v[0]["kind"] != "passport" || v[0]["expires_on"] != "2031-05-15" || len(v[0]) != 3 {
		t.Errorf("validity = %d %s", rec.Code, rec.Body)
	}
}

// Without its keys Personnel files answers 503 and keeps nothing.
func TestPersonnelOffWithoutKeys(t *testing.T) {
	api := newTestAPI(t)
	_, clerk := api.userWith(t, role.KeyPersonnel)
	rec := api.do(t, "POST", "/api/v1/personnel/documents/check", clerk, map[string]any{"mrz": specimenPassport})
	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("check without keys = %d %s", rec.Code, rec.Body)
	}
}

// Show Document, a copy, the record switch, retention, Legal Hold and Remove,
// through the real repositories.
func TestPostgresPersonnelFileHTTP(t *testing.T) {
	api, _ := newPostgresAPI(t)
	_, clerk := api.userWith(t, role.KeyPersonnel)
	_, admin := api.userWith(t, role.KeyAdmin)
	doc := map[string]any{
		"employee": map[string]any{"new": map[string]any{"first_name": "Jonas", "last_name": "Pavyzdys"}},
		"mrz":      specimenPassport, "kind": "passport", "surname": "Pavyzdys", "given_names": "Jonas",
		"place_of_birth": "Vilnius", "add_to_employee_record": false,
	}
	rec := api.saveDocument(t, clerk, doc, map[string][]byte{"copy_page": specimenJPEG(t)})
	if rec.Code != http.StatusCreated {
		t.Fatalf("save = %d %s", rec.Code, rec.Body)
	}
	saved := decode[map[string]any](t, rec.Body.Bytes())
	id, emp := saved["id"].(string), saved["employee_id"].(string)

	// Show Document: the sealed fields, never cached; an administrator without the role may not.
	rec = api.do(t, "POST", "/api/v1/personnel/documents/"+id+"/show", clerk, map[string]any{})
	shown := decode[map[string]any](t, rec.Body.Bytes())
	fields, _ := shown["fields"].(map[string]any)
	if rec.Code != http.StatusOK || rec.Header().Get("Cache-Control") != "no-store" || fields["number"] != "91234567" ||
		fields["personal_code"] != "33309240064" || fields["place_of_birth"] != "Vilnius" {
		t.Errorf("show = %d %s", rec.Code, rec.Body)
	}
	if rec := api.do(t, "POST", "/api/v1/personnel/documents/"+id+"/show", admin, map[string]any{}); rec.Code != http.StatusForbidden {
		t.Errorf("show by an administrator = %d", rec.Code)
	}
	rec = api.do(t, "POST", "/api/v1/personnel/documents/"+id+"/copies/page/show", clerk, map[string]any{})
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "image/jpeg" || !bytes.HasPrefix(rec.Body.Bytes(), []byte{0xff, 0xd8}) {
		t.Errorf("show copy = %d %s", rec.Code, rec.Header())
	}
	if rec := api.do(t, "POST", "/api/v1/personnel/documents/"+id+"/copies/front/show", clerk, map[string]any{}); rec.Code != http.StatusNotFound {
		t.Errorf("a side it has not = %d", rec.Code)
	}

	if rec := api.do(t, "PUT", "/api/v1/personnel/documents/"+id+"/employee-record", clerk, map[string]any{"on": true}); rec.Code != http.StatusNoContent {
		t.Errorf("employee record = %d %s", rec.Code, rec.Body)
	}
	if rec := api.do(t, "PUT", "/api/v1/personnel/documents/"+id+"/employee-record", clerk, map[string]any{}); rec.Code != http.StatusBadRequest {
		t.Errorf("employee record without on = %d", rec.Code)
	}
	rec = api.do(t, "PUT", "/api/v1/personnel/subjects/"+emp+"/employment-ended", clerk, map[string]any{"on": "2026-10-31"})
	if r := decode[map[string]any](t, rec.Body.Bytes()); rec.Code != http.StatusOK || r["employment_ended_on"] != "2026-10-31" {
		t.Errorf("employment ended = %d %s", rec.Code, rec.Body)
	}
	rec = api.do(t, "PUT", "/api/v1/personnel/subjects/"+emp+"/hold", clerk, map[string]any{"until": "2099-01-01", "reason": "A dispute"})
	if rec.Code != http.StatusOK {
		t.Errorf("hold = %d %s", rec.Code, rec.Body)
	}
	if rec := api.do(t, "PUT", "/api/v1/personnel/subjects/"+emp+"/hold", clerk, map[string]any{"until": "2099-01-01"}); rec.Code != http.StatusBadRequest {
		t.Errorf("hold without a reason = %d", rec.Code)
	}
	rec = api.do(t, "GET", "/api/v1/personnel/subjects/"+emp, clerk, nil)
	if r := decode[map[string]any](t, rec.Body.Bytes()); rec.Code != http.StatusOK || r["hold_until"] != "2099-01-01" || r["hold_reason"] != "A dispute" {
		t.Errorf("retention = %d %s", rec.Code, rec.Body)
	}
	if rec := api.do(t, "GET", "/api/v1/personnel/subjects/"+uuid.NewString(), clerk, nil); rec.Code != http.StatusNotFound {
		t.Errorf("an employee without a file = %d", rec.Code)
	}

	if rec := api.do(t, "DELETE", "/api/v1/personnel/documents/"+id, clerk, nil); rec.Code != http.StatusNoContent {
		t.Errorf("remove = %d %s", rec.Code, rec.Body)
	}
	if rec := api.do(t, "POST", "/api/v1/personnel/documents/"+id+"/show", clerk, map[string]any{}); rec.Code != http.StatusNotFound {
		t.Errorf("show after remove = %d", rec.Code)
	}
	// The trail: every action, none of it holding a value read from the document.
	rec = api.do(t, "GET", "/api/v1/audit-events/employees/"+emp, clerk, nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "personnel.document_shown") ||
		!strings.Contains(rec.Body.String(), "personnel.hold_set") {
		t.Errorf("the employee's Changes = %d %.300s", rec.Code, rec.Body)
	}
	for _, v := range []string{"91234567", "33309240064", "Vilnius"} {
		if strings.Contains(rec.Body.String(), v) {
			t.Errorf("the employee's Changes hold %s", v)
		}
	}
}
