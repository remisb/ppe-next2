package main

import (
	"context"
	"net/http"
	"slices"
	"testing"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/role"
	"github.com/remisb/ppe-next2/internal/domain/session"
	"github.com/remisb/ppe-next2/internal/domain/user"
	"github.com/remisb/ppe-next2/internal/security"
)

// Every sign-in, failed attempt, confirmed password and sign-out is recorded,
// with why it failed and the account when the email named one.
func TestSignInsAreRecorded(t *testing.T) {
	api := newTestAPI(t)
	u, _ := api.userWith(t, role.KeyEmployee)
	before := len(api.log.kinds())

	api.send(t, "POST", "/api/v1/auth/login", browserRequest{origin: appOrigin, body: map[string]any{"email": u.Email, "password": "wrong-password"}})
	api.send(t, "POST", "/api/v1/auth/login", browserRequest{origin: appOrigin, body: map[string]any{"email": "ghost@example.com", "password": "password123"}})
	_, tok, c := api.login(t, u.Email, "password123", true)
	api.send(t, "POST", "/api/v1/auth/reauth", browserRequest{token: tok, body: map[string]string{"password": "wrong-password"}})
	api.send(t, "POST", "/api/v1/auth/reauth", browserRequest{token: tok, body: map[string]string{"password": "password123"}})
	if rec := api.send(t, "POST", "/api/v1/auth/logout", browserRequest{origin: appOrigin, cookie: c.Value}); rec.Code != http.StatusNoContent {
		t.Fatalf("logout = %d", rec.Code)
	}

	want := []string{
		"sign_in_failed:bad_password", "sign_in_failed:unknown_email", "sign_in",
		"reauth_failed:bad_password", "reauth", "signed_out",
	}
	if got := api.log.kinds()[before:]; !slices.Equal(got, want) {
		t.Errorf("recorded %v\nwant %v", got, want)
	}
	evs := api.log.events[before:]
	if evs[0].UserID == nil || *evs[0].UserID != u.ID || evs[1].UserID != nil {
		t.Errorf("accounts: %v, %v", evs[0].UserID, evs[1].UserID)
	}
	hash := api.svc.security.EmailHash(u.Email)
	for _, i := range []int{0, 2, 3, 4} {
		if string(evs[i].EmailHash) != string(hash) {
			t.Errorf("event %d (%s) has another email hash", i, evs[i].Kind)
		}
	}
	if string(api.svc.security.EmailHash(" "+u.Email+" ")) != string(api.svc.security.EmailHash(u.Email)) ||
		string(api.svc.security.EmailHash("GHOST@example.com")) != string(evs[1].EmailHash) {
		t.Error("the email hash does not compare emails as accounts do")
	}
}

// An administrator ends anyone's live session from Security; it ends at once
// and is recorded. Someone with users.manage who may not manage that user is
// refused, as on Users.
func TestEndSessionFromSecurity(t *testing.T) {
	api := newTestAPI(t)
	ctx := context.Background()
	_, adminTok := api.userWith(t, role.KeyAdmin)
	emp, _ := api.userWith(t, role.KeyEmployee)
	s, _, err := api.svc.sessions.Start(ctx, session.StartParams{UserID: emp.ID, KeepSignedIn: true})
	if err != nil {
		t.Fatal(err)
	}

	if rec := api.do(t, "DELETE", "/api/v1/security/sessions/"+uuid.NewString(), adminTok, nil); rec.Code != http.StatusNotFound {
		t.Errorf("unknown session = %d, want 404", rec.Code)
	}

	// A role that manages users but holds nothing else cannot end an
	// administrator's session.
	r, err := api.svc.roles.Create(ctx, role.Params{Name: "People", Permissions: []string{string(role.UsersRead), string(role.UsersManage)}}, api.admin.ID)
	if err != nil {
		t.Fatal(err)
	}
	people, err := api.svc.users.Create(ctx, user.CreateParams{Email: "people@example.com", Name: "P", Password: "password123", RoleIDs: []uuid.UUID{r.ID}}, api.admin.ID)
	if err != nil {
		t.Fatal(err)
	}
	adminSession, _, _ := api.svc.sessions.Start(ctx, session.StartParams{UserID: api.admin.ID})
	if rec := api.do(t, "DELETE", "/api/v1/security/sessions/"+adminSession.ID.String(), api.signIn(t, people), nil); rec.Code != http.StatusForbidden {
		t.Errorf("ending an administrator's session without their permissions = %d, want 403", rec.Code)
	}

	if rec := api.do(t, "DELETE", "/api/v1/security/sessions/"+s.ID.String(), adminTok, nil); rec.Code != http.StatusNoContent {
		t.Fatalf("end = %d", rec.Code)
	}
	if _, err := api.svc.sessions.Live(ctx, s.ID); err == nil {
		t.Error("the session is still live")
	}
	if rec := api.do(t, "DELETE", "/api/v1/security/sessions/"+s.ID.String(), adminTok, nil); rec.Code != http.StatusNotFound {
		t.Errorf("ending it again = %d, want 404", rec.Code)
	}
	kinds := api.log.kinds()
	if kinds[len(kinds)-1] != string(security.KindSessionEnded)+":"+session.ReasonEndedByAdministrator {
		t.Errorf("last event = %s", kinds[len(kinds)-1])
	}
}

func TestSecurityListRejectsUnknownParameters(t *testing.T) {
	api := newTestAPI(t)
	_, tok := api.userWith(t, role.KeyAdmin)
	for _, q := range []string{"?name=x", "?kind=sign_in&kind=reauth", "?user=nope", "?kind=hack", "?after=zzz", "?page_size=x", "?page_size=500", "?from=2026-10-07&to=2026-10-01"} {
		if rec := api.do(t, "GET", "/api/v1/security/events"+q, tok, nil); rec.Code != 400 {
			t.Errorf("%s: %d, want 400", q, rec.Code)
		}
	}
	if rec := api.do(t, "GET", "/api/v1/security/events?kind=sign_in_failed&page_size=10", tok, nil); rec.Code != 200 ||
		rec.Body.String() != "{\"events\":[],\"next\":null}\n" {
		t.Errorf("empty log = %d %s", rec.Code, rec.Body)
	}
}
