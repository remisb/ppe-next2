package main

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/domain/catalogue"
	"github.com/remisb/ppe-next2/internal/domain/dashboard"
	"github.com/remisb/ppe-next2/internal/domain/employee"
	"github.com/remisb/ppe-next2/internal/domain/itemset"
	"github.com/remisb/ppe-next2/internal/domain/order"
	"github.com/remisb/ppe-next2/internal/domain/user"
)

// newPostgresAPI wires the real repositories against API_TEST_DB_DSN, skipping
// when it is unset. Tables are emptied first.
func newPostgresAPI(t *testing.T) (*testAPI, *pgxpool.Pool) {
	t.Helper()
	dsn := os.Getenv("API_TEST_DB_DSN")
	if dsn == "" {
		t.Skip("API_TEST_DB_DSN not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if _, err := pool.Exec(ctx, `TRUNCATE users CASCADE`); err != nil {
		t.Fatal(err)
	}
	fastHash := user.WithHasher(func(p string) (string, error) { return "h:" + p, nil }, func(h, p string) bool { return h == "h:"+p })
	svc := newServices(
		time.UTC, time.Hour,
		user.NewService(user.NewPostgresRepository(pool), fastHash),
		employee.NewPostgresRepository(pool),
		catalogue.NewPostgresRepository(pool),
		itemset.NewPostgresRepository(pool),
		order.NewPostgresRepository(pool),
		dashboard.NewPostgresRepository(pool),
	)
	admin, err := svc.users.Bootstrap(ctx, "admin@example.com", "Admin", "password123")
	if err != nil {
		t.Fatal(err)
	}
	tok := testTokens(time.Now())
	return &testAPI{handler: routes(testConfig(), svc, tok, testLogger), svc: svc, tokens: tok, admin: admin}, pool
}

func decode[T any](t *testing.T, body []byte) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(body, &v); err != nil {
		t.Fatalf("decode %s: %v", body, err)
	}
	return v
}

