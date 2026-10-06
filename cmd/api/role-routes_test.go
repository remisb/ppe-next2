package main

import (
	"context"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/role"
	"github.com/remisb/ppe-next2/internal/domain/user"
)

// Roles over HTTP: the catalogue, a custom role added, given to a user and
// refused deletion while held; Administrator refused any change; nobody
// grants beyond their own permissions unless they manage roles.
func TestRolesHTTP(t *testing.T) {
	api := newTestAPI(t)
	adminTok := api.signIn(t, api.admin)

	rec := api.do(t, "GET", "/api/v1/permissions", adminTok, nil)
	catalogue := decode[[]role.Info](t, rec.Body.Bytes())
	if rec.Code != http.StatusOK || len(catalogue) != len(role.Catalogue()) || catalogue[1].Key != role.UsersManage || !slices.Equal(catalogue[1].Requires, []role.Permission{role.UsersRead}) {
		t.Fatalf("permissions = %d %s", rec.Code, rec.Body)
	}

	rec = api.do(t, "POST", "/api/v1/roles", adminTok, map[string]any{"name": "Storekeeper", "description": "Keeps the store", "permissions": []string{"catalogue.manage", "item_sets.manage"}})
	if rec.Code != http.StatusCreated || !strings.HasPrefix(rec.Header().Get("Location"), "/api/v1/roles/") {
		t.Fatalf("create = %d %s", rec.Code, rec.Body)
	}
	store := decode[role.Role](t, rec.Body.Bytes())
	if store.Key != nil || store.Locked || !slices.Equal(store.Permissions, []role.Permission{role.CatalogueManage, role.ItemSetsManage}) {
		t.Errorf("created = %+v", store)
	}
	// Derived and server-set fields are refused in the body; a requirement left out is named.
	if rec := api.do(t, "POST", "/api/v1/roles", adminTok, map[string]any{"name": "X", "locked": true}); rec.Code != http.StatusBadRequest {
		t.Errorf("locked in the body = %d", rec.Code)
	}
	if rec := api.do(t, "POST", "/api/v1/roles", adminTok, map[string]any{"name": "X", "permissions": []string{"roles.manage"}}); rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "roles.manage needs users.read") {
		t.Errorf("a requirement left out = %d %s", rec.Code, rec.Body)
	}

	// Given to a user: the role is in use, and the user's token grants its permissions.
	rec = api.do(t, "POST", "/api/v1/users", adminTok, map[string]any{"email": "store@example.com", "name": "Store", "password": "password123", "role_ids": []uuid.UUID{store.ID}})
	if rec.Code != http.StatusCreated {
		t.Fatalf("add a storekeeper = %d %s", rec.Code, rec.Body)
	}
	keeper := decode[user.User](t, rec.Body.Bytes())
	if !slices.Equal(keeper.RoleIDs, []uuid.UUID{store.ID}) {
		t.Errorf("role_ids = %v", keeper.RoleIDs)
	}
	keeperTok := api.signIn(t, keeper)
	if rec := api.do(t, "POST", "/api/v1/catalogue", keeperTok, map[string]any{}); rec.Code == http.StatusForbidden || rec.Code == http.StatusUnauthorized {
		t.Errorf("the storekeeper adds an item = %d, want past authorization", rec.Code)
	}
	if rec := api.do(t, "DELETE", "/api/v1/orders/"+uuid.NewString(), keeperTok, nil); rec.Code != http.StatusForbidden {
		t.Errorf("the storekeeper deletes an order = %d, want 403", rec.Code)
	}
	if rec := api.do(t, "POST", "/api/v1/users", adminTok, map[string]any{"email": "x@example.com", "name": "X", "password": "password123", "role_ids": []uuid.UUID{uuid.New()}}); rec.Code != http.StatusBadRequest {
		t.Errorf("an unknown role = %d", rec.Code)
	}

	// Administrator cannot be changed or deleted.
	if rec := api.do(t, "PUT", "/api/v1/roles/"+role.AdminID.String(), adminTok, map[string]any{"name": "Administrator", "permissions": []string{"users.read"}}); rec.Code != http.StatusConflict {
		t.Errorf("change Administrator = %d", rec.Code)
	}
	if rec := api.do(t, "DELETE", "/api/v1/roles/"+role.AdminID.String(), adminTok, nil); rec.Code != http.StatusConflict {
		t.Errorf("delete Administrator = %d", rec.Code)
	}
	// A role in use is not deleted; once no one holds it, it is.
	if rec := api.do(t, "DELETE", "/api/v1/roles/"+store.ID.String(), adminTok, nil); rec.Code != http.StatusConflict {
		t.Errorf("delete a held role = %d %s", rec.Code, rec.Body)
	}
}

