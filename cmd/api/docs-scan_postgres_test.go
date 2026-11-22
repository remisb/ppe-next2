package main

import (
	"bytes"
	"context"
	"net/http"
	"testing"

	"github.com/remisb/ppe-next2/internal/domain/role"
	"github.com/remisb/ppe-next2/internal/personnel/scan"
)

// TestPostgresScanDocumentsHTTP runs Scan Documents' API (docs/specs/personnel-service.md,
// "Match" and "Kept scans") as ppe_app: a scan kept unread, then read in its place; Find
// Employee offering two records of one person, with their pair; Save naming the scan, which
// is then saved and linked; its page; and Remove erasing it with the document.
func TestPostgresScanDocumentsHTTP(t *testing.T) {
	api, owner := newPostgresAPI(t)
	ctx := context.Background()
	_, clerk := api.userWith(t, role.KeyPersonnel)
	_, other := api.userWith(t, role.KeyPersonnel)
	_, mgr := api.userWith(t, role.KeyManager)
	add := func(body map[string]any) string {
		t.Helper()
		rec := api.do(t, "POST", "/api/v1/employees", mgr, body)
		if rec.Code != http.StatusCreated {
			t.Fatalf("add = %d %s", rec.Code, rec.Body)
		}
		return decode[map[string]any](t, rec.Body.Bytes())["id"].(string)
	}
	same := add(map[string]any{"first_name": "Jonas", "last_name": "Pavyzdys", "code": "1042"})
	alike := add(map[string]any{"first_name": "Jonas", "last_name": "Pavyzdis"})
	add(map[string]any{"first_name": "Ona", "last_name": "Bandomoji"})
	page := scanPage(t, 50, 35)

	// Kept before it is read; then read, in its place.
	rec := api.keepScan(t, clerk, map[string]any{"surname": "", "given_names": "", "kind": "passport", "number": ""}, [][]byte{page})
	if rec.Code != http.StatusCreated {
		t.Fatalf("keep unread = %d %s", rec.Code, rec.Body)
	}
	unread := decode[scan.Scan](t, rec.Body.Bytes())
	if unread.State != scan.Unread || unread.FileName[:5] != "Scan_" {
		t.Errorf("unread = %+v", unread)
	}
	meta := map[string]any{"surname": "Pavyzdys", "given_names": "Jonas", "kind": "passport", "number": "91234567",
		"mrz": specimenPassport, "replaces": unread.ID}
	if rec := api.keepScan(t, other, meta, [][]byte{page}); rec.Code != http.StatusNotFound {
		t.Errorf("replacing another user's scan = %d %s", rec.Code, rec.Body)
	}
	rec = api.keepScan(t, clerk, meta, [][]byte{page})
	if rec.Code != http.StatusCreated {
		t.Fatalf("keep read = %d %s", rec.Code, rec.Body)
	}
	read := decode[scan.Scan](t, rec.Body.Bytes())
	if read.State != scan.Read {
		t.Errorf("read = %+v", read)
	}
	rec = api.do(t, "GET", "/api/v1/personnel/scans", clerk, nil)
	if list := decode[[]scan.Scan](t, rec.Body.Bytes()); len(list) != 1 || list[0].ID != read.ID {
		t.Errorf("scans after the replace = %+v", list)
	}

	// A page: the maker's alone, never cached.
	pageURL := "/api/v1/personnel/scans/" + read.ID.String() + "/pages/1"
	rec = api.do(t, "GET", pageURL, clerk, nil)
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "image/jpeg" || rec.Header().Get("Cache-Control") != "no-store" ||
		!bytes.Equal(rec.Body.Bytes(), page) {
		t.Errorf("page = %d %s", rec.Code, rec.Header())
	}
	for path, who := range map[string]string{pageURL: other, "/api/v1/personnel/scans/" + read.ID.String() + "/pages/2": clerk} {
		if rec := api.do(t, "GET", path, who, nil); rec.Code != http.StatusNotFound {
			t.Errorf("%s = %d", path, rec.Code)
		}
	}

	// Find Employee: the same name first, the similar one, the pair; never cached.
	rec = api.do(t, "POST", "/api/v1/personnel/documents/match", clerk, map[string]any{"mrz": specimenPassport, "surname": "Pavyzdys", "given_names": "Jonas"})
	if rec.Code != http.StatusOK || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("match = %d %s", rec.Code, rec.Body)
	}
	m := decode[map[string]any](t, rec.Body.Bytes())
	cands := m["candidates"].([]any)
	if len(cands) != 2 {
		t.Fatalf("candidates = %s", rec.Body)
	}
	first, second := cands[0].(map[string]any), cands[1].(map[string]any)
	if first["employee"].(map[string]any)["id"] != same || first["kind"] != "same_name" || first["employee"].(map[string]any)["code"] != "1042" ||
		second["employee"].(map[string]any)["id"] != alike || second["kind"] != "similar_name" || first["has_documents"] != false {
		t.Errorf("candidates = %s", rec.Body)
	}
	if pairs := m["pairs"].([]any); len(pairs) != 1 {
		t.Errorf("pairs = %s", rec.Body)
	}
	if rec := api.do(t, "POST", "/api/v1/personnel/documents/match", mgr, map[string]any{"mrz": specimenPassport}); rec.Code != http.StatusForbidden {
		t.Errorf("match without personnel.documents.manage = %d", rec.Code)
	}

	// Save naming the scan: saved and linked; another user's scan is refused.
	doc := map[string]any{"employee": map[string]any{"id": same}, "mrz": specimenPassport, "kind": "passport",
		"surname": "Pavyzdys", "given_names": "Jonas", "add_to_employee_record": true, "scan_id": read.ID}
	if rec := api.saveDocument(t, other, doc, map[string][]byte{"copy_page": specimenJPEG(t)}); rec.Code != http.StatusNotFound {
		t.Errorf("save naming another user's scan = %d %s", rec.Code, rec.Body)
	}
	rec = api.saveDocument(t, clerk, doc, map[string][]byte{"copy_page": specimenJPEG(t)})
	if rec.Code != http.StatusCreated {
		t.Fatalf("save = %d %s", rec.Code, rec.Body)
	}
	docID := decode[map[string]any](t, rec.Body.Bytes())["id"].(string)
	rec = api.do(t, "GET", "/api/v1/personnel/scans", clerk, nil)
	if list := decode[[]scan.Scan](t, rec.Body.Bytes()); len(list) != 1 || list[0].State != scan.Saved ||
		list[0].DocumentID == nil || list[0].DocumentID.String() != docID || list[0].EmployeeID.String() != same {
		t.Errorf("scans after Save = %+v", list)
	}
	rec = api.do(t, "POST", "/api/v1/personnel/documents/match", clerk, map[string]any{"mrz": specimenPassport})
	cands = decode[map[string]any](t, rec.Body.Bytes())["candidates"].([]any)
	if c := cands[0].(map[string]any); c["kind"] != "personal_code" || c["employee"].(map[string]any)["id"] != same || c["has_documents"] != true {
		t.Errorf("match after Save = %s", rec.Body)
	}

	// Removing the document erases the scan.
	if rec := api.do(t, "DELETE", "/api/v1/personnel/documents/"+docID, clerk, nil); rec.Code != http.StatusNoContent {
		t.Fatalf("remove = %d %s", rec.Code, rec.Body)
	}
	var n int
	if err := owner.QueryRow(ctx, `SELECT count(*) FROM personnel.scans WHERE id = $1`, read.ID).Scan(&n); err != nil || n != 0 {
		t.Errorf("scans after Remove = %d, %v", n, err)
	}
}