func TestPostgresEmployeeHTTPFlow(t *testing.T) {
	api, pool := newPostgresAPI(t)
	_, staff := api.userWith(t, user.RoleEmployee)
	_, mgr := api.userWith(t, user.RoleManager)

	// Add New Employee needs first and last name only.
	rec := api.do(t, "POST", "/api/v1/employees", staff, map[string]any{"first_name": "Jonas", "last_name": "Petraitis"})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create = %d %s", rec.Code, rec.Body)
	}
	e := decode[map[string]any](t, rec.Body.Bytes())
	id := e["id"].(string)
	if e["full_name"] != "Jonas Petraitis" || e["clothing_size"] != nil {
		t.Errorf("created = %v", e)
	}

	// Client-owned fields only: id and derived fields are rejected.
	if rec := api.do(t, "POST", "/api/v1/employees", staff, map[string]any{"first_name": "A", "last_name": "B", "full_name": "x"}); rec.Code != http.StatusBadRequest {
		t.Errorf("derived field accepted: %d", rec.Code)
	}

	// Save as Employee Default.
	rec = api.do(t, "PUT", "/api/v1/employees/"+id+"/sizes", staff, map[string]any{"height_cm": 180, "clothing_size": "l", "shoe_size": "43"})
	if rec.Code != http.StatusOK {
		t.Fatalf("sizes = %d %s", rec.Code, rec.Body)
	}
	if got := decode[map[string]any](t, rec.Body.Bytes()); got["clothing_size"] != "L" {
		t.Errorf("sizes = %v", got)
	}
	if rec := api.do(t, "PUT", "/api/v1/employees/"+id+"/sizes", staff, map[string]any{"shoe_size": "38"}); rec.Code != http.StatusBadRequest {
		t.Errorf("bad shoe size = %d", rec.Code)
	}

	// Search is a filter: a miss is 200 [].
	rec = api.do(t, "GET", "/api/v1/employees/by-name/petr", staff, nil)
	if got := decode[[]map[string]any](t, rec.Body.Bytes()); rec.Code != http.StatusOK || len(got) != 1 {
		t.Errorf("search = %d %s", rec.Code, rec.Body)
	}
	rec = api.do(t, "GET", "/api/v1/employees/by-name/nobody", staff, nil)
	if rec.Code != http.StatusOK || rec.Body.String() != "[]\n" {
		t.Errorf("empty search = %d %q", rec.Code, rec.Body)
	}

	var events int
	pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_events WHERE entity_id = $1`, id).Scan(&events)
	if events != 2 { // created + sizes_changed
		t.Errorf("audit events = %d, want 2", events)
	}

	if rec := api.do(t, "DELETE", "/api/v1/employees/"+id, mgr, nil); rec.Code != http.StatusNoContent {
		t.Errorf("delete = %d", rec.Code)
	}
	if rec := api.do(t, "GET", "/api/v1/employees/"+id, staff, nil); rec.Code != http.StatusNotFound {
		t.Errorf("get deleted = %d", rec.Code)
	}
}

func TestPostgresCatalogueHTTPFlow(t *testing.T) {
	api, _ := newPostgresAPI(t)
	_, staff := api.userWith(t, user.RoleEmployee)
	_, mgr := api.userWith(t, user.RoleManager)

	item := map[string]any{"name": "Safety shoes", "size_group": "SHOES", "unit_price_cents": 4999, "service_period_months": 12, "active": true, "display_rank": 1}
	if rec := api.do(t, "POST", "/api/v1/catalogue", staff, item); rec.Code != http.StatusForbidden {
		t.Errorf("employee create = %d, want 403", rec.Code)
	}
	rec := api.do(t, "POST", "/api/v1/catalogue", mgr, item)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create = %d %s", rec.Code, rec.Body)
	}
	id := decode[map[string]any](t, rec.Body.Bytes())["id"].(string)

	if rec := api.do(t, "POST", "/api/v1/catalogue", mgr, item); rec.Code != http.StatusConflict {
		t.Errorf("duplicate = %d, want 409", rec.Code)
	}
	withCurrency := map[string]any{"name": "X", "size_group": "NONE", "active": true, "currency": "USD"}
	if rec := api.do(t, "POST", "/api/v1/catalogue", mgr, withCurrency); rec.Code != http.StatusBadRequest {
		t.Errorf("currency accepted: %d", rec.Code)
	}
	noActive := map[string]any{"name": "Y", "size_group": "NONE"}
	if rec := api.do(t, "POST", "/api/v1/catalogue", mgr, noActive); rec.Code != http.StatusBadRequest {
		t.Errorf("missing active = %d, want 400", rec.Code)
	}

	// A price not yet set is allowed in the catalogue.
	rec = api.do(t, "POST", "/api/v1/catalogue", mgr, map[string]any{"name": "Safety helmet", "size_group": "NONE", "active": true, "display_rank": 5})
	if rec.Code != http.StatusCreated {
		t.Fatalf("draft item = %d %s", rec.Code, rec.Body)
	}
	helmet := decode[map[string]any](t, rec.Body.Bytes())
	if helmet["unit_price_cents"] != nil || helmet["currency"] != "EUR" {
		t.Errorf("draft = %v", helmet)
	}

	if rec := api.do(t, "POST", "/api/v1/catalogue/"+helmet["id"].(string)+"/deactivate", mgr, nil); rec.Code != http.StatusOK {
		t.Errorf("deactivate = %d", rec.Code)
	}
	rec = api.do(t, "GET", "/api/v1/catalogue/active", staff, nil)
	active := decode[[]map[string]any](t, rec.Body.Bytes())
	if len(active) != 1 || active[0]["id"] != id {
		t.Errorf("active = %s", rec.Body)
	}
	rec = api.do(t, "GET", "/api/v1/catalogue", staff, nil)
	if all := decode[[]map[string]any](t, rec.Body.Bytes()); len(all) != 2 {
		t.Errorf("all = %s", rec.Body)
	}

	item["unit_price_cents"] = 5499
	if rec := api.do(t, "PUT", "/api/v1/catalogue/"+id, mgr, item); rec.Code != http.StatusOK {
		t.Errorf("update = %d %s", rec.Code, rec.Body)
	}
}

// TestPostgresCreateOrderResolution covers the Create Order read path end to
// end: item set CRUD, Apply Item Set, and resolving after a size is saved.
func TestPostgresCreateOrderResolution(t *testing.T) {
	api, _ := newPostgresAPI(t)
	_, staff := api.userWith(t, user.RoleEmployee)
	_, mgr := api.userWith(t, user.RoleManager)

	mkItem := func(body map[string]any) string {
		t.Helper()
		body["active"] = true
		rec := api.do(t, "POST", "/api/v1/catalogue", mgr, body)
		if rec.Code != http.StatusCreated {
			t.Fatalf("item = %d %s", rec.Code, rec.Body)
		}
		return decode[map[string]any](t, rec.Body.Bytes())["id"].(string)
	}
	shoes := mkItem(map[string]any{"name": "Safety shoes", "size_group": "SHOES", "unit_price_cents": 4999, "service_period_months": 12})
	jacket := mkItem(map[string]any{"name": "Work jacket", "size_group": "CLOTHING", "unit_price_cents": 3999, "service_period_months": 24})
	gloves := mkItem(map[string]any{"name": "Protective gloves", "size_group": "NONE", "unit_price_cents": 250, "service_period_months": 1})

	rec := api.do(t, "POST", "/api/v1/employees", staff, map[string]any{"first_name": "Ona", "last_name": "K", "height_cm": 170})
	emp := decode[map[string]any](t, rec.Body.Bytes())["id"].(string)

	set := map[string]any{"name": "Starter", "active": true, "lines": []map[string]any{
		{"catalogue_item_id": jacket, "default_quantity": 1},
		{"catalogue_item_id": shoes, "default_quantity": 1},
		{"catalogue_item_id": gloves, "default_quantity": 10},
	}}
	if rec := api.do(t, "POST", "/api/v1/item-sets", staff, set); rec.Code != http.StatusForbidden {
		t.Errorf("employee creates set = %d, want 403", rec.Code)
	}
	rec = api.do(t, "POST", "/api/v1/item-sets", mgr, set)
	if rec.Code != http.StatusCreated {
		t.Fatalf("set = %d %s", rec.Code, rec.Body)
	}
	setID := decode[map[string]any](t, rec.Body.Bytes())["id"].(string)

	type line struct {
		CatalogueItemID string  `json:"catalogue_item_id"`
		Size            *string `json:"size"`
		SizeSuggested   bool    `json:"size_suggested"`
		SizeMissing     bool    `json:"size_missing"`
		Quantity        int     `json:"quantity"`
		UnitPriceCents  *int64  `json:"unit_price_cents"`
	}
	type resolution struct {
		Employee  map[string]any `json:"employee"`
		Lines     []line         `json:"lines"`
		Orderable bool           `json:"orderable"`
	}

	rec = api.do(t, "GET", "/api/v1/item-sets/"+setID+"/apply/"+emp, staff, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("apply = %d %s", rec.Code, rec.Body)
	}
	res := decode[resolution](t, rec.Body.Bytes())
	if len(res.Lines) != 3 || res.Lines[0].CatalogueItemID != jacket || res.Lines[2].Quantity != 10 {
		t.Fatalf("apply lines = %+v", res.Lines)
	}
	if res.Lines[0].Size == nil || *res.Lines[0].Size != "M" || !res.Lines[0].SizeSuggested { // 170 cm → M
		t.Errorf("jacket = %+v", res.Lines[0])
	}
	if !res.Lines[1].SizeMissing || res.Orderable { // no shoe size saved; never inferred
		t.Errorf("shoes = %+v orderable=%v", res.Lines[1], res.Orderable)
	}
	if res.Employee["full_name"] != "Ona K" {
		t.Errorf("employee = %v", res.Employee)
	}

	// Save as Employee Default, then re-resolve: fresh data, now orderable.
	api.do(t, "PUT", "/api/v1/employees/"+emp+"/sizes", staff, map[string]any{"height_cm": 170, "shoe_size": "40"})
	rec = api.do(t, "POST", "/api/v1/orders/resolve", staff, map[string]any{"employee_id": emp, "lines": []map[string]any{
		{"catalogue_item_id": shoes, "quantity": 1}, {"catalogue_item_id": gloves, "quantity": 2}, {"catalogue_item_id": gloves, "quantity": 3},
	}})
	res = decode[resolution](t, rec.Body.Bytes())
	if rec.Code != http.StatusOK || len(res.Lines) != 2 || *res.Lines[0].Size != "40" || res.Lines[1].Quantity != 5 || !res.Orderable {
		t.Errorf("resolve = %d %s", rec.Code, rec.Body)
	}

	// Quantity below 1 is rejected; a non-integer fails JSON decoding.
	bad := map[string]any{"employee_id": emp, "lines": []map[string]any{{"catalogue_item_id": shoes, "quantity": 0}}}
	if rec := api.do(t, "POST", "/api/v1/orders/resolve", staff, bad); rec.Code != http.StatusBadRequest {
		t.Errorf("quantity 0 = %d", rec.Code)
	}
	bad["lines"] = []map[string]any{{"catalogue_item_id": shoes, "quantity": 1.5}}
	if rec := api.do(t, "POST", "/api/v1/orders/resolve", staff, bad); rec.Code != http.StatusBadRequest {
		t.Errorf("quantity 1.5 = %d", rec.Code)
	}

	// A deactivated set cannot be applied.
	set["active"] = false
	api.do(t, "PUT", "/api/v1/item-sets/"+setID, mgr, set)
	if rec := api.do(t, "GET", "/api/v1/item-sets/"+setID+"/apply/"+emp, staff, nil); rec.Code != http.StatusNotFound {
		t.Errorf("apply inactive = %d, want 404", rec.Code)
	}
}

// TestPostgresMarkAsOrderedHTTP covers algorithm B over HTTP: the response is
// the stored snapshot, client-supplied prices are rejected, and a missing
// catalogue price blocks the order with 409.
func TestPostgresMarkAsOrderedHTTP(t *testing.T) {
	api, _ := newPostgresAPI(t)
	_, staff := api.userWith(t, user.RoleEmployee)
	_, mgr := api.userWith(t, user.RoleManager)

	mk := func(body map[string]any) string {
		t.Helper()
		body["active"] = true
		rec := api.do(t, "POST", "/api/v1/catalogue", mgr, body)
		if rec.Code != http.StatusCreated {
			t.Fatalf("item = %d %s", rec.Code, rec.Body)
		}
		return decode[map[string]any](t, rec.Body.Bytes())["id"].(string)
	}
	shoes := mk(map[string]any{"name": "Safety shoes", "details": "S3", "size_group": "SHOES", "unit_price_cents": 4999, "service_period_months": 12})
	helmet := mk(map[string]any{"name": "Safety helmet", "size_group": "NONE"})
	rec := api.do(t, "POST", "/api/v1/employees", staff, map[string]any{"first_name": "Jonas", "last_name": "P", "code": "W-17"})
	emp := decode[map[string]any](t, rec.Body.Bytes())["id"].(string)

	body := map[string]any{"employee_id": emp, "lines": []map[string]any{{"catalogue_item_id": shoes, "quantity": 2, "size": "43"}}}
	rec = api.do(t, "POST", "/api/v1/orders", staff, body)
	if rec.Code != http.StatusCreated {
		t.Fatalf("mark = %d %s", rec.Code, rec.Body)
	}
	o := decode[map[string]any](t, rec.Body.Bytes())
	if o["status"] != "ORDERED" || o["total_cents"] != float64(9998) || o["employee_code"] != "W-17" || o["given_at"] != nil {
		t.Errorf("order = %v", o)
	}
	if rn, _ := o["record_number"].(string); len(rn) != 9 || rn[:3] != "WE-" {
		t.Errorf("record number = %v", o["record_number"])
	}
	lines := o["lines"].([]any)
	if l := lines[0].(map[string]any); l["item_details"] != "S3" || l["size"] != "43" || l["unit_price_cents"] != float64(4999) {
		t.Errorf("line = %v", l)
	}

	rec = api.do(t, "GET", "/api/v1/orders/"+o["id"].(string), staff, nil)
	if rec.Code != http.StatusOK || decode[map[string]any](t, rec.Body.Bytes())["record_number"] != o["record_number"] {
		t.Errorf("get = %d %s", rec.Code, rec.Body)
	}

	withPrice := map[string]any{"employee_id": emp, "lines": []map[string]any{{"catalogue_item_id": shoes, "quantity": 1, "size": "43", "unit_price_cents": 1}}}
	if rec := api.do(t, "POST", "/api/v1/orders", staff, withPrice); rec.Code != http.StatusBadRequest {
		t.Errorf("client price accepted: %d", rec.Code)
	}
	noPrice := map[string]any{"employee_id": emp, "lines": []map[string]any{{"catalogue_item_id": helmet, "quantity": 1}}}
	if rec := api.do(t, "POST", "/api/v1/orders", staff, noPrice); rec.Code != http.StatusConflict {
		t.Errorf("missing price = %d, want 409 (%s)", rec.Code, rec.Body)
	}
	for _, q := range []any{0, -1, 1.5, "2"} {
		bad := map[string]any{"employee_id": emp, "lines": []map[string]any{{"catalogue_item_id": shoes, "quantity": q, "size": "43"}}}
		if rec := api.do(t, "POST", "/api/v1/orders", staff, bad); rec.Code != http.StatusBadRequest {
			t.Errorf("quantity %v = %d, want 400", q, rec.Code)
		}
	}
	noSize := map[string]any{"employee_id": emp, "lines": []map[string]any{{"catalogue_item_id": shoes, "quantity": 1}}}
	if rec := api.do(t, "POST", "/api/v1/orders", staff, noSize); rec.Code != http.StatusBadRequest {
		t.Errorf("missing size = %d, want 400", rec.Code)
	}
}

func TestPostgresHistoryHTTP(t *testing.T) {
	api, _ := newPostgresAPI(t)
	_, staff := api.userWith(t, user.RoleEmployee)
	_, mgr := api.userWith(t, user.RoleManager)

	rec := api.do(t, "POST", "/api/v1/catalogue", mgr, map[string]any{"name": "Gloves", "size_group": "NONE", "unit_price_cents": 250, "service_period_months": 1, "active": true})
	gloves := decode[map[string]any](t, rec.Body.Bytes())["id"].(string)
	var emps []string
	for _, n := range []string{"Jonas", "Ona"} {
		rec := api.do(t, "POST", "/api/v1/employees", staff, map[string]any{"first_name": n, "last_name": "X"})
		emps = append(emps, decode[map[string]any](t, rec.Body.Bytes())["id"].(string))
	}
	for _, e := range []string{emps[0], emps[1], emps[0]} {
		body := map[string]any{"employee_id": e, "lines": []map[string]any{{"catalogue_item_id": gloves, "quantity": 1}}}
		if rec := api.do(t, "POST", "/api/v1/orders", staff, body); rec.Code != http.StatusCreated {
			t.Fatalf("order = %d %s", rec.Code, rec.Body)
		}
	}

	type page struct {
		Orders []struct {
			RecordNumber      string           `json:"record_number"`
			EmployeeID        string           `json:"employee_id"`
			EmployeeFirstName string           `json:"employee_first_name"`
			Status            string           `json:"status"`
			UsageMonths       *float64         `json:"usage_months"`
			Lines             []map[string]any `json:"lines"`
		} `json:"orders"`
		Page, PageSize, Total int
	}
	rec = api.do(t, "GET", "/api/v1/orders", staff, nil)
	all := decode[page](t, rec.Body.Bytes())
	if rec.Code != http.StatusOK || all.Total != 3 || len(all.Orders) != 3 || all.Orders[0].RecordNumber <= all.Orders[2].RecordNumber {
		t.Fatalf("history = %d %s", rec.Code, rec.Body)
	}
	if all.Orders[0].Status != "ORDERED" || all.Orders[0].UsageMonths != nil || len(all.Orders[0].Lines) != 1 {
		t.Errorf("first = %+v", all.Orders[0])
	}
	rec = api.do(t, "GET", "/api/v1/orders?employee_id="+emps[0]+"&status=ORDERED&page_size=1&page=2", staff, nil)
	p := decode[page](t, rec.Body.Bytes())
	if p.Total != 2 || len(p.Orders) != 1 || p.Orders[0].EmployeeID != emps[0] {
		t.Errorf("filtered = %s", rec.Body)
	}
	for _, bad := range []string{"?status=DRAFT", "?from=yesterday", "?page=x", "?employee_id=nope", "?sort=asc", "?sort=total&dir=up", "?order=total"} {
		if rec := api.do(t, "GET", "/api/v1/orders"+bad, staff, nil); rec.Code != http.StatusBadRequest {
			t.Errorf("%s = %d, want 400", bad, rec.Code)
		}
	}
	// Ona sorts after Jonas, so she comes first when descending.
	if rec := api.do(t, "GET", "/api/v1/orders?sort=employee&dir=desc", staff, nil); rec.Code != http.StatusOK {
		t.Errorf("sorted = %d %s", rec.Code, rec.Body)
	} else if p := decode[page](t, rec.Body.Bytes()); len(p.Orders) == 0 || p.Orders[0].EmployeeFirstName != "Ona" || p.Orders[len(p.Orders)-1].EmployeeFirstName != "Jonas" {
		t.Errorf("employee desc = %s", rec.Body)
	}
	rec = api.do(t, "GET", "/api/v1/orders?status=GIVEN", staff, nil)
	if rec.Code != http.StatusOK || decode[page](t, rec.Body.Bytes()).Total != 0 {
		t.Errorf("no GIVEN yet = %s", rec.Body)
	}

	// The item page lists the orders holding an item, and its price history.
	rec = api.do(t, "POST", "/api/v1/catalogue", mgr, map[string]any{"name": "Vest", "size_group": "NONE", "unit_price_cents": 900, "service_period_months": 12, "active": true})
	vest := decode[map[string]any](t, rec.Body.Bytes())["id"].(string)
	body := map[string]any{"employee_id": emps[1], "lines": []map[string]any{{"catalogue_item_id": vest, "quantity": 2}}}
	if rec := api.do(t, "POST", "/api/v1/orders", staff, body); rec.Code != http.StatusCreated {
		t.Fatalf("vest order = %d %s", rec.Code, rec.Body)
	}
	for item, want := range map[string]int{gloves: 3, vest: 1} {
		rec = api.do(t, "GET", "/api/v1/orders?catalogue_item_id="+item, staff, nil)
		if p := decode[page](t, rec.Body.Bytes()); rec.Code != http.StatusOK || p.Total != want {
			t.Errorf("orders with %s = %s, want %d", item, rec.Body, want)
		}
	}
	if rec := api.do(t, "GET", "/api/v1/orders?catalogue_item_id=nope", staff, nil); rec.Code != http.StatusBadRequest {
		t.Errorf("bad item id = %d, want 400", rec.Code)
	}
	rec = api.do(t, "GET", "/api/v1/catalogue/"+vest+"/price-history", staff, nil)
	if h := decode[[]map[string]any](t, rec.Body.Bytes()); rec.Code != http.StatusOK || len(h) != 1 || h[0]["event"] != "catalogue.created" ||
		h[0]["unit_price_cents"] != float64(900) || h[0]["before_cents"] != nil {
		t.Errorf("price history = %d %s", rec.Code, rec.Body)
	}
	if rec := api.do(t, "GET", "/api/v1/catalogue/"+uuid.NewString()+"/price-history", staff, nil); rec.Code != http.StatusNotFound {
		t.Errorf("unknown item history = %d, want 404", rec.Code)
	}
	rec = api.do(t, "GET", "/api/v1/settings", staff, nil)
	if decode[map[string]string](t, rec.Body.Bytes())["timezone"] != "Europe/Vilnius" {
		t.Errorf("settings = %s", rec.Body)
	}
}

// TestPostgresConfirmationHTTP walks Open Employee Confirmation → public page
// → Confirm Receipt, and the paper path, over HTTP.
func TestPostgresConfirmationHTTP(t *testing.T) {
	api, pool := newPostgresAPI(t)
	_, staff := api.userWith(t, user.RoleEmployee)
	_, mgr := api.userWith(t, user.RoleManager)

	rec := api.do(t, "POST", "/api/v1/catalogue", mgr, map[string]any{"name": "Gloves", "size_group": "NONE", "unit_price_cents": 250, "service_period_months": 1, "active": true})
	gloves := decode[map[string]any](t, rec.Body.Bytes())["id"].(string)
	rec = api.do(t, "POST", "/api/v1/employees", staff, map[string]any{"first_name": "Ona", "last_name": "K"})
	emp := decode[map[string]any](t, rec.Body.Bytes())["id"].(string)
	place := func() string {
		t.Helper()
		rec := api.do(t, "POST", "/api/v1/orders", staff, map[string]any{"employee_id": emp, "lines": []map[string]any{{"catalogue_item_id": gloves, "quantity": 2}}})
		return decode[map[string]any](t, rec.Body.Bytes())["id"].(string)
	}

	id := place()
	rec = api.do(t, "POST", "/api/v1/orders/"+id+"/confirmation-link", staff, nil)
	if rec.Code != http.StatusCreated || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("link = %d %s", rec.Code, rec.Body)
	}
	link := decode[map[string]string](t, rec.Body.Bytes())["url"]
	const prefix = "https://work.example.com/confirm/"
	if len(link) <= len(prefix) || link[:len(prefix)] != prefix {
		t.Fatalf("url = %q", link)
	}
	token := link[len(prefix):]

	type record struct {
		OrderID      *string        `json:"order_id"`
		Receipt      map[string]any `json:"receipt"`
		DocumentHash string         `json:"document_hash"`
		Status       string         `json:"status"`
		Confirmation map[string]any `json:"confirmation"`
	}
	rec = api.do(t, "POST", "/api/v1/confirmations/view", "", map[string]any{"token": token})
	view := decode[record](t, rec.Body.Bytes())
	if rec.Code != http.StatusOK || view.Status != "ORDERED" || view.OrderID != nil || view.Receipt["confirmation_text_ru"] == "" || len(view.DocumentHash) != 64 {
		t.Fatalf("view = %d %s", rec.Code, rec.Body)
	}
	if rec := api.do(t, "POST", "/api/v1/confirmations/confirm", "", map[string]any{"token": token, "confirmed": false}); rec.Code != http.StatusBadRequest {
		t.Errorf("unchecked = %d", rec.Code)
	}
	rec = api.do(t, "POST", "/api/v1/confirmations/confirm", "", map[string]any{"token": token, "confirmed": true})
	given := decode[record](t, rec.Body.Bytes())
	if rec.Code != http.StatusOK || given.Status != "GIVEN" || given.Confirmation["method"] != "ELECTRONIC" || given.DocumentHash != view.DocumentHash {
		t.Fatalf("confirm = %d %s", rec.Code, rec.Body)
	}
	rec = api.do(t, "POST", "/api/v1/confirmations/confirm", "", map[string]any{"token": token, "confirmed": true})
	if rec.Code != http.StatusOK || decode[record](t, rec.Body.Bytes()).Status != "GIVEN" {
		t.Errorf("second confirm = %d %s", rec.Code, rec.Body)
	}
	if rec := api.do(t, "POST", "/api/v1/orders/"+id+"/confirmation-link", staff, nil); rec.Code != http.StatusConflict {
		t.Errorf("link for GIVEN = %d, want 409", rec.Code)
	}
	if rec := api.do(t, "POST", "/api/v1/confirmations/view", "", map[string]any{"token": "bogus"}); rec.Code != http.StatusGone {
		t.Errorf("unknown token = %d, want 410", rec.Code)
	}
	rec = api.do(t, "GET", "/api/v1/orders/"+id+"/record", staff, nil)
	if r := decode[record](t, rec.Body.Bytes()); rec.Code != http.StatusOK || r.OrderID == nil || r.DocumentHash != view.DocumentHash {
		t.Errorf("record = %d %s", rec.Code, rec.Body)
	}

	// Paper.
	id2 := place()
	rec = api.do(t, "POST", "/api/v1/orders/"+id2+"/confirm-paper", staff, nil)
	if r := decode[record](t, rec.Body.Bytes()); rec.Code != http.StatusOK || r.Status != "GIVEN" || r.Confirmation["method"] != "PAPER" {
		t.Errorf("paper = %d %s", rec.Code, rec.Body)
	}

	// The token never reaches a URL the API logs.
	var n int
	pool.QueryRow(context.Background(), `SELECT count(*) FROM order_confirmations WHERE token_hash = $1`, token).Scan(&n)
	if n != 0 {
		t.Error("plaintext token stored")
	}
}

// An empty database gives a complete dashboard: twelve zero months and empty
// lists (never null), so the page needs no special case for a new install.
func TestPostgresDashboardHTTP(t *testing.T) {
	api, _ := newPostgresAPI(t)
	_, adminTok := api.userWith(t, user.RoleAdmin)
	_, managerTok := api.userWith(t, user.RoleManager)

	if code := api.do(t, "GET", "/api/v1/dashboard", managerTok, nil).Code; code != http.StatusForbidden {
		t.Errorf("manager: %d, want 403", code)
	}
	rec := api.do(t, "GET", "/api/v1/dashboard", adminTok, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("admin: %d %s", rec.Code, rec.Body)
	}
	body := rec.Body.String()
	for _, want := range []string{`"longest":[]`, `"top_items":[]`, `"next":[]`, `"timezone":"UTC"`, `"oldest_days":null`, `"users":3`, `"admins":2`} {
		if !strings.Contains(body, want) {
			t.Errorf("body lacks %s: %s", want, body)
		}
	}
	var out struct {
		Months []struct {
			Month string `json:"month"`
		} `json:"months"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil || len(out.Months) != 12 || out.Months[11].Month != time.Now().UTC().Format("2006-01") {
		t.Errorf("months = %+v (%v)", out.Months, err)
	}

	// The manager's dashboard is the manager's alone.
	if code := api.do(t, "GET", "/api/v1/dashboard/manager", adminTok, nil).Code; code != http.StatusForbidden {
		t.Errorf("admin on the manager dashboard: %d, want 403", code)
	}
	rec = api.do(t, "GET", "/api/v1/dashboard/manager", managerTok, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("manager: %d %s", rec.Code, rec.Body)
	}
	body = rec.Body.String()
	for _, want := range []string{`"lines":[]`, `"spend_by_item":[]`, `"price_changes":[]`, `"item_sets":[]`, `"unpriced":[]`, `"days":90`, `{"size":"S","employees":0}`} {
		if !strings.Contains(body, want) {
			t.Errorf("manager body lacks %s: %s", want, body)
		}
	}

	// So is the employee role's; it covers the signed-in user.
	_, employeeTok := api.userWith(t, user.RoleEmployee)
	for _, tok := range []string{adminTok, managerTok} {
		if code := api.do(t, "GET", "/api/v1/dashboard/employee", tok, nil).Code; code != http.StatusForbidden {
			t.Errorf("other role on the employee dashboard: %d, want 403", code)
		}
	}
	rec = api.do(t, "GET", "/api/v1/dashboard/employee", employeeTok, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("employee: %d %s", rec.Code, rec.Body)
	}
	body = rec.Body.String()
	for _, want := range []string{`"longest":[]`, `"recently_given":[]`, `"next":[]`, `"list":[]`, `"no_link":0`, `"oldest_days":null`, `"due_soon_days":30`} {
		if !strings.Contains(body, want) {
			t.Errorf("employee body lacks %s: %s", want, body)
		}
	}
}
