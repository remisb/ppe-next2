package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/role"
	"github.com/remisb/ppe-next2/internal/outbox"
	"github.com/remisb/ppe-next2/internal/recordpdf"
	vaultdoc "github.com/remisb/ppe-next2/internal/vault/document"
	"github.com/remisb/ppe-next2/internal/vault/docx"
	"github.com/remisb/ppe-next2/internal/vault/docx/docxtest"
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

// TestPostgresDocumentTemplatesHTTP: Administration writes and publishes a
// contract template (ADR 0008 phase 3); a user with Employment Documents
// previews it for an employee and generates the contract, numbered, sealed,
// its file the PDF; a stale preview is refused, and a published version
// never changes.
func TestPostgresDocumentTemplatesHTTP(t *testing.T) {
	api, owner := newPostgresAPI(t)
	admin := api.tokenWith(t, role.DocumentTemplatesManage)
	_, mgr := api.userWith(t, role.KeyManager)
	_, clerk := api.userWith(t, role.KeyEmployment)
	rec := api.do(t, "POST", "/api/v1/employees", mgr, map[string]any{"first_name": "Ana", "last_name": "Žukauskaitė"})
	ana := decode[map[string]any](t, rec.Body.Bytes())["id"].(string)

	rec = api.do(t, "POST", "/api/v1/document-templates", admin, map[string]any{"type": "employment.contract", "name": "Darbo sutartis", "language": "lt"})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create = %d %s", rec.Code, rec.Body)
	}
	id := decode[map[string]any](t, rec.Body.Bytes())["id"].(string)
	body := map[string]any{"format": "ppe.blocks.v1", "blocks": []map[string]any{
		{"type": "heading", "level": 1, "text": []map[string]any{{"text": "Darbo sutartis Nr. "}, {"field": "document.number"}}},
		{"type": "paragraph", "text": []map[string]any{{"field": "employee.name", "bold": true}, {"text": ", alga "}, {"field": "input.salary"}}},
		{"type": "signatures", "signatures": []map[string]any{{"label": []map[string]any{{"text": "Darbdavys"}}}, {"label": []map[string]any{{"text": "Darbuotojas"}}}}},
	}}
	asked := []map[string]any{{"key": "salary", "label": "Alga", "kind": "money", "required": true}}
	if rec := api.do(t, "PUT", "/api/v1/document-templates/"+id+"/draft", admin, map[string]any{"body": map[string]any{"format": "ppe.blocks.v1", "blocks": []map[string]any{{"type": "paragraph", "html": "<b>x</b>"}}}}); rec.Code != http.StatusBadRequest {
		t.Errorf("HTML in a block = %d", rec.Code)
	}
	if rec := api.do(t, "PUT", "/api/v1/document-templates/"+id+"/draft", admin, map[string]any{"body": body, "asked": asked}); rec.Code != http.StatusOK {
		t.Fatalf("save draft = %d %s", rec.Code, rec.Body)
	}
	rec = api.do(t, "POST", "/api/v1/document-templates/preview", admin, map[string]any{"body": body, "asked": asked, "language": "lt", "name": "Darbo sutartis"})
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"pdf":"JVBERi0`) {
		t.Fatalf("editor preview = %d %.200s", rec.Code, rec.Body)
	}
	if rec := api.do(t, "GET", "/api/v1/vault/templates", clerk, nil); strings.TrimSpace(rec.Body.String()) != "[]" {
		t.Errorf("a draft offered to Generate: %s", rec.Body)
	}
	if rec := api.do(t, "POST", "/api/v1/document-templates/"+id+"/publish", admin, nil); rec.Code != http.StatusOK {
		t.Fatalf("publish = %d %s", rec.Code, rec.Body)
	}
	if rec := api.do(t, "GET", "/api/v1/vault/templates", mgr, nil); strings.TrimSpace(rec.Body.String()) != "[]" {
		t.Errorf("a manager is offered a contract template: %s", rec.Body)
	}
	if rec := api.do(t, "GET", "/api/v1/vault/templates", clerk, nil); !strings.Contains(rec.Body.String(), `"name":"Darbo sutartis"`) {
		t.Fatalf("templates = %s", rec.Body)
	}

	req := map[string]any{"template_id": id, "employee_id": ana, "inputs": map[string]any{"salary": "2400"}}
	rec = api.do(t, "POST", "/api/v1/vault/generate/preview", clerk, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("preview = %d %s", rec.Code, rec.Body)
	}
	hash := decode[map[string]any](t, rec.Body.Bytes())["values_hash"].(string)
	stale := map[string]any{"template_id": id, "employee_id": ana, "inputs": map[string]any{"salary": "2500"}, "values_hash": hash}
	if rec := api.do(t, "POST", "/api/v1/vault/generate", clerk, stale); rec.Code != http.StatusConflict {
		t.Errorf("stale = %d %s", rec.Code, rec.Body)
	}
	req["values_hash"] = hash
	rec = api.do(t, "POST", "/api/v1/vault/generate", clerk, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("generate = %d %s", rec.Code, rec.Body)
	}
	doc := decode[map[string]any](t, rec.Body.Bytes())
	year := time.Now().UTC().Format("2006")
	if doc["number"] != "EC-"+year+"-0001" || doc["sealed"] != true || doc["origin"] != "generated" || doc["title"] != "Darbo sutartis EC-"+year+"-0001" {
		t.Fatalf("document = %v", doc)
	}
	rec = api.do(t, "POST", "/api/v1/vault/documents/"+doc["id"].(string)+"/versions/1/file", clerk, nil)
	if rec.Code != http.StatusOK || !bytes.HasPrefix(rec.Body.Bytes(), []byte("%PDF-")) {
		t.Errorf("open = %d", rec.Code)
	}
	// Found by the employee's name; the salary is in no event.
	if rec := api.do(t, "POST", "/api/v1/vault/search", clerk, map[string]any{"query": "zukausk"}); !strings.Contains(rec.Body.String(), `"total":1`) {
		t.Errorf("search = %s", rec.Body)
	}
	var leaked int
	if err := owner.QueryRow(context.Background(), `SELECT count(*) FROM audit_events WHERE after::text LIKE '%2400%' OR before::text LIKE '%2400%'`).Scan(&leaked); err != nil || leaked != 0 {
		t.Errorf("the salary is in %d events (%v)", leaked, err)
	}
	if _, err := owner.Exec(context.Background(), `UPDATE vault.template_versions SET body_sha256 = body_sha256 WHERE state = 'published'`); err == nil {
		t.Error("a published version changed")
	}
}

