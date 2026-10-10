package audit

import "slices"

// Area groups the record types on the Audit log's filter.
type Area string

const (
	AreaUsers     Area = "users" // users and roles
	AreaEmployees Area = "employees"
	AreaCatalogue Area = "catalogue"
	AreaItemSets  Area = "item_sets"
	AreaOrders    Area = "orders"
	AreaAssets    Area = "assets" // Company Assets
	AreaSettings  Area = "settings"
	AreaSecurity  Area = "security" // the access review
	AreaAudit     Area = "audit"    // the Audit log's own exports and purges
)

// The Audit log's own events: an export (audit.export) and a purge of events
// older than API_AUDIT_RETENTION.
const (
	EventExported = "audit.exported"
	EventPurged   = "audit.purged"
	// EntityLog is their entity type; each has an id of its own.
	EntityLog = "audit_log"
)

// areas lists every Area, in the Audit log filter's order, with the entity
// types written under it.
var areas = []struct {
	area     Area
	entities []string
}{
	{AreaUsers, []string{"user", "role"}},
	{AreaEmployees, []string{"employee"}},
	{AreaCatalogue, []string{"catalogue_item"}},
	{AreaItemSets, []string{"item_set"}},
	{AreaOrders, []string{"order"}},
	{AreaAssets, []string{"asset"}},
	{AreaSettings, []string{"settings"}},
	{AreaSecurity, []string{"access_review"}},
	{AreaAudit, []string{EntityLog}},
}

// events is every event name the domains write, in the Audit log filter's
// order. The names are the domains' own constants (employee.EventCreated …);
// TestEveryDomainEventIsKnown in cmd/api checks the two agree, and the web's
// event registry (@ppe/audit) describes the same list.
var events = []string{
	"user.created", "user.updated", "user.roles_changed", "user.activated", "user.deactivated",
	"user.password_changed", "user.password_reset", "user.deleted",
	"role.created", "role.updated", "role.deleted",
	"employee.created", "employee.updated", "employee.sizes_changed", "employee.deleted",
	"catalogue.created", "catalogue.updated", "catalogue.price_changed",
	"catalogue.activated", "catalogue.deactivated", "catalogue.deleted",
	"item_set.created", "item_set.updated", "item_set.deleted",
	"order.ordered", "order.confirmation_link_created", "order.confirmation_link_opened", "order.given", "order.deleted",
	"asset.registered", "asset.updated", "asset.status_changed", "asset.given", "asset.returned", "asset.marked_not_returned",
	"asset.signed_copy_uploaded", "asset.form_printed", "asset.blocking_email_prepared",
	"settings.supplier_chat_changed", "settings.default_sim_provider_changed",
	"access_review.completed",
	EventExported, EventPurged,
}

// Events returns every known event name.
func Events() []string { return slices.Clone(events) }

// Areas returns every Area in filter order.
func Areas() []Area {
	out := make([]Area, len(areas))
	for i, a := range areas {
		out[i] = a.area
	}
	return out
}

// IsEvent reports whether name is a known event.
func IsEvent(name string) bool { return slices.Contains(events, name) }

// AreaOf is the area of an entity type; "" for one no area lists.
func AreaOf(entityType string) Area {
	for _, a := range areas {
		if slices.Contains(a.entities, entityType) {
			return a.area
		}
	}
	return ""
}

// entitiesOf are the entity types of area; nil for an unknown one.
func entitiesOf(area Area) []string {
	for _, a := range areas {
		if a.area == area {
			return slices.Clone(a.entities)
		}
	}
	return nil
}
