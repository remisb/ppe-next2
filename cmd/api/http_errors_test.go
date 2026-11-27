package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/remisb/ppe-next2/internal/aiusage"
	"github.com/remisb/ppe-next2/internal/apperr"
	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/domain/asset"
	"github.com/remisb/ppe-next2/internal/domain/catalogue"
	"github.com/remisb/ppe-next2/internal/domain/company"
	"github.com/remisb/ppe-next2/internal/domain/dashboard"
	"github.com/remisb/ppe-next2/internal/domain/employee"
	"github.com/remisb/ppe-next2/internal/domain/employeephoto"
	"github.com/remisb/ppe-next2/internal/domain/itemset"
	"github.com/remisb/ppe-next2/internal/domain/launcher"
	"github.com/remisb/ppe-next2/internal/domain/mailtemplate"
	"github.com/remisb/ppe-next2/internal/domain/order"
	"github.com/remisb/ppe-next2/internal/domain/role"
	"github.com/remisb/ppe-next2/internal/domain/session"
	"github.com/remisb/ppe-next2/internal/domain/settings"
	"github.com/remisb/ppe-next2/internal/domain/share"
	"github.com/remisb/ppe-next2/internal/domain/supplier"
	"github.com/remisb/ppe-next2/internal/domain/user"
	"github.com/remisb/ppe-next2/internal/personnel/colour"
	"github.com/remisb/ppe-next2/internal/personnel/document"
	"github.com/remisb/ppe-next2/internal/personnel/scan"
	"github.com/remisb/ppe-next2/internal/security"
	"github.com/remisb/ppe-next2/internal/system"
	vaultdoc "github.com/remisb/ppe-next2/internal/vault/document"
	vaulttemplate "github.com/remisb/ppe-next2/internal/vault/template"
)

