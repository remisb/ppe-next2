package main

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/remisb/ppe-next2/internal/domain/role"
)

// uploadDocument sends a document as Upload Document… does: the file, and its
// details as JSON in the "document" part.
func (a *testAPI) uploadDocument(t *testing.T, path, token, name string, data []byte, details map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	if details != nil {
		raw, err := json.Marshal(details)
		if err != nil {
			t.Fatal(err)
		}
		if err := mw.WriteField("document", string(raw)); err != nil {
			t.Fatal(err)
		}
	}
	fw, err := mw.CreateFormFile("file", name)
	if err != nil {
		t.Fatal(err)
	}
	fw.Write(data)
	mw.Close()
	req := httptest.NewRequest("POST", path, &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	a.handler.ServeHTTP(rec, req)
	return rec
}

// TestPostgresVaultHTTP: Document Vault phase 1 through the API as ppe_app:
// upload, search by an unaccented name, download, update, a new version,
// removal, and a merge moving the links (docs/specs/vault-service.md).
func TestPostgresVaultHTTP(t *testing.T) {
	api, _ := newPostgresAPI(t)
	_, mgr := api.userWith(t, role.KeyManager)
	_, staff := api.userWith(t, role.KeyEmployee)
	add := func(first, last string) string {
		t.Helper()
		rec := api.do(t, "POST", "/api/v1/employees", mgr, map[string]any{"first_name": first, "last_name": last})
		if rec.Code != http.StatusCreated {
			t.Fatalf("add employee = %d %s", rec.Code, rec.Body)
		}
		return decode[map[string]any](t, rec.Body.Bytes())["id"].(string)
	}
	ana := add("Ana", "Žukauskaitė")
	twin := add("Ana", "Zukauskaite")

	pdf := []byte("%PDF-1.7\n1 0 obj\n%%EOF\n")
	details := map[string]any{"type": "employee.certificate", "title": "Darbas aukštyje", "valid_until": "2028-03-01",
		"links": []map[string]any{{"kind": "employee", "id": twin}}, "note": "scanned"}
	if rec := api.uploadDocument(t, "/api/v1/vault/documents", staff, "c.pdf", pdf, details); rec.Code != http.StatusForbidden {
		t.Errorf("the employee role uploads = %d", rec.Code)
	}
	for name, c := range map[string]struct {
		details map[string]any
		data    []byte
		want    int
	}{
		"no details":   {nil, pdf, http.StatusBadRequest},
		"no employee":  {map[string]any{"type": "employee.certificate", "title": "x"}, pdf, http.StatusBadRequest},
		"a web page":   {details, []byte("<html></html>"), http.StatusUnsupportedMediaType},
		"unknown link": {map[string]any{"type": "other", "title": "x", "links": []map[string]any{{"kind": "employee", "id": "8f1a6c1e-0000-4000-8000-000000000000"}}}, pdf, http.StatusNotFound},
		"extra field":  {map[string]any{"type": "other", "title": "x", "id": "y"}, pdf, http.StatusBadRequest},
	} {
		if rec := api.uploadDocument(t, "/api/v1/vault/documents", mgr, "c.pdf", c.data, c.details); rec.Code != c.want {
			t.Errorf("%s = %d %s, want %d", name, rec.Code, rec.Body, c.want)
		}
	}
	rec := api.uploadDocument(t, "/api/v1/vault/documents", mgr, `C:\scans\aukštis.pdf`, pdf, details)
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload = %d %s", rec.Code, rec.Body)
	}
	doc := decode[map[string]any](t, rec.Body.Bytes())
	id := doc["id"].(string)

	search := func(token, words string) map[string]any {
		t.Helper()
		rec := api.do(t, "POST", "/api/v1/vault/search", token, map[string]any{"query": words})
		if rec.Code != http.StatusOK || rec.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatalf("search = %d %s", rec.Code, rec.Body)
		}
		return decode[map[string]any](t, rec.Body.Bytes())
	}
	if got := search(mgr, "zukausk"); got["total"] != float64(1) {
		t.Errorf("search = %v", got)
	}
	if rec := api.do(t, "POST", "/api/v1/vault/search", staff, map[string]any{"query": "x"}); rec.Code != http.StatusForbidden {
		t.Errorf("the employee role searches = %d", rec.Code)
	}

	rec = api.do(t, "GET", "/api/v1/vault/documents/"+id+"/versions/1/file", mgr, nil)
	if rec.Code != http.StatusOK || !bytes.Equal(rec.Body.Bytes(), pdf) || rec.Header().Get("X-Content-Type-Options") != "nosniff" ||
		!strings.HasPrefix(rec.Header().Get("Content-Disposition"), "attachment") || rec.Header().Get("Content-Type") != "application/pdf" {
		t.Errorf("download = %d %v", rec.Code, rec.Header())
	}

	rec = api.do(t, "PUT", "/api/v1/vault/documents/"+id, mgr, map[string]any{"title": "Darbas aukštyje (2028)", "valid_until": "2028-03-01",
		"links": []map[string]any{{"kind": "employee", "id": twin}}})
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"title":"Darbas aukštyje (2028)"`) {
		t.Errorf("update = %d %s", rec.Code, rec.Body)
	}
	rec = api.uploadDocument(t, "/api/v1/vault/documents/"+id+"/versions", mgr, "v2.pdf", append(pdf, '\n'), map[string]any{"note": "signed"})
	if rec.Code != http.StatusCreated || !strings.Contains(rec.Body.String(), `"number":2`) {
		t.Errorf("add version = %d %s", rec.Code, rec.Body)
	}

	// Merge Employees moves the link to the record kept, named as it is.
	rec = api.do(t, "POST", "/api/v1/employees/"+ana+"/merge/"+twin, mgr, map[string]any{"first_name": "Ana", "last_name": "Žukauskaitė"})
	if rec.Code != http.StatusOK {
		t.Fatalf("merge = %d %s", rec.Code, rec.Body)
	}
	rec = api.do(t, "GET", "/api/v1/vault/by-subject/employee/"+ana, mgr, nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), id) || !strings.Contains(rec.Body.String(), `"label":"Ana Žukauskaitė"`) {
		t.Errorf("by subject after the merge = %d %s", rec.Code, rec.Body)
	}

	if rec := api.do(t, "DELETE", "/api/v1/vault/documents/"+id, mgr, nil); rec.Code != http.StatusNoContent {
		t.Errorf("remove = %d %s", rec.Code, rec.Body)
	}
	if rec := api.do(t, "GET", "/api/v1/vault/documents/"+id, mgr, nil); rec.Code != http.StatusNotFound {
		t.Errorf("after removal = %d", rec.Code)
	}
	rec = api.do(t, "GET", "/api/v1/audit-events?area=vault", api.tokenWith(t, role.AuditRead), nil)
	for _, want := range []string{"vault.document_uploaded", "vault.document_updated", "vault.version_added", "vault.document_removed"} {
		if !strings.Contains(rec.Body.String(), want) {
			t.Errorf("audit log lacks %s: %s", want, rec.Body)
		}
	}
}

// TestPostgresVaultSealedHTTP: an employment contract (ADR 0008 phase 2) is
// the Employment Documents role's alone; its file opens only by POST with a
// recent sign-in, recorded; a Legal Hold stops its removal.
func TestPostgresVaultSealedHTTP(t *testing.T) {
	api, _ := newPostgresAPI(t)
	_, mgr := api.userWith(t, role.KeyManager)
	_, clerk := api.userWith(t, role.KeyEmployment)
	rec := api.do(t, "POST", "/api/v1/employees", mgr, map[string]any{"first_name": "Ana", "last_name": "Žukauskaitė"})
	ana := decode[map[string]any](t, rec.Body.Bytes())["id"].(string)

	pdf := []byte("%PDF-1.7\n1 0 obj\n%%EOF\n")
	details := map[string]any{"type": "employment.contract", "title": "Darbo sutartis Nr. 7", "links": []map[string]any{{"kind": "employee", "id": ana}}}
	if rec := api.uploadDocument(t, "/api/v1/vault/documents", mgr, "c.pdf", pdf, details); rec.Code != http.StatusBadRequest {
		t.Errorf("a manager uploads a contract = %d %s", rec.Code, rec.Body)
	}
	rec = api.uploadDocument(t, "/api/v1/vault/documents", clerk, "sutartis.pdf", pdf, details)
	if rec.Code != http.StatusCreated || !strings.Contains(rec.Body.String(), `"sealed":true`) || !strings.Contains(rec.Body.String(), "Darbo sutartis Nr. 7") {
		t.Fatalf("upload = %d %s", rec.Code, rec.Body)
	}
	id := decode[map[string]any](t, rec.Body.Bytes())["id"].(string)
	if rec := api.do(t, "GET", "/api/v1/vault/documents/"+id, mgr, nil); rec.Code != http.StatusNotFound {
		t.Errorf("a manager reads it = %d", rec.Code)
	}
	if rec := api.do(t, "POST", "/api/v1/vault/search", mgr, map[string]any{"query": "zukausk"}); !strings.Contains(rec.Body.String(), `"total":0`) {
		t.Errorf("a manager finds it: %s", rec.Body)
	}
	if rec := api.do(t, "GET", "/api/v1/vault/documents/"+id+"/versions/1/file", clerk, nil); rec.Code != http.StatusConflict {
		t.Errorf("GET a sealed file = %d", rec.Code)
	}
	rec = api.do(t, "POST", "/api/v1/vault/documents/"+id+"/versions/1/file", clerk, nil)
	if rec.Code != http.StatusOK || !bytes.Equal(rec.Body.Bytes(), pdf) || !strings.Contains(rec.Header().Get("Content-Disposition"), "sutartis.pdf") {
		t.Fatalf("open = %d %v", rec.Code, rec.Header())
	}
	if rec := api.do(t, "PUT", "/api/v1/vault/documents/"+id+"/hold", clerk, map[string]any{"hold_until": "2099-01-01", "hold_reason": "Court case"}); rec.Code != http.StatusOK {
		t.Errorf("hold = %d %s", rec.Code, rec.Body)
	}
	if rec := api.do(t, "DELETE", "/api/v1/vault/documents/"+id, clerk, nil); rec.Code != http.StatusConflict {
		t.Errorf("remove while held = %d", rec.Code)
	}
	rec = api.do(t, "GET", "/api/v1/audit-events/vault/"+id, clerk, nil)
	for _, want := range []string{"vault.document_uploaded", "vault.document_opened", "vault.hold_set"} {
		if !strings.Contains(rec.Body.String(), want) {
			t.Errorf("Changes lack %s", want)
		}
	}
	if strings.Contains(rec.Body.String(), "Darbo sutartis") || strings.Contains(rec.Body.String(), "sutartis.pdf") {
		t.Errorf("Changes hold the sealed title or file name: %s", rec.Body)
	}
}
