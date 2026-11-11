package main

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/role"
)

// TestPostgresEmployeeDuplicatesHTTP runs Duplicates and merging
// (docs/specs/employee-service.md) on the production case: one person entered
// twice, the words in another order and one misspelt. The newer record has an
// order, a SIM card held against a signed form and a default photo, all of
// which move to the older one, kept, as ppe_app.
func TestPostgresEmployeeDuplicatesHTTP(t *testing.T) {
	api, owner := newPostgresAPI(t)
	ctx := context.Background()
	_, staff := api.userWith(t, role.KeyEmployee)
	mgrUser, mgr := api.userWith(t, role.KeyManager)

	add := func(body map[string]any) string {
		t.Helper()
		rec := api.do(t, "POST", "/api/v1/employees", mgr, body)
		if rec.Code != http.StatusCreated {
			t.Fatalf("add = %d %s", rec.Code, rec.Body)
		}
		return decode[map[string]any](t, rec.Body.Bytes())["id"].(string)
	}
	older := add(map[string]any{"first_name": "Abhijith", "last_name": "Palanil Sajeevan", "height_cm": 160, "clothing_size": 52, "shoe_size": "42"})
	newer := add(map[string]any{"first_name": "PALANJIL", "last_name": "SAJEEVAN ABHIJITH", "code": "192", "height_cm": 173, "clothing_size": 52, "shoe_size": "42", "notes": "Night shift"})
	add(map[string]any{"first_name": "Jonas", "last_name": "Petraitis"})

	// Add New Employee asks first: the same words, then the similar ones.
	rec := api.do(t, "POST", "/api/v1/employees/similar", staff, map[string]any{"first_name": "Sajeevan", "last_name": "Abhijith Palanjil"})
	matches := decode[[]map[string]any](t, rec.Body.Bytes())
	if rec.Code != http.StatusOK || len(matches) != 2 || matches[0]["kind"] != "same_name" || matches[1]["kind"] != "similar_name" ||
		matches[0]["employee"].(map[string]any)["id"] != newer {
		t.Fatalf("similar = %d %s", rec.Code, rec.Body)
	}
	// A code in use names its employee.
	rec = api.do(t, "POST", "/api/v1/employees", staff, map[string]any{"first_name": "A", "last_name": "B", "code": "192"})
	if body := decode[map[string]any](t, rec.Body.Bytes()); rec.Code != http.StatusConflict || body["existing_id"] != newer {
		t.Errorf("code taken = %d %s", rec.Code, rec.Body)
	}

	// The Employees screen's pairs.
	if rec := api.do(t, "GET", "/api/v1/employees/possible-duplicates", staff, nil); rec.Code != http.StatusForbidden {
		t.Errorf("pairs without employees.merge = %d", rec.Code)
	}
	rec = api.do(t, "GET", "/api/v1/employees/possible-duplicates", mgr, nil)
	pairs := decode[[]map[string]any](t, rec.Body.Bytes())
	if rec.Code != http.StatusOK || len(pairs) != 1 || pairs[0]["a"].(map[string]any)["id"] != older {
		t.Fatalf("pairs = %d %s", rec.Code, rec.Body)
	}

	// The newer record's order.
	rec = api.do(t, "POST", "/api/v1/catalogue", mgr, map[string]any{"name": "Safety shoes", "icon": "shoes", "active": true,
		"accounting_price_cents": 4999, "service_period_months": 12})
	shoes := decode[map[string]any](t, rec.Body.Bytes())["id"].(string)
	rec = api.do(t, "POST", "/api/v1/orders", mgr, map[string]any{"employee_id": newer,
		"lines": []map[string]any{{"catalogue_item_id": shoes, "quantity": 1, "size": "42"}}})
	if rec.Code != http.StatusCreated {
		t.Fatalf("order = %d %s", rec.Code, rec.Body)
	}
	orderID := decode[map[string]any](t, rec.Body.Bytes())["id"].(string)

	// The newer record's SIM card, given against its form.
	rec = api.do(t, "POST", "/api/v1/assets", mgr, map[string]any{"kind": "SIM", "inventory_no": "SIM-000001", "sim_no": "0089370011",
		"phone_no": "+370 612 40118", "provider": "Telia", "plan": "Biz", "non_return_value_cents": 2500})
	if rec.Code != http.StatusCreated {
		t.Fatalf("add SIM = %d %s", rec.Code, rec.Body)
	}
	simID := decode[map[string]any](t, rec.Body.Bytes())["id"].(string)
	if rec := api.do(t, "PUT", "/api/v1/assets/"+simID+"/status", mgr, map[string]any{"connection_status": "ACTIVE"}); rec.Code != http.StatusOK {
		t.Fatalf("activate = %d %s", rec.Code, rec.Body)
	}
	today := time.Now().Format(time.DateOnly)
	rec = api.do(t, "POST", "/api/v1/assets/"+simID+"/assignments/preview", mgr, map[string]any{"employee_id": newer, "given_date": today})
	formHash := decode[map[string]any](t, rec.Body.Bytes())["document_hash"]
	rec = api.do(t, "POST", "/api/v1/assets/"+simID+"/assignments", mgr, map[string]any{"employee_id": newer, "given_date": today,
		"paper_form_signed": true, "form_hash": formHash})
	if rec.Code != http.StatusCreated {
		t.Fatalf("give = %d %s", rec.Code, rec.Body)
	}
	assignmentID := decode[map[string]any](t, rec.Body.Bytes())["id"].(string)

	// Whose an assignment is never changes outside a merge.
	if _, err := owner.Exec(ctx, `UPDATE asset_assignments SET employee_id = $1 WHERE id = $2`, older, assignmentID); err == nil ||
		!strings.Contains(err.Error(), "giving is never changed") {
		t.Errorf("assignment moved outside a merge: %v", err)
	}

	// A default photo on each.
	photo := func(employee string) uuid.UUID {
		id := uuid.New()
		if _, err := owner.Exec(ctx, `INSERT INTO employee_photos (id, employee_id, object_key, file_name, content_type, size_bytes,
				sha256, is_default, uploaded_at, uploaded_by_user_id)
			VALUES ($1, $2, $3, 'p.jpg', 'image/jpeg', 10, repeat('a', 64), true, now(), $4)`,
			id, employee, "photos/"+id.String(), mgrUser.ID); err != nil {
			t.Fatal(err)
		}
		return id
	}
	olderPhoto, newerPhoto := photo(older), photo(newer)

	// The review.
	path := "/api/v1/employees/" + older + "/merge/" + newer
	rec = api.do(t, "GET", path, mgr, nil)
	preview := decode[map[string]any](t, rec.Body.Bytes())
	contents, _ := preview["contents"].(map[string]any)
	if rec.Code != http.StatusOK || len(contents["orders"].([]any)) != 1 || contents["open_assignments"] != float64(1) ||
		len(contents["photos"].([]any)) != 1 || contents["remove_has_documents"] != false {
		t.Fatalf("preview = %d %s", rec.Code, rec.Body)
	}

	// The removed record has identity documents: refused.
	if _, err := owner.Exec(ctx, `INSERT INTO personnel.subjects (employee_id, created_at, updated_at, updated_by_user_id)
		VALUES ($1, now(), now(), $2)`, newer, mgrUser.ID); err != nil {
		t.Fatal(err)
	}
	chosen := map[string]any{"first_name": "Abhijith", "last_name": "Palanil Sajeevan", "code": "192", "height_cm": 173,
		"clothing_size": 52, "shoe_size": "42", "notes": "Night shift"}
	if rec := api.do(t, "POST", path, mgr, chosen); rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "identity documents") {
		t.Errorf("merge away identity documents = %d %s", rec.Code, rec.Body)
	}
	if _, err := owner.Exec(ctx, `DELETE FROM personnel.subjects WHERE employee_id = $1`, newer); err != nil {
		t.Fatal(err)
	}

	if rec := api.do(t, "POST", path, staff, chosen); rec.Code != http.StatusForbidden {
		t.Errorf("merge without employees.merge = %d", rec.Code)
	}
	rec = api.do(t, "POST", path, mgr, chosen)
	kept := decode[map[string]any](t, rec.Body.Bytes())
	if rec.Code != http.StatusOK || kept["id"] != older || kept["code"] != "192" || kept["height_cm"] != float64(173) ||
		kept["default_photo_id"] != olderPhoto.String() {
		t.Fatalf("merge = %d %s", rec.Code, rec.Body)
	}

	// Everything moved; the signed form and the order's snapshot keep the name they were made with.
	var orderEmployee, assignmentEmployee, photoEmployee, snapshotName, formHashNow string
	var photoDefault bool
	owner.QueryRow(ctx, `SELECT employee_id::text, employee_first_name FROM orders WHERE id = $1`, orderID).Scan(&orderEmployee, &snapshotName)
	owner.QueryRow(ctx, `SELECT employee_id::text, document_hash FROM asset_assignments WHERE id = $1`, assignmentID).Scan(&assignmentEmployee, &formHashNow)
	owner.QueryRow(ctx, `SELECT employee_id::text, is_default FROM employee_photos WHERE id = $1`, newerPhoto).Scan(&photoEmployee, &photoDefault)
	if orderEmployee != older || snapshotName != "PALANJIL" {
		t.Errorf("order = %s %s", orderEmployee, snapshotName)
	}
	if assignmentEmployee != older || formHashNow != formHash {
		t.Errorf("assignment = %s %s, form hash was %v", assignmentEmployee, formHashNow, formHash)
	}
	if photoEmployee != older || photoDefault {
		t.Errorf("photo = %s default %v; the kept record's default stays the default", photoEmployee, photoDefault)
	}
	// The SIM card is held by the kept record, by its name.
	rec = api.do(t, "GET", "/api/v1/assets/"+simID, mgr, nil)
	if !strings.Contains(rec.Body.String(), `"employee_name":"Abhijith Palanil Sajeevan"`) {
		t.Errorf("SIM card = %s", rec.Body)
	}

	// The removed record leads to the kept one; its Changes are the kept one's.
	rec = api.do(t, "GET", "/api/v1/employees/"+newer, staff, nil)
	if body := decode[map[string]any](t, rec.Body.Bytes()); rec.Code != http.StatusNotFound || body["existing_id"] != older {
		t.Errorf("get removed = %d %s", rec.Code, rec.Body)
	}
	rec = api.do(t, "GET", "/api/v1/audit-events/employees/"+older, mgr, nil)
	changes := rec.Body.String()
	for _, want := range []string{`"employee.merged"`, `"employee.merged_away"`, `"entity_id":"` + newer + `"`} {
		if !strings.Contains(changes, want) {
			t.Errorf("Changes lack %s: %s", want, changes)
		}
	}
	if rec := api.do(t, "GET", "/api/v1/audit-events/orders/"+orderID, mgr, nil); !strings.Contains(rec.Body.String(), `"order.employee_merged"`) {
		t.Errorf("order Changes = %s", rec.Body)
	}
	if rec := api.do(t, "GET", "/api/v1/employees/possible-duplicates", mgr, nil); rec.Body.String() != "[]\n" {
		t.Errorf("pairs after the merge = %s", rec.Body)
	}

	// Not the Same Person.
	jonas := add(map[string]any{"first_name": "Jonas", "last_name": "Petraitis"})
	rec = api.do(t, "GET", "/api/v1/employees/possible-duplicates", mgr, nil)
	if len(decode[[]map[string]any](t, rec.Body.Bytes())) != 1 {
		t.Fatalf("pairs = %s", rec.Body)
	}
	other := decode[[]map[string]any](t, rec.Body.Bytes())[0]["a"].(map[string]any)["id"].(string)
	if rec := api.do(t, "POST", "/api/v1/employees/distinct-pairs", mgr, map[string]any{"employee_a": jonas, "employee_b": other}); rec.Code != http.StatusNoContent {
		t.Fatalf("not the same = %d %s", rec.Code, rec.Body)
	}
	if rec := api.do(t, "POST", "/api/v1/employees/distinct-pairs", mgr, map[string]any{"employee_a": other, "employee_b": jonas}); rec.Code != http.StatusNoContent {
		t.Errorf("not the same again = %d %s", rec.Code, rec.Body)
	}
	if rec := api.do(t, "GET", "/api/v1/employees/possible-duplicates", mgr, nil); rec.Body.String() != "[]\n" {
		t.Errorf("pairs after Not the Same Person = %s", rec.Body)
	}
}