// errorStatusCases is every sentinel the API answers with its status, as the
// ordered errorStatuses table had them before error kinds (internal/apperr).
// It guards the move to kinds: no status may change.
var errorStatusCases = []struct {
	name   string
	err    error
	status int
}{
	{"errBadRequest", errBadRequest, http.StatusBadRequest},
	{"errTooManyAttempts", errTooManyAttempts, http.StatusTooManyRequests},
	{"errCrossOrigin", errCrossOrigin, http.StatusForbidden},
	{"errRecentSignInRequired", errRecentSignInRequired, http.StatusForbidden},
	{"errPermissionWithdrawn", errPermissionWithdrawn, http.StatusForbidden},
	{"user.ErrNotPermitted", user.ErrNotPermitted, http.StatusForbidden},
	{"role.ErrNotPermitted", role.ErrNotPermitted, http.StatusForbidden},
	{"asset.ErrNotPermitted", asset.ErrNotPermitted, http.StatusForbidden},
	{"asset.ErrSIMsNotPermitted", asset.ErrSIMsNotPermitted, http.StatusForbidden},
	{"asset.ErrMayNotChange", asset.ErrMayNotChange, http.StatusForbidden},
	{"catalogue.ErrNotPermitted", catalogue.ErrNotPermitted, http.StatusForbidden},
	{"employee.ErrNotPermitted", employee.ErrNotPermitted, http.StatusForbidden},
	{"vaultdoc.ErrForbidden", vaultdoc.ErrForbidden, http.StatusForbidden},
	{"errUnauthenticated", errUnauthenticated, http.StatusUnauthorized},
	{"user.ErrInvalidCredentials", user.ErrInvalidCredentials, http.StatusUnauthorized},
	{"user.ErrActorNotFound", user.ErrActorNotFound, http.StatusUnauthorized},
	{"session.ErrInvalidToken", session.ErrInvalidToken, http.StatusUnauthorized},
	{"employee.ErrActorNotFound", employee.ErrActorNotFound, http.StatusUnauthorized},
	{"catalogue.ErrActorNotFound", catalogue.ErrActorNotFound, http.StatusUnauthorized},
	{"supplier.ErrActorNotFound", supplier.ErrActorNotFound, http.StatusUnauthorized},
	{"vaultdoc.ErrActorNotFound", vaultdoc.ErrActorNotFound, http.StatusUnauthorized},
	{"vaulttemplate.ErrActorNotFound", vaulttemplate.ErrActorNotFound, http.StatusUnauthorized},
	{"share.ErrActorNotFound", share.ErrActorNotFound, http.StatusUnauthorized},
	{"company.ErrActorNotFound", company.ErrActorNotFound, http.StatusUnauthorized},
	{"itemset.ErrActorNotFound", itemset.ErrActorNotFound, http.StatusUnauthorized},
	{"order.ErrActorNotFound", order.ErrActorNotFound, http.StatusUnauthorized},
	{"settings.ErrActorNotFound", settings.ErrActorNotFound, http.StatusUnauthorized},
	{"mailtemplate.ErrActorNotFound", mailtemplate.ErrActorNotFound, http.StatusUnauthorized},
	{"launcher.ErrActorNotFound", launcher.ErrActorNotFound, http.StatusUnauthorized},
	{"role.ErrActorNotFound", role.ErrActorNotFound, http.StatusUnauthorized},
	{"asset.ErrActorNotFound", asset.ErrActorNotFound, http.StatusUnauthorized},
	{"employeephoto.ErrActorNotFound", employeephoto.ErrActorNotFound, http.StatusUnauthorized},
	{"document.ErrActorNotFound", document.ErrActorNotFound, http.StatusUnauthorized},
	{"scan.ErrActorNotFound", scan.ErrActorNotFound, http.StatusUnauthorized},
	{"user.ErrNotFound", user.ErrNotFound, http.StatusNotFound},
	{"role.ErrNotFound", role.ErrNotFound, http.StatusNotFound},
	{"session.ErrNotFound", session.ErrNotFound, http.StatusNotFound},
	{"employee.ErrNotFound", employee.ErrNotFound, http.StatusNotFound},
	{"employee.ErrEmploymentNotFound", employee.ErrEmploymentNotFound, http.StatusNotFound},
	{"catalogue.ErrNotFound", catalogue.ErrNotFound, http.StatusNotFound},
	{"supplier.ErrNotFound", supplier.ErrNotFound, http.StatusNotFound},
	{"vaultdoc.ErrNotFound", vaultdoc.ErrNotFound, http.StatusNotFound},
	{"vaulttemplate.ErrNotFound", vaulttemplate.ErrNotFound, http.StatusNotFound},
	{"vaultdoc.ErrSubjectNotFound", vaultdoc.ErrSubjectNotFound, http.StatusNotFound},
	{"share.ErrNotFound", share.ErrNotFound, http.StatusNotFound},
	{"company.ErrNotFound", company.ErrNotFound, http.StatusNotFound},
	{"catalogue.ErrPictureNotFound", catalogue.ErrPictureNotFound, http.StatusNotFound},
	{"itemset.ErrNotFound", itemset.ErrNotFound, http.StatusNotFound},
	{"order.ErrNotFound", order.ErrNotFound, http.StatusNotFound},
	{"order.ErrEmployeeNotFound", order.ErrEmployeeNotFound, http.StatusNotFound},
	{"order.ErrItemSetNotFound", order.ErrItemSetNotFound, http.StatusNotFound},
	{"audit.ErrNotFound", audit.ErrNotFound, http.StatusNotFound},
	{"mailtemplate.ErrNotFound", mailtemplate.ErrNotFound, http.StatusNotFound},
	{"launcher.ErrNotFound", launcher.ErrNotFound, http.StatusNotFound},
	{"asset.ErrNotFound", asset.ErrNotFound, http.StatusNotFound},
	{"asset.ErrEmployeeNotFound", asset.ErrEmployeeNotFound, http.StatusNotFound},
	{"asset.ErrNoForm", asset.ErrNoForm, http.StatusNotFound},
	{"asset.ErrAssignmentNotFound", asset.ErrAssignmentNotFound, http.StatusNotFound},
	{"asset.ErrFileTooLarge", asset.ErrFileTooLarge, http.StatusRequestEntityTooLarge},
	{"vaultdoc.ErrTooLarge", vaultdoc.ErrTooLarge, http.StatusRequestEntityTooLarge},
	{"asset.ErrFileType", asset.ErrFileType, http.StatusUnsupportedMediaType},
	{"vaultdoc.ErrFileType", vaultdoc.ErrFileType, http.StatusUnsupportedMediaType},
	{"asset.ErrNoStorage", asset.ErrNoStorage, http.StatusServiceUnavailable},
	{"vaultdoc.ErrNoStorage", vaultdoc.ErrNoStorage, http.StatusServiceUnavailable},
	{"vaultdoc.ErrNotConfigured", vaultdoc.ErrNotConfigured, http.StatusServiceUnavailable},
	{"asset.ErrNoSIMCodes", asset.ErrNoSIMCodes, http.StatusNotFound},
	{"asset.ErrSIMCodesUnavailable", asset.ErrSIMCodesUnavailable, http.StatusServiceUnavailable},
	{"employeephoto.ErrNotFound", employeephoto.ErrNotFound, http.StatusNotFound},
	{"employeephoto.ErrEmployeeNotFound", employeephoto.ErrEmployeeNotFound, http.StatusNotFound},
	{"employeephoto.ErrFileTooLarge", employeephoto.ErrFileTooLarge, http.StatusRequestEntityTooLarge},
	{"employeephoto.ErrFileType", employeephoto.ErrFileType, http.StatusUnsupportedMediaType},
	{"employeephoto.ErrNoStorage", employeephoto.ErrNoStorage, http.StatusServiceUnavailable},
	{"document.ErrNotFound", document.ErrNotFound, http.StatusNotFound},
	{"document.ErrEmployeeNotFound", document.ErrEmployeeNotFound, http.StatusNotFound},
	{"document.ErrScanNotFound", document.ErrScanNotFound, http.StatusNotFound},
	{"document.ErrCopyTooLarge", document.ErrCopyTooLarge, http.StatusRequestEntityTooLarge},
	{"document.ErrCopyNotJPEG", document.ErrCopyNotJPEG, http.StatusUnsupportedMediaType},
	{"document.ErrNotConfigured", document.ErrNotConfigured, http.StatusServiceUnavailable},
	{"scan.ErrNotFound", scan.ErrNotFound, http.StatusNotFound},
	{"scan.ErrTooManyPages", scan.ErrTooManyPages, http.StatusRequestEntityTooLarge},
	{"scan.ErrPageTooLarge", scan.ErrPageTooLarge, http.StatusRequestEntityTooLarge},
	{"scan.ErrPageNotJPEG", scan.ErrPageNotJPEG, http.StatusUnsupportedMediaType},
	{"scan.ErrNotConfigured", scan.ErrNotConfigured, http.StatusServiceUnavailable},
	{"aiusage.ErrNoSecretsKey", aiusage.ErrNoSecretsKey, http.StatusServiceUnavailable},
	{"aiusage.ErrNoKey", aiusage.ErrNoKey, http.StatusConflict},
	{"aiusage.ErrKeyUnopenable", aiusage.ErrKeyUnopenable, http.StatusConflict},
	{"aiusage.ErrBudgetSpent", aiusage.ErrBudgetSpent, http.StatusTooManyRequests},
	{"aiusage.ErrNoPrices", aiusage.ErrNoPrices, http.StatusConflict},
	{"colour.ErrOff", colour.ErrOff, http.StatusConflict},
	{"colour.ErrTooOften", colour.ErrTooOften, http.StatusTooManyRequests},
	{"colour.ErrNotPortrait", colour.ErrNotPortrait, http.StatusUnsupportedMediaType},
	{"errKeyRefused", errKeyRefused, http.StatusBadRequest},
	{"user.ErrEmailTaken", user.ErrEmailTaken, http.StatusConflict},
	{"user.ErrLastAdministrator", user.ErrLastAdministrator, http.StatusConflict},
	{"role.ErrNameTaken", role.ErrNameTaken, http.StatusConflict},
	{"launcher.ErrSlugTaken", launcher.ErrSlugTaken, http.StatusConflict},
	{"role.ErrInUse", role.ErrInUse, http.StatusConflict},
	{"role.ErrBuiltIn", role.ErrBuiltIn, http.StatusConflict},
	{"employee.ErrCodeTaken", employee.ErrCodeTaken, http.StatusConflict},
	{"catalogue.ErrNameTaken", catalogue.ErrNameTaken, http.StatusConflict},
	{"supplier.ErrCodeTaken", supplier.ErrCodeTaken, http.StatusConflict},
	{"vaultdoc.ErrLocked", vaultdoc.ErrLocked, http.StatusConflict},
	{"vaultdoc.ErrHeld", vaultdoc.ErrHeld, http.StatusConflict},
	{"vaultdoc.ErrStale", vaultdoc.ErrStale, http.StatusConflict},
	{"vaulttemplate.ErrNameTaken", vaulttemplate.ErrNameTaken, http.StatusConflict},
	{"vaulttemplate.ErrNotPublished", vaulttemplate.ErrNotPublished, http.StatusConflict},
	{"vaulttemplate.ErrNoStorage", vaulttemplate.ErrNoStorage, http.StatusServiceUnavailable},
	{"vaulttemplate.ErrFileType", vaulttemplate.ErrFileType, http.StatusUnsupportedMediaType},
	{"vaulttemplate.ErrTooLarge", vaulttemplate.ErrTooLarge, http.StatusRequestEntityTooLarge},
	{"vaultdoc.ErrRenderFailed", vaultdoc.ErrRenderFailed, http.StatusUnprocessableEntity},
	{"vaultdoc.ErrSealed", vaultdoc.ErrSealed, http.StatusConflict},
	{"company.ErrCodeTaken", company.ErrCodeTaken, http.StatusConflict},
	{"company.ErrDefaultTaken", company.ErrDefaultTaken, http.StatusConflict},
	{"company.ErrIsDefault", company.ErrIsDefault, http.StatusConflict},
	{"company.ErrInUse", company.ErrInUse, http.StatusConflict},
	{"itemset.ErrNameTaken", itemset.ErrNameTaken, http.StatusConflict},
	{"order.ErrPriceMissing", order.ErrPriceMissing, http.StatusConflict},
	{"order.ErrItemUnavailable", order.ErrItemUnavailable, http.StatusConflict},
	{"order.ErrNotOrdered", order.ErrNotOrdered, http.StatusConflict},
	{"employee.ErrHoldsAssets", employee.ErrHoldsAssets, http.StatusConflict},
	{"employee.ErrMergePersonnel", employee.ErrMergePersonnel, http.StatusConflict},
	{"employee.ErrBothEmployed", employee.ErrBothEmployed, http.StatusConflict},
	{"employee.ErrEmployed", employee.ErrEmployed, http.StatusConflict},
	{"employee.ErrEnded", employee.ErrEnded, http.StatusConflict},
	{"employee.ErrOverlap", employee.ErrOverlap, http.StatusConflict},
	{"asset.ErrInventoryNoTaken", asset.ErrInventoryNoTaken, http.StatusConflict},
	{"asset.ErrSIMNoTaken", asset.ErrSIMNoTaken, http.StatusConflict},
	{"asset.ErrAlreadyGiven", asset.ErrAlreadyGiven, http.StatusConflict},
	{"asset.ErrBlocked", asset.ErrBlocked, http.StatusConflict},
	{"asset.ErrNotGiven", asset.ErrNotGiven, http.StatusConflict},
	{"asset.ErrAlreadyMarked", asset.ErrAlreadyMarked, http.StatusConflict},
	{"asset.ErrFormChanged", asset.ErrFormChanged, http.StatusConflict},
	{"document.ErrDuplicate", document.ErrDuplicate, http.StatusConflict},
	{"document.ErrEmployeeCodeTaken", document.ErrEmployeeCodeTaken, http.StatusConflict},
	{"order.ErrLinkExpired", order.ErrLinkExpired, http.StatusGone},
	{"share.ErrGone", share.ErrGone, http.StatusGone},
	{"user.ErrInvalid", user.ErrInvalid, http.StatusBadRequest},
	{"role.ErrInvalid", role.ErrInvalid, http.StatusBadRequest},
	{"session.ErrInvalid", session.ErrInvalid, http.StatusBadRequest},
	{"employee.ErrInvalid", employee.ErrInvalid, http.StatusBadRequest},
	{"employee.ErrCompanyNotFound", employee.ErrCompanyNotFound, http.StatusBadRequest},
	{"catalogue.ErrInvalid", catalogue.ErrInvalid, http.StatusBadRequest},
	{"supplier.ErrInvalid", supplier.ErrInvalid, http.StatusBadRequest},
	{"vaultdoc.ErrInvalid", vaultdoc.ErrInvalid, http.StatusBadRequest},
	{"vaulttemplate.ErrInvalid", vaulttemplate.ErrInvalid, http.StatusBadRequest},
	{"share.ErrInvalid", share.ErrInvalid, http.StatusBadRequest},
	{"company.ErrInvalid", company.ErrInvalid, http.StatusBadRequest},
	{"itemset.ErrInvalid", itemset.ErrInvalid, http.StatusBadRequest},
	{"itemset.ErrUnknownItem", itemset.ErrUnknownItem, http.StatusBadRequest},
	{"order.ErrInvalid", order.ErrInvalid, http.StatusBadRequest},
	{"dashboard.ErrInvalid", dashboard.ErrInvalid, http.StatusBadRequest},
	{"settings.ErrInvalid", settings.ErrInvalid, http.StatusBadRequest},
	{"mailtemplate.ErrInvalid", mailtemplate.ErrInvalid, http.StatusBadRequest},
	{"launcher.ErrInvalid", launcher.ErrInvalid, http.StatusBadRequest},
	{"audit.ErrInvalid", audit.ErrInvalid, http.StatusBadRequest},
	{"security.ErrInvalid", security.ErrInvalid, http.StatusBadRequest},
	{"asset.ErrInvalid", asset.ErrInvalid, http.StatusBadRequest},
	{"employeephoto.ErrInvalid", employeephoto.ErrInvalid, http.StatusBadRequest},
	{"document.ErrInvalid", document.ErrInvalid, http.StatusBadRequest},
	{"scan.ErrInvalid", scan.ErrInvalid, http.StatusBadRequest},
	{"aiusage.ErrInvalid", aiusage.ErrInvalid, http.StatusBadRequest},
	{"system.ErrNotFound", system.ErrNotFound, http.StatusNotFound},
	{"system.ErrInvalid", system.ErrInvalid, http.StatusBadRequest},
}

