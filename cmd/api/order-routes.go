package main

import (
	"net/http"
	"strconv"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/order"
	"github.com/remisb/ppe-next2/internal/domain/size"
)

type orderHandler struct {
	orders *order.Service
}

// registerOrderRoutes mounts the order endpoints. Resolution only reads;
// POST /orders is Mark as Ordered, the only way an order comes to exist.
// Staff who prepare orders (every role) may use all of them.
func registerOrderRoutes(rt *router, orders *order.Service) {
	h := &orderHandler{orders: orders}
	rt.authenticated("GET /api/v1/sizes", h.sizes)
	rt.authenticated("POST /api/v1/orders/resolve", h.resolve)
	rt.authenticated("GET /api/v1/item-sets/{id}/apply/{employeeID}", h.applyItemSet)
	rt.authenticated("GET /api/v1/orders", h.list)
	rt.authenticated("POST /api/v1/orders", h.markAsOrdered)
	rt.authenticated("GET /api/v1/orders/{id}", h.get)
}

type markAsOrderedRequest struct {
	EmployeeID uuid.UUID `json:"employee_id"`
	Lines      []struct {
		CatalogueItemID uuid.UUID `json:"catalogue_item_id"`
		Quantity        int       `json:"quantity"`
		Size            *string   `json:"size"`
	} `json:"lines"`
}

// orderJSON adds the derived record number and total to a stored order.
type orderJSON struct {
	order.Order
	RecordNumber string `json:"record_number"`
	TotalCents   int64  `json:"total_cents"`
}

func toOrderJSON(o order.Order) orderJSON {
	return orderJSON{Order: o, RecordNumber: o.RecordNumber(), TotalCents: o.TotalCents()}
}

// markAsOrdered is algorithm B. The body carries only employee, items,
// quantities and sizes; every other line value is copied from the catalogue
// inside the transaction.
func (h *orderHandler) markAsOrdered(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req markAsOrderedRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	lines := make([]order.LineParams, len(req.Lines))
	for i, l := range req.Lines {
		lines[i] = order.LineParams{CatalogueItemID: l.CatalogueItemID, Quantity: l.Quantity, Size: l.Size}
	}
	o, err := h.orders.MarkAsOrdered(r.Context(), order.MarkAsOrderedParams{EmployeeID: req.EmployeeID, Lines: lines}, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("Location", "/api/v1/orders/"+o.ID.String())
	writeJSON(w, http.StatusCreated, toOrderJSON(o))
}

func (h *orderHandler) get(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDPath(r, "id")
	if err != nil {
		writeError(w, r, err)
		return
	}
	o, err := h.orders.Get(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toOrderJSON(o))
}

type resolveRequest struct {
	EmployeeID uuid.UUID `json:"employee_id"`
	Lines      []struct {
		CatalogueItemID uuid.UUID `json:"catalogue_item_id"`
		Quantity        int       `json:"quantity"`
	} `json:"lines"`
}

type resolvedEmployeeJSON struct {
	ID           uuid.UUID `json:"id"`
	FirstName    string    `json:"first_name"`
	LastName     string    `json:"last_name"`
	FullName     string    `json:"full_name"`
	Code         *string   `json:"code"`
	HeightCm     *int      `json:"height_cm"`
	ClothingSize *string   `json:"clothing_size"`
	ShoeSize     *string   `json:"shoe_size"`
}

type resolutionJSON struct {
	Employee  resolvedEmployeeJSON `json:"employee"`
	Lines     []order.WorkingLine  `json:"lines"`
	Orderable bool                 `json:"orderable"`
}

func toResolutionJSON(r order.Resolution) resolutionJSON {
	e := r.Employee
	return resolutionJSON{
		Employee: resolvedEmployeeJSON{
			ID: e.ID, FirstName: e.FirstName, LastName: e.LastName, FullName: e.FirstName + " " + e.LastName,
			Code: e.Code, HeightCm: e.Sizes.HeightCm, ClothingSize: e.Sizes.ClothingSize, ShoeSize: e.Sizes.ShoeSize,
		},
		Lines:     r.Lines,
		Orderable: r.Orderable(),
	}
}

// sizes returns the size vocabulary for the inline size dropdowns.
func (h *orderHandler) sizes(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"clothing": size.Clothing(), "shoes": size.Shoes()})
}