// A user who manages users but not roles gives only roles within their own
// permissions; an administrator demoted mid-session is refused at once on the
// routes that manage users and roles, before their token runs out.
func TestManagingIsLimitedAndRechecked(t *testing.T) {
	api := newTestAPI(t)
	ctx := context.Background()
	adminTok := api.signIn(t, api.admin)
	people, err := api.svc.roles.Create(ctx, role.Params{Name: "People", Permissions: []string{"users.read", "users.manage"}}, api.admin.ID)
	if err != nil {
		t.Fatal(err)
	}
	hr, err := api.svc.users.Create(ctx, user.CreateParams{Email: "hr@example.com", Name: "HR", Password: "password123", RoleIDs: []uuid.UUID{people.ID}}, api.admin.ID)
	if err != nil {
		t.Fatal(err)
	}
	hrTok := api.signIn(t, hr)
	if rec := api.do(t, "POST", "/api/v1/users", hrTok, map[string]any{"email": "m@example.com", "name": "M", "password": "password123", "role_ids": []uuid.UUID{role.ManagerID}}); rec.Code != http.StatusForbidden {
		t.Errorf("make a manager = %d %s, want 403", rec.Code, rec.Body)
	}
	if rec := api.do(t, "PUT", "/api/v1/users/"+api.admin.ID.String()+"/password", hrTok, map[string]any{"password": "password999"}); rec.Code != http.StatusForbidden {
		t.Errorf("reset the administrator's password = %d, want 403", rec.Code)
	}
	if rec := api.do(t, "GET", "/api/v1/roles", hrTok, nil); rec.Code != http.StatusOK {
		t.Errorf("read roles = %d", rec.Code)
	}

	// A second administrator, demoted: their token still says users.manage.
	second, _ := api.userWith(t, role.KeyAdmin)
	secondTok := api.signIn(t, second)
	rec := api.do(t, "PUT", "/api/v1/users/"+second.ID.String(), adminTok, map[string]any{"email": second.Email, "name": second.Name, "role_ids": []uuid.UUID{role.EmployeeID}, "is_active": true})
	if rec.Code != http.StatusOK {
		t.Fatalf("demote = %d %s", rec.Code, rec.Body)
	}
	rec = api.do(t, "POST", "/api/v1/users", secondTok, map[string]any{"email": "z@example.com", "name": "Z", "password": "password123", "role_ids": []uuid.UUID{role.EmployeeID}})
	if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "no longer allow") {
		t.Errorf("the demoted administrator adds a user = %d %s, want 403", rec.Code, rec.Body)
	}
	if rec := api.do(t, "POST", "/api/v1/roles", secondTok, map[string]any{"name": "Mine"}); rec.Code != http.StatusForbidden {
		t.Errorf("the demoted administrator adds a role = %d, want 403", rec.Code)
	}

	// The last administrator keeps the role.
	rec = api.do(t, "PUT", "/api/v1/users/"+api.admin.ID.String(), adminTok, map[string]any{"email": api.admin.Email, "name": api.admin.Name, "role_ids": []uuid.UUID{role.EmployeeID}, "is_active": true})
	if rec.Code != http.StatusBadRequest {
		t.Errorf("drop own Administrator = %d %s, want 400", rec.Code, rec.Body)
	}
}