// TestErrorCodes: every sentinel's answer names its own code, `<area>.<name>`
// in snake case, except a 401's, whose body stays the fixed "unauthenticated".
func TestErrorCodes(t *testing.T) {
	codeShape := regexp.MustCompile(`^[a-z][a-z_]*\.[a-z][a-z0-9_]*$`)
	seen := map[string]string{}
	for _, tc := range errorStatusCases {
		code := apperr.CodeOf(tc.err)
		if !codeShape.MatchString(code) {
			t.Errorf("%s: code %q", tc.name, code)
		}
		if other, ok := seen[code]; ok {
			t.Errorf("%s and %s share the code %q", tc.name, other, code)
		}
		seen[code] = tc.name
		rec := httptest.NewRecorder()
		writeError(rec, httptest.NewRequest(http.MethodGet, "/", nil), fmt.Errorf("%w: x", tc.err))
		var body errorBody
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		want := code
		if tc.status == http.StatusUnauthorized {
			want = ""
		}
		if body.Code != want {
			t.Errorf("%s: answered code %q, want %q", tc.name, body.Code, want)
		}
	}
	// An unrecognised error is an opaque 500 without a code.
	rec := httptest.NewRecorder()
	writeError(rec, httptest.NewRequest(http.MethodGet, "/", nil), errors.New("boom"))
	if rec.Code != http.StatusInternalServerError || strings.Contains(rec.Body.String(), `"code"`) {
		t.Errorf("500: %d %s", rec.Code, rec.Body.String())
	}
}

// TestErrorStatusesUnchanged answers each sentinel, bare and wrapped as
// fieldError wraps it, through writeError and checks its status and message.
func TestErrorStatusesUnchanged(t *testing.T) {
	for _, tc := range errorStatusCases {
		for _, err := range []error{tc.err, fmt.Errorf("%w: x", tc.err)} {
			rec := httptest.NewRecorder()
			writeError(rec, httptest.NewRequest(http.MethodGet, "/", nil), err)
			if rec.Code != tc.status {
				t.Errorf("%s (%v): status %d, want %d", tc.name, err, rec.Code, tc.status)
				continue
			}
			var body errorBody
			if jerr := json.Unmarshal(rec.Body.Bytes(), &body); jerr != nil {
				t.Fatalf("%s: body %q: %v", tc.name, rec.Body.String(), jerr)
			}
			want := err.Error()
			if tc.status == http.StatusUnauthorized {
				want = "unauthenticated"
			}
			if body.Error != want {
				t.Errorf("%s: error %q, want %q", tc.name, body.Error, want)
			}
		}
	}
}