// TestPostgresVaultReadTextHTTP: an upload's reading job (phase 4), Read
// Again, and System's Worker card through the API as ppe_app.
func TestPostgresVaultReadTextHTTP(t *testing.T) {
	api, _ := newPostgresAPI(t)
	_, mgr := api.userWith(t, role.KeyManager)
	rec := api.do(t, "POST", "/api/v1/employees", mgr, map[string]any{"first_name": "Ana", "last_name": "Žukauskaitė"})
	ana := decode[map[string]any](t, rec.Body.Bytes())["id"].(string)
	rec = api.uploadDocument(t, "/api/v1/vault/documents", mgr, "c.pdf", []byte("%PDF-1.7\n1 0 obj\n%%EOF\n"),
		map[string]any{"type": "employee.certificate", "title": "Darbas aukštyje", "links": []map[string]any{{"kind": "employee", "id": ana}}})
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload = %d %s", rec.Code, rec.Body)
	}
	doc := decode[map[string]any](t, rec.Body.Bytes())
	id := doc["id"].(string)
	v := doc["versions"].([]any)[0].(map[string]any)
	if v["text_state"] != "pending" || v["text_method"] != nil {
		t.Fatalf("version = %v", v)
	}

	admin := api.tokenWith(t, role.SystemRead)
	rec = api.do(t, "GET", "/api/v1/system/worker", admin, nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"kind":"vault.extract_text","pending":1`) {
		t.Fatalf("worker = %d %s", rec.Code, rec.Body)
	}
	if rec := api.do(t, "GET", "/api/v1/system/worker", mgr, nil); rec.Code != http.StatusForbidden {
		t.Errorf("a manager reads the worker = %d", rec.Code)
	}
	// Waiting already: Read Again changes nothing, and is no second job.
	if rec := api.do(t, "POST", "/api/v1/vault/documents/"+id+"/versions/1/read-again", mgr, nil); rec.Code != http.StatusAccepted {
		t.Fatalf("read again = %d %s", rec.Code, rec.Body)
	}
	if rec := api.do(t, "POST", "/api/v1/vault/documents/"+id+"/versions/2/read-again", mgr, nil); rec.Code != http.StatusNotFound {
		t.Errorf("no version 2 = %d", rec.Code)
	}
	rec = api.do(t, "GET", "/api/v1/system/worker", admin, nil)
	if !strings.Contains(rec.Body.String(), `"pending":1`) || strings.Contains(rec.Body.String(), `"pending":2`) {
		t.Fatalf("worker after read again = %s", rec.Body)
	}
}

// TestPostgresSignedCopiesMove: migration 0065's vault.move_signed_copies, as
// -vault-backfill -commit runs it for copies the previous release wrote: each
// assignment's copies become one asset.signed_form document, each copy a
// version and file with its own id, key, hash and uploader, linked, read text
// pending and queued; a second run moves nothing, and Company Assets reads and
// opens them through the vault.
func TestPostgresSignedCopiesMove(t *testing.T) {
	api, owner := newPostgresAPI(t)
	ctx := context.Background()
	_, mgr := api.userWith(t, role.KeyManager)
	rec := api.do(t, "POST", "/api/v1/employees", mgr, map[string]any{"first_name": "Jonas", "last_name": "Petraitis"})
	empID := decode[map[string]any](t, rec.Body.Bytes())["id"].(string)
	rec = api.do(t, "POST", "/api/v1/assets", mgr, map[string]any{"kind": "SIM", "inventory_no": "SIM-000001", "sim_no": "0089370011",
		"phone_no": "+370 612 40118", "provider": "Telia", "plan": "Biz 10 GB", "non_return_value_cents": 2500, "connection_status": "ACTIVE"})
	assetID := decode[map[string]any](t, rec.Body.Bytes())["id"].(string)
	rec = api.do(t, "POST", "/api/v1/assets/"+assetID+"/assignments/preview", mgr, map[string]any{"employee_id": empID, "given_date": "2026-10-09"})
	rec = api.do(t, "POST", "/api/v1/assets/"+assetID+"/assignments", mgr, map[string]any{"employee_id": empID, "given_date": "2026-10-09",
		"paper_form_signed": true, "form_hash": decode[map[string]any](t, rec.Body.Bytes())["document_hash"]})
	if rec.Code != http.StatusCreated {
		t.Fatalf("give = %d %s", rec.Code, rec.Body)
	}
	assignment := decode[map[string]any](t, rec.Body.Bytes())["id"].(string)

	// Two copies as the previous release kept them, written by the owner
	// (ppe_app may no longer insert them), their files in the store.
	type legacy struct{ id, key, sha string }
	var copies []legacy
	for i, body := range []string{"%PDF-1.7 first\n%%EOF\n", "%PDF-1.7 second\n%%EOF\n"} {
		c := legacy{id: uuid.NewString(), sha: sha256Hex([]byte(body))}
		c.key = "signed-copies/" + assignment + "/" + c.id + ".pdf"
		if err := api.files.Put(ctx, c.key, strings.NewReader(body), int64(len(body)), "application/pdf"); err != nil {
			t.Fatal(err)
		}
		if _, err := owner.Exec(ctx, `INSERT INTO asset_signed_copies (id, assignment_id, object_key, file_name, content_type,
			size_bytes, sha256, uploaded_at, uploaded_by_user_id) VALUES ($1, $2, $3, $4, 'application/pdf', $5, $6, $7, $8)`,
			c.id, assignment, c.key, fmt.Sprintf("scan %d.pdf", i+1), len(body), c.sha,
			time.Date(2026, 10, 10+i, 9, 0, 0, 0, time.UTC), api.admin.ID); err != nil {
			t.Fatal(err)
		}
		copies = append(copies, c)
	}
	var out bytes.Buffer
	if err := vaultBackfill(ctx, owner, api.files, false, &out); err != nil || !strings.Contains(out.String(), "2 signed copies are not in the vault yet") {
		t.Fatalf("check = %v\n%s", err, out.String())
	}
	if err := vaultBackfill(ctx, owner, api.files, true, &out); err != nil || !strings.Contains(out.String(), "2 signed copies moved") ||
		!strings.Contains(out.String(), "2 signed form files checked") {
		t.Fatalf("commit = %v\n%s", err, out.String())
	}

	var title, requires, versions, files, labels, texts string
	var jobs int
	if err := owner.QueryRow(ctx, `SELECT d.title, array_to_string(d.requires, ','),
		(SELECT string_agg(v.number || ':' || v.origin || ':' || v.id || ':' || v.document_hash, ',' ORDER BY v.number) FROM vault.versions v WHERE v.document_id = d.id),
		(SELECT string_agg(f.id || ':' || f.object_key || ':' || f.file_name, ',' ORDER BY f.created_at) FROM vault.files f
		 JOIN vault.versions v ON v.id = f.version_id WHERE v.document_id = d.id),
		(SELECT string_agg(l.subject_kind || ':' || l.label || ':' || l.locked, ',' ORDER BY l.subject_kind) FROM vault.links l WHERE l.document_id = d.id),
		(SELECT string_agg(t.state, ',') FROM vault.version_text t JOIN vault.versions v ON v.id = t.version_id WHERE v.document_id = d.id),
		(SELECT count(*) FROM outbox.jobs j WHERE j.kind = 'vault.extract_text' AND j.state = 'pending')
		FROM vault.documents d WHERE d.source_kind = 'asset_signed_form' AND d.source_id = $1`, assignment).Scan(
		&title, &requires, &versions, &files, &labels, &texts, &jobs); err != nil {
		t.Fatal(err)
	}
	wantVersions := "1:original:" + copies[0].id + ":" + copies[0].sha + ",2:added:" + copies[1].id + ":" + copies[1].sha
	wantFiles := copies[0].id + ":" + copies[0].key + ":scan 1.pdf," + copies[1].id + ":" + copies[1].key + ":scan 2.pdf"
	if title != "SIM-000001 · 2026-10-09" || requires != "sim_cards.read,vault.read" || versions != wantVersions || files != wantFiles ||
		labels != "asset:SIM-000001 +370 612 40118:true,employee:Jonas Petraitis:true" || texts != "pending,pending" || jobs != 2 {
		t.Errorf("moved: title %q, requires %s\nversions %s\nfiles %s\nlinks %s, texts %s, %d jobs", title, requires, versions, files, labels, texts, jobs)
	}
	if err := vaultBackfill(ctx, owner, api.files, true, &out); err != nil || !strings.Contains(out.String(), "every signed copy is in the vault") {
		t.Errorf("again = %v\n%s", err, out.String())
	}

	// Company Assets reads them through the vault, and the next upload is version 3.
	rec = api.do(t, "GET", "/api/v1/assets/"+assetID, mgr, nil)
	got := decode[map[string]any](t, rec.Body.Bytes())["assignments"].([]any)[0].(map[string]any)["signed_copies"].([]any)
	if len(got) != 2 || got[0].(map[string]any)["id"] != copies[1].id || got[1].(map[string]any)["uploaded_by_name"] != "Admin" {
		t.Errorf("copies = %v", got)
	}
	rec = api.do(t, "GET", "/api/v1/assets/"+assetID+"/assignments/"+assignment+"/signed-copies/"+copies[0].id, mgr, nil)
	if rec.Code != http.StatusOK || rec.Body.String() != "%PDF-1.7 first\n%%EOF\n" {
		t.Errorf("download = %d %q", rec.Code, rec.Body)
	}
	if rec := api.upload(t, "/api/v1/assets/"+assetID+"/assignments/"+assignment+"/signed-copies", mgr, "third.pdf", []byte("%PDF-1.7 third")); rec.Code != http.StatusCreated {
		t.Fatalf("upload = %d %s", rec.Code, rec.Body)
	}
	var n int
	if err := owner.QueryRow(ctx, `SELECT max(v.number) FROM vault.versions v JOIN vault.documents d ON d.id = v.document_id
		WHERE d.source_id = $1`, assignment).Scan(&n); err != nil || n != 3 {
		t.Errorf("newest version = %d, %v", n, err)
	}

	// A copy whose stored file changed is reported.
	if err := api.files.Put(ctx, copies[0].key, strings.NewReader("%PDF-1.7 other"), 14, "application/pdf"); err != nil {
		t.Fatal(err)
	}
	if err := vaultBackfill(ctx, owner, api.files, false, &out); err == nil || !strings.Contains(err.Error(), copies[0].id) {
		t.Errorf("a changed file = %v", err)
	}
}

func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// TestPostgresArchiveHTTP: Give with a form and a paper confirmation each
// queue their record's archiving after commit; the worker's handler keeps the
// assignment form and the Items Given Record as archived documents, as
// ppe_app, once (a second run and the sweep add nothing), linked and named as
// their sources are; Verify finds them matching their domains' snapshots, and
// the record downloads as the same PDF.
func TestPostgresArchiveHTTP(t *testing.T) {
	api, owner := newPostgresAPI(t)
	ctx := context.Background()
	_, mgr := api.userWith(t, role.KeyManager)
	_, staff := api.userWith(t, role.KeyEmployee)
	rec := api.do(t, "POST", "/api/v1/employees", mgr, map[string]any{"first_name": "Ona", "last_name": "Kazlauskienė"})
	emp := decode[map[string]any](t, rec.Body.Bytes())["id"].(string)

	// Give a SIM card against its printed form.
	today := time.Now().UTC().Format(time.DateOnly)
	rec = api.do(t, "POST", "/api/v1/assets", mgr, map[string]any{"kind": "SIM", "inventory_no": "SIM-000001", "sim_no": "0089370011",
		"phone_no": "+370 612 40118", "provider": "Telia", "plan": "Biz 10 GB", "non_return_value_cents": 2500, "connection_status": "ACTIVE"})
	sim := decode[map[string]any](t, rec.Body.Bytes())["id"].(string)
	rec = api.do(t, "POST", "/api/v1/assets/"+sim+"/assignments/preview", mgr, map[string]any{"employee_id": emp, "given_date": today})
	formHash := decode[map[string]any](t, rec.Body.Bytes())["document_hash"].(string)
	rec = api.do(t, "POST", "/api/v1/assets/"+sim+"/assignments", mgr, map[string]any{"employee_id": emp, "given_date": today,
		"paper_form_signed": true, "form_hash": formHash})
	if rec.Code != http.StatusCreated {
		t.Fatalf("give = %d %s", rec.Code, rec.Body)
	}
	assignment := decode[map[string]any](t, rec.Body.Bytes())["id"].(string)

	// Give an order on paper.
	rec = api.do(t, "POST", "/api/v1/catalogue", mgr, map[string]any{"name": "Gloves", "icon": "other", "accounting_price_cents": 250, "service_period_months": 1, "active": true})
	gloves := decode[map[string]any](t, rec.Body.Bytes())["id"].(string)
	rec = api.do(t, "POST", "/api/v1/orders", staff, map[string]any{"employee_id": emp, "lines": []map[string]any{{"catalogue_item_id": gloves, "quantity": 2}}})
	orderID := decode[map[string]any](t, rec.Body.Bytes())["id"].(string)
	// Its record downloads as a PDF while ORDERED too; only a given one is archived.
	if rec := api.do(t, "GET", "/api/v1/orders/"+orderID+"/record.pdf", staff, nil); rec.Code != http.StatusOK || !bytes.HasPrefix(rec.Body.Bytes(), []byte("%PDF-")) {
		t.Fatalf("ordered record.pdf = %d", rec.Code)
	}
	rec = api.do(t, "POST", "/api/v1/orders/"+orderID+"/confirm-paper", staff, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("confirm = %d %s", rec.Code, rec.Body)
	}
	given := decode[map[string]any](t, rec.Body.Bytes())
	recordHash := given["document_hash"].(string)
	number := given["receipt"].(map[string]any)["record_number"].(string)

	// Each queued one job, keyed by its source.
	jobs := func() map[string]string {
		rows, err := owner.Query(ctx, `SELECT key, state FROM outbox.jobs WHERE kind = 'vault.archive'`)
		if err != nil {
			t.Fatal(err)
		}
		out := map[string]string{}
		for rows.Next() {
			var k, s string
			if err := rows.Scan(&k, &s); err != nil {
				t.Fatal(err)
			}
			out[k] = s
		}
		return out
	}
	formKey, recordKey := "asset_assignment:"+assignment, "order:"+orderID
	if got := jobs(); len(got) != 2 || got[formKey] != "pending" || got[recordKey] != "pending" {
		t.Fatalf("jobs = %v", got)
	}

	// The worker's handler, as the worker runs it (as ppe_app).
	handler := archiveHandler(api.svc.vault)
	for _, key := range []string{formKey, recordKey} {
		source, id, _ := strings.Cut(key, ":")
		payload, _ := json.Marshal(map[string]any{"source": source, "id": id})
		for range 2 {
			if err := handler(ctx, outboxJob(payload)); err != nil {
				t.Fatalf("archive %s: %v", key, err)
			}
		}
	}
	var docs, versions, events int
	if err := owner.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM vault.documents WHERE origin = 'archived'),
		(SELECT count(*) FROM vault.versions WHERE origin = 'archived'),
		(SELECT count(*) FROM audit_events WHERE event = 'vault.document_archived' AND actor_user_id IS NULL)`).Scan(&docs, &versions, &events); err != nil {
		t.Fatal(err)
	}
	if docs != 2 || versions != 2 || events != 2 {
		t.Fatalf("%d archived documents, %d versions, %d events; want 2 of each", docs, versions, events)
	}

	// A manager sees both, linked and named as their sources; the form needs sim_cards.read too.
	find := func(token, kind, id string) []map[string]any {
		rec := api.do(t, "GET", "/api/v1/vault/by-subject/"+kind+"/"+id, token, nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("by subject = %d %s", rec.Code, rec.Body)
		}
		return decode[[]map[string]any](t, rec.Body.Bytes())
	}
	byEmployee := find(mgr, "employee", emp)
	if len(byEmployee) != 2 {
		t.Fatalf("the employee's documents = %v", byEmployee)
	}
	var formDoc, recordDoc string
	for _, d := range byEmployee {
		switch d["type"] {
		case "asset.assignment_form":
			formDoc = d["id"].(string)
			if d["title"] != "SIM-000001 · "+today {
				t.Errorf("form = %v", d)
			}
		case "order.record":
			recordDoc = d["id"].(string)
			if d["number"] != number || !strings.HasPrefix(d["title"].(string), number+" · ") {
				t.Errorf("record = %v", d)
			}
		}
	}
	if formDoc == "" || recordDoc == "" {
		t.Fatalf("documents = %v", byEmployee)
	}
	if got := find(mgr, "order", orderID); len(got) != 1 || got[0]["id"] != recordDoc {
		t.Errorf("the order's documents = %v", got)
	}
	if got := find(mgr, "asset", sim); len(got) != 1 || got[0]["id"] != formDoc {
		t.Errorf("the SIM card's documents = %v", got)
	}
	rec = api.do(t, "GET", "/api/v1/vault/documents/"+formDoc, mgr, nil)
	d := decode[map[string]any](t, rec.Body.Bytes())
	v := d["versions"].([]any)[0].(map[string]any)
	if d["origin"] != "archived" || d["locked"] != true || v["origin"] != "archived" || v["document_hash"] != formHash || v["text_state"] != "pending" {
		t.Errorf("form document = %v", d)
	}
	for _, l := range d["links"].([]any) {
		if l.(map[string]any)["locked"] != true {
			t.Errorf("link not locked: %v", l)
		}
	}
	// No one changes them here.
	if rec := api.do(t, "DELETE", "/api/v1/vault/documents/"+formDoc, mgr, nil); rec.Code == http.StatusNoContent || rec.Code == http.StatusOK {
		t.Errorf("remove an archived form = %d", rec.Code)
	}

	// Verify: both match their domains' snapshots; their files are intact.
	for doc, want := range map[string]string{formDoc: formHash, recordDoc: recordHash} {
		rec := api.do(t, "GET", "/api/v1/vault/documents/"+doc+"/verify", mgr, nil)
		got := decode[map[string]any](t, rec.Body.Bytes())
		if rec.Code != http.StatusOK || got["matches"] != true || got["file_intact"] != true || got["source_hash"] != want || got["document_hash"] != want {
			t.Errorf("verify %s = %d %v", doc, rec.Code, got)
		}
	}
	// The archived record is the PDF the record draws as now (in the vault's
	// zone here, UTC; the route draws in the organisation's, as the worker
	// does in production).
	rec = api.do(t, "GET", "/api/v1/vault/documents/"+recordDoc+"/versions/1/file", mgr, nil)
	archived := rec.Body.Bytes()
	r, err := api.svc.orders.Record(ctx, uuid.MustParse(orderID))
	if err != nil {
		t.Fatal(err)
	}
	if again, err := recordpdf.Render(r, time.UTC); err != nil || !bytes.Equal(again, archived) {
		t.Errorf("the record drawn again differs from the archived one (%v)", err)
	}
	rec = api.do(t, "GET", "/api/v1/orders/"+orderID+"/record.pdf", staff, nil)
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Disposition") != "attachment; filename=items-given-record-"+number+".pdf" ||
		!bytes.HasPrefix(rec.Body.Bytes(), []byte("%PDF-")) {
		t.Errorf("record.pdf = %d %v", rec.Code, rec.Header())
	}
	// An uploaded document has nothing to verify against.
	rec = api.uploadDocument(t, "/api/v1/vault/documents", mgr, "c.pdf", []byte("%PDF-1.7\n1 0 obj\n%%EOF\n"),
		map[string]any{"type": "employee.certificate", "title": "Darbas aukštyje", "links": []map[string]any{{"kind": "employee", "id": emp}}})
	up := decode[map[string]any](t, rec.Body.Bytes())["id"].(string)
	if rec := api.do(t, "GET", "/api/v1/vault/documents/"+up+"/verify", mgr, nil); rec.Code != http.StatusBadRequest {
		t.Errorf("verify an upload = %d", rec.Code)
	}

	// The sweep and the backfill find nothing left; with nothing archived
	// they would find both.
	sw, err := sweepArchives(ctx, api.svc, time.Time{}, true)
	if err != nil || sw.Forms != 0 || sw.Records != 0 {
		t.Errorf("sweep = %+v, %v", sw, err)
	}
	var out bytes.Buffer
	if err := archiveBackfill(ctx, api.svc, false, &out); err != nil || !strings.Contains(out.String(), "every stored assignment form and given order is archived") {
		t.Errorf("backfill = %q, %v", out.String(), err)
	}
}