// resolve is algorithm A: current sizes, prices and service periods for the
// working lines. Used by Add Item and when Assigned to changes.
func (h *orderHandler) resolve(w http.ResponseWriter, r *http.Request) {
	var req resolveRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	lines := make([]order.ResolveLine, len(req.Lines))
	for i, l := range req.Lines {
		lines[i] = order.ResolveLine{CatalogueItemID: l.CatalogueItemID, Quantity: l.Quantity}
	}
	res, err := h.orders.Resolve(r.Context(), req.EmployeeID, lines)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toResolutionJSON(res))
}

// applyItemSet is Apply Item Set: the set's lines resolved for the employee.
func (h *orderHandler) applyItemSet(w http.ResponseWriter, r *http.Request) {
	setID, err := parseUUIDPath(r, "id")
	if err != nil {
		writeError(w, r, err)
		return
	}
	employeeID, err := parseUUIDPath(r, "employeeID")
	if err != nil {
		writeError(w, r, err)
		return
	}
	res, err := h.orders.ApplyItemSet(r.Context(), setID, employeeID)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toResolutionJSON(res))
}

type listedOrderJSON struct {
	orderJSON
	UsageMonths *float64 `json:"usage_months"`
}

type orderPageJSON struct {
	Orders   []listedOrderJSON `json:"orders"`
	Page     int               `json:"page"`
	PageSize int               `json:"page_size"`
	Total    int               `json:"total"`
}

// historyParams are the only query parameters History accepts. Its filters
// combine freely, so they are query parameters rather than the nested path
// segments the domain contract uses elsewhere (a documented exception).
var historyParams = map[string]bool{"employee_id": true, "catalogue_item_id": true, "status": true, "from": true, "to": true, "sort": true, "dir": true, "page": true, "page_size": true}

// list is History: stored snapshots, newest activity first unless sorted.
//
//	GET /api/v1/orders?employee_id=&catalogue_item_id=&status=ORDERED|GIVEN&from=YYYY-MM-DD&to=YYYY-MM-DD
//	    &sort=date|record|employee|status|usage|total&dir=asc|desc&page=&page_size=
func (h *orderHandler) list(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	for k := range q {
		if !historyParams[k] {
			writeErrorMessage(w, http.StatusBadRequest, "unknown query parameter "+k)
			return
		}
	}
	var p order.ListParams
	if v := q.Get("employee_id"); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			writeError(w, r, errBadRequest)
			return
		}
		p.EmployeeID = &id
	}
	if v := q.Get("catalogue_item_id"); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			writeError(w, r, errBadRequest)
			return
		}
		p.CatalogueItemID = &id
	}
	p.Status, p.FromDate, p.ToDate = q.Get("status"), q.Get("from"), q.Get("to")
	p.Sort, p.Dir = q.Get("sort"), q.Get("dir")
	for _, n := range []struct {
		key string
		dst *int
	}{{"page", &p.Page}, {"page_size", &p.PageSize}} {
		if v := q.Get(n.key); v != "" {
			i, err := strconv.Atoi(v)
			if err != nil {
				writeError(w, r, errBadRequest)
				return
			}
			*n.dst = i
		}
	}
	res, err := h.orders.List(r.Context(), p)
	if err != nil {
		writeError(w, r, err)
		return
	}
	out := orderPageJSON{Orders: make([]listedOrderJSON, len(res.Orders)), Page: res.Page, PageSize: res.PageSize, Total: res.Total}
	for i, o := range res.Orders {
		out.Orders[i] = listedOrderJSON{orderJSON: toOrderJSON(o.Order), UsageMonths: o.UsageMonths}
	}
	writeJSON(w, http.StatusOK, out)
}
