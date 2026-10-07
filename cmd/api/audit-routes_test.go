package main

import (
	"slices"
	"testing"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/domain/catalogue"
	"github.com/remisb/ppe-next2/internal/domain/employee"
	"github.com/remisb/ppe-next2/internal/domain/itemset"
	"github.com/remisb/ppe-next2/internal/domain/order"
	"github.com/remisb/ppe-next2/internal/domain/role"
	"github.com/remisb/ppe-next2/internal/domain/settings"
	"github.com/remisb/ppe-next2/internal/domain/user"
	"github.com/remisb/ppe-next2/internal/security"
)

// TestEveryDomainEventIsKnown keeps audit's event catalogue, which the Audit
// log filters by and the apps describe, in step with what the domains write.
// A new event constant belongs both here and in audit.events.
func TestEveryDomainEventIsKnown(t *testing.T) {
	written := []string{
		user.EventCreated, user.EventUpdated, user.EventRolesChanged, user.EventActivated, user.EventDeactivated,
		user.EventPasswordChanged, user.EventPasswordReset, user.EventDeleted,
		role.EventCreated, role.EventUpdated, role.EventDeleted,
		employee.EventCreated, employee.EventUpdated, employee.EventSizesChanged, employee.EventDeleted,
		catalogue.EventCreated, catalogue.EventUpdated, catalogue.EventPriceChanged,
		catalogue.EventActivated, catalogue.EventDeactivated, catalogue.EventDeleted,
		itemset.EventCreated, itemset.EventUpdated, itemset.EventDeleted,
		order.EventOrdered, order.EventLinkCreated, order.EventGiven, order.EventDeleted,
		settings.EventSupplierChatChanged,
		security.EventAccessReviewCompleted,
	}
	if !slices.Equal(written, audit.Events()) {
		t.Errorf("the domains write %v, the catalogue lists %v", written, audit.Events())
	}
}

func TestAuditListRejectsUnknownParameters(t *testing.T) {
	api := newTestAPI(t)
	_, tok := api.userWith(t, role.KeyAdmin)
	for _, q := range []string{"?name=x", "?area=users&area=orders", "?actor=nope", "?area=payroll", "?after=zzz", "?page_size=x"} {
		if rec := api.do(t, "GET", "/api/v1/audit-events"+q, tok, nil); rec.Code != 400 {
			t.Errorf("%s: %d, want 400", q, rec.Code)
		}
	}
	if rec := api.do(t, "GET", "/api/v1/audit-events?area=users&page_size=10", tok, nil); rec.Code != 200 ||
		rec.Body.String() != "{\"events\":[],\"next\":null}\n" {
		t.Errorf("empty trail = %d %s", rec.Code, rec.Body)
	}
}