// TestPostgresArchiveSweep: records whose archiving was never queued (given
// before phase 6) are found by the backfill, queued with -commit once, and
// only once.
func TestPostgresArchiveSweep(t *testing.T) {
	api, owner := newPostgresAPI(t)
	ctx := context.Background()
	_, mgr := api.userWith(t, role.KeyManager)
	rec := api.do(t, "POST", "/api/v1/employees", mgr, map[string]any{"first_name": "Ona", "last_name": "K"})
	emp := decode[map[string]any](t, rec.Body.Bytes())["id"].(string)
	rec = api.do(t, "POST", "/api/v1/catalogue", mgr, map[string]any{"name": "Gloves", "icon": "other", "accounting_price_cents": 250, "service_period_months": 1, "active": true})
	gloves := decode[map[string]any](t, rec.Body.Bytes())["id"].(string)
	for range 2 {
		rec = api.do(t, "POST", "/api/v1/orders", mgr, map[string]any{"employee_id": emp, "lines": []map[string]any{{"catalogue_item_id": gloves, "quantity": 1}}})
		id := decode[map[string]any](t, rec.Body.Bytes())["id"].(string)
		if rec := api.do(t, "POST", "/api/v1/orders/"+id+"/confirm-paper", mgr, nil); rec.Code != http.StatusOK {
			t.Fatalf("confirm = %d", rec.Code)
		}
	}
	// As if given before this release: no job was queued.
	if _, err := owner.Exec(ctx, `DELETE FROM outbox.jobs`); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	if err := archiveBackfill(ctx, api.svc, false, &out); err != nil || !strings.Contains(out.String(), "0 assignment forms and 2 Items Given Records are not archived yet") {
		t.Fatalf("backfill = %q, %v", out.String(), err)
	}
	count := func() (n int) {
		if err := owner.QueryRow(ctx, `SELECT count(*) FROM outbox.jobs WHERE kind = 'vault.archive' AND state = 'pending'`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if n := count(); n != 0 {
		t.Fatalf("%d jobs queued without -commit", n)
	}
	out.Reset()
	if err := archiveBackfill(ctx, api.svc, true, &out); err != nil || !strings.Contains(out.String(), "2 Items Given Records queued") {
		t.Fatalf("backfill -commit = %q, %v", out.String(), err)
	}
	if _, err := sweepArchives(ctx, api.svc, time.Time{}, true); err != nil {
		t.Fatal(err)
	}
	if n := count(); n != 2 {
		t.Errorf("%d jobs after a second sweep, want 2", n)
	}
}

// outboxJob is an archiving job as the worker claims it, on its first attempt.
func outboxJob(payload []byte) outbox.Job {
	return outbox.Job{ID: uuid.New(), Kind: vaultdoc.KindArchive, Payload: payload, State: "running", Attempts: 1, MaxAttempts: 5}
}

// TestPostgresVaultIdentityHTTP: a search for an employee's name lists their
// identity documents from Personnel files beside the vault's own, metadata
// only: the current one's kind, state and expiry for a manager, the issue
// date too for Personnel Documents; never a number, name or personal code.
func TestPostgresVaultIdentityHTTP(t *testing.T) {
	api, _ := newPostgresAPI(t)
	_, clerk := api.userWith(t, role.KeyPersonnel)
	_, mgr := api.userWith(t, role.KeyManager)
	_, both := api.userWith(t, role.KeyManager, role.KeyPersonnel)
	rec := api.saveDocument(t, clerk, map[string]any{
		"employee": map[string]any{"new": map[string]any{"first_name": "Jonas", "last_name": "Pavyzdys"}},
		"mrz":      specimenPassport, "kind": "passport", "surname": "Pavyzdys", "given_names": "Jonas", "issued_on": "2021-05-16",
	}, map[string][]byte{"copy_page": specimenJPEG(t)})
	if rec.Code != http.StatusCreated {
		t.Fatalf("save = %d %s", rec.Code, rec.Body)
	}
	emp := decode[map[string]any](t, rec.Body.Bytes())["employee_id"].(string)
	rec = api.uploadDocument(t, "/api/v1/vault/documents", mgr, "c.pdf", []byte("%PDF-1.7\n1 0 obj\n%%EOF\n"),
		map[string]any{"type": "employee.certificate", "title": "Darbas aukštyje", "links": []map[string]any{{"kind": "employee", "id": emp}}})
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload = %d %s", rec.Code, rec.Body)
	}

	type identity struct {
		EmployeeID   string  `json:"employee_id"`
		Holder       string  `json:"holder"`
		Kind         string  `json:"kind"`
		IssuingState string  `json:"issuing_state"`
		IssuedOn     *string `json:"issued_on"`
		ExpiresOn    string  `json:"expires_on"`
	}
	search := func(token string, body map[string]any) []identity {
		t.Helper()
		rec := api.do(t, "POST", "/api/v1/vault/search", token, body)
		if rec.Code != http.StatusOK {
			t.Fatalf("search = %d %s", rec.Code, rec.Body)
		}
		for _, v := range []string{"91234567", "33309240064"} {
			if strings.Contains(rec.Body.String(), v) {
				t.Errorf("the search answers %s", v)
			}
		}
		return decode[struct {
			Identity []identity `json:"identity"`
		}](t, rec.Body.Bytes()).Identity
	}
	got := search(mgr, map[string]any{"query": "pavyz"})
	if len(got) != 1 || got[0].EmployeeID != emp || got[0].Holder != "Jonas Pavyzdys" || got[0].Kind != "passport" ||
		got[0].IssuingState != "LTU" || got[0].ExpiresOn != "2031-05-15" || got[0].IssuedOn != nil {
		t.Fatalf("a manager's = %+v", got)
	}
	got = search(both, map[string]any{"subject": map[string]any{"kind": "employee", "id": emp}})
	if len(got) != 1 || got[0].IssuedOn == nil || *got[0].IssuedOn != "2021-05-16" {
		t.Errorf("in full = %+v", got)
	}
	if got := search(mgr, map[string]any{"query": "aukst"}); len(got) != 0 {
		t.Errorf("words naming no employee = %+v", got)
	}
}

// pdfOfWords stands in for LibreOffice: a "PDF" of the DOCX's words.
type pdfOfWords struct{}

func (pdfOfWords) Convert(_ context.Context, data []byte) ([]byte, error) {
	text, err := docx.Text(data, func(k string) string { return "{{" + k + "}}" })
	return []byte("%PDF-1.7\n" + text), err
}

// uploadDocx sends Upload DOCX Template: the file and the asked fields.
func (a *testAPI) uploadDocx(t *testing.T, id, token string, data []byte, asked any) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	js, _ := json.Marshal(asked)
	mw.WriteField("asked", string(js))
	fw, _ := mw.CreateFormFile("file", "Darbo sutartis.docx")
	fw.Write(data)
	mw.Close()
	req := httptest.NewRequest("POST", "/api/v1/document-templates/"+id+"/draft/docx", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	a.handler.ServeHTTP(rec, req)
	return rec
}

// TestPostgresDocxTemplateHTTP: a DOCX template uploaded, published and used
// as ppe_app: the preview and the document are renders the worker's handler
// converts, polled until their PDF; the document is made once, sealed, with
// its PDF and the filled DOCX, numbered, and the hash printed in it.
func TestPostgresDocxTemplateHTTP(t *testing.T) {
	api, owner := newPostgresAPI(t)
	ctx := context.Background()
	admin := api.tokenWith(t, role.DocumentTemplatesManage)
	_, mgr := api.userWith(t, role.KeyManager)
	_, clerk := api.userWith(t, role.KeyEmployment)
	_, other := api.userWith(t, role.KeyEmployment)
	rec := api.do(t, "POST", "/api/v1/employees", mgr, map[string]any{"first_name": "Ana", "last_name": "Žukauskaitė"})
	ana := decode[map[string]any](t, rec.Body.Bytes())["id"].(string)
	rec = api.do(t, "POST", "/api/v1/document-templates", admin, map[string]any{"type": "employment.contract", "name": "Darbo sutartis", "language": "lt"})
	id := decode[map[string]any](t, rec.Body.Bytes())["id"].(string)
	asked := []map[string]any{{"key": "salary", "label": "Alga", "kind": "money", "required": true}}

	if rec := api.uploadDocx(t, id, admin, []byte("%PDF-1.7"), asked); rec.Code != http.StatusUnsupportedMediaType {
		t.Errorf("a PDF = %d %s", rec.Code, rec.Body)
	}
	file := docxtest.Build([]string{"Darbo sutartis Nr. {{document.number}}", "{{employee.name}}, alga {{input.salary}}"}, "SHA-256 {{document.hash}}")
	rec = api.uploadDocx(t, id, admin, file, asked)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"kind":"docx"`) {
		t.Fatalf("upload = %d %s", rec.Code, rec.Body)
	}
	if rec := api.do(t, "GET", "/api/v1/document-templates/"+id+"/versions/1/docx", admin, nil); rec.Code != http.StatusOK || !bytes.Equal(rec.Body.Bytes(), file) {
		t.Errorf("download = %d", rec.Code)
	}
	if rec := api.do(t, "POST", "/api/v1/document-templates/"+id+"/publish", admin, nil); rec.Code != http.StatusOK {
		t.Fatalf("publish = %d %s", rec.Code, rec.Body)
	}

	// The worker's handler, as it would run the job.
	vaultdoc.WithConverter(pdfOfWords{})(api.svc.vault)
	convert := func(render string) {
		t.Helper()
		payload, _ := json.Marshal(map[string]any{"render": render})
		job := outbox.Job{ID: uuid.New(), Kind: vaultdoc.KindRenderDocx, Payload: payload, Attempts: 1, MaxAttempts: 5}
		if err := renderHandler(api.svc.vault)(ctx, job); err != nil {
			t.Fatalf("render %s: %v", render, err)
		}
	}
	req := map[string]any{"template_id": id, "employee_id": ana, "inputs": map[string]any{"salary": "2400"}}
	rec = api.do(t, "POST", "/api/v1/vault/generate/preview", clerk, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("preview = %d %s", rec.Code, rec.Body)
	}
	started := decode[map[string]any](t, rec.Body.Bytes())
	render, hash := started["render_id"].(string), started["values_hash"].(string)
	if rec := api.do(t, "GET", "/api/v1/vault/renders/"+render, clerk, nil); rec.Code != http.StatusAccepted {
		t.Errorf("pending = %d %s", rec.Code, rec.Body)
	}
	var jobs int
	if err := owner.QueryRow(ctx, `SELECT count(*) FROM outbox.jobs WHERE kind = 'vault.render_docx' AND key = $1`, render).Scan(&jobs); err != nil || jobs != 1 {
		t.Errorf("%d jobs, %v", jobs, err)
	}
	convert(render)
	if rec := api.do(t, "GET", "/api/v1/vault/renders/"+render, other, nil); rec.Code != http.StatusNotFound {
		t.Errorf("another's render = %d", rec.Code)
	}
	rec = api.do(t, "GET", "/api/v1/vault/renders/"+render, clerk, nil)
	got := decode[map[string]any](t, rec.Body.Bytes())
	pdf, _ := base64.StdEncoding.DecodeString(got["pdf"].(string))
	if rec.Code != http.StatusOK || got["values_hash"] != hash || !bytes.Contains(pdf, []byte("Nr. PREVIEW")) {
		t.Fatalf("preview's PDF = %d %q", rec.Code, pdf)
	}

	req["values_hash"] = hash
	rec = api.do(t, "POST", "/api/v1/vault/generate", clerk, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("generate = %d %s", rec.Code, rec.Body)
	}
	render = decode[map[string]any](t, rec.Body.Bytes())["render_id"].(string)
	convert(render)
	rec = api.do(t, "GET", "/api/v1/vault/renders/"+render, clerk, nil)
	if rec.Code != http.StatusCreated {
		t.Fatalf("made = %d %s", rec.Code, rec.Body)
	}
	doc := decode[map[string]any](t, rec.Body.Bytes())["document"].(map[string]any)
	year := time.Now().UTC().Format("2006")
	if doc["number"] != "EC-"+year+"-0001" || doc["sealed"] != true || doc["origin"] != "generated" {
		t.Fatalf("document = %v", doc)
	}
	if rec := api.do(t, "GET", "/api/v1/vault/renders/"+render, clerk, nil); rec.Code != http.StatusCreated ||
		decode[map[string]any](t, rec.Body.Bytes())["document"].(map[string]any)["id"] != doc["id"] {
		t.Errorf("asked again = %d %s", rec.Code, rec.Body)
	}
	v := doc["versions"].([]any)[0].(map[string]any)
	rec = api.do(t, "POST", "/api/v1/vault/documents/"+doc["id"].(string)+"/versions/1/file", clerk, nil)
	if rec.Code != http.StatusOK || !bytes.Contains(rec.Body.Bytes(), []byte("Darbo sutartis Nr. EC-"+year+"-0001")) ||
		!bytes.Contains(rec.Body.Bytes(), []byte("SHA-256 "+v["document_hash"].(string))) {
		t.Errorf("open = %d %q", rec.Code, rec.Body)
	}
	var files, docs int
	if err := owner.QueryRow(ctx, `SELECT (SELECT count(*) FROM vault.files f JOIN vault.versions v ON v.id = f.version_id
		WHERE v.document_id = $1 AND f.sealed AND ((f.role = 'main' AND f.content_type = 'application/pdf') OR (f.role = 'source' AND f.content_type = $2))),
		(SELECT count(*) FROM vault.documents)`, doc["id"], docx.ContentType).Scan(&files, &docs); err != nil || files != 2 || docs != 1 {
		t.Errorf("%d sealed files (want PDF and DOCX), %d documents, %v", files, docs, err)
	}
}
