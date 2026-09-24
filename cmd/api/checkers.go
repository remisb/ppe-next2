package main

import (
	"context"
	"errors"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/catalogue"
	"github.com/remisb/ppe-next2/internal/domain/employee"
	"github.com/remisb/ppe-next2/internal/domain/itemset"
	"github.com/remisb/ppe-next2/internal/domain/order"
)

// Adapters answering one domain's consumer-declared interfaces with another
// domain's service, so no domain package imports another.

// catalogueChecker answers itemset.CatalogueChecker.
type catalogueChecker struct{ items *catalogue.Service }

var _ itemset.CatalogueChecker = catalogueChecker{}

func (c catalogueChecker) MissingItems(ctx context.Context, ids []uuid.UUID) ([]uuid.UUID, error) {
	var missing []uuid.UUID
	for _, id := range ids {
		_, err := c.items.Get(ctx, id)
		switch {
		case errors.Is(err, catalogue.ErrNotFound):
			missing = append(missing, id)
		case err != nil:
			return nil, err
		}
	}
	return missing, nil
}

// orderEmployees answers order.EmployeeReader.
type orderEmployees struct{ employees *employee.Service }

var _ order.EmployeeReader = orderEmployees{}

func (o orderEmployees) Employee(ctx context.Context, id uuid.UUID) (order.EmployeeView, error) {
	e, err := o.employees.Get(ctx, id)
	if errors.Is(err, employee.ErrNotFound) {
		return order.EmployeeView{}, order.ErrEmployeeNotFound
	}
	if err != nil {
		return order.EmployeeView{}, err
	}
	return order.EmployeeView{ID: e.ID, FirstName: e.FirstName, LastName: e.LastName, Code: e.Code, Sizes: e.Sizes()}, nil
}

// orderCatalogue answers order.CatalogueReader.
type orderCatalogue struct{ items *catalogue.Service }

var _ order.CatalogueReader = orderCatalogue{}

func (o orderCatalogue) Items(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]order.ItemView, error) {
	out := make(map[uuid.UUID]order.ItemView, len(ids))
	for _, id := range ids {
		i, err := o.items.Get(ctx, id)
		if errors.Is(err, catalogue.ErrNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		out[id] = order.ItemView{
			ID: i.ID, Name: i.Name, Details: i.Details, SizeGroup: i.SizeGroup, UnitPriceCents: i.UnitPriceCents,
			Currency: i.Currency, ServicePeriodMonths: i.ServicePeriodMonths, Active: i.Active,
		}
	}
	return out, nil
}

// orderItemSets answers order.ItemSetReader. Inactive sets are not offered in
// the selector, so applying one is treated as not found.
type orderItemSets struct{ sets *itemset.Service }

var _ order.ItemSetReader = orderItemSets{}

func (o orderItemSets) ActiveSetLines(ctx context.Context, id uuid.UUID) ([]order.SetLineView, error) {
	s, err := o.sets.Get(ctx, id)
	if errors.Is(err, itemset.ErrNotFound) || (err == nil && !s.Active) {
		return nil, order.ErrItemSetNotFound
	}
	if err != nil {
		return nil, err
	}
	out := make([]order.SetLineView, len(s.Lines))
	for i, l := range s.Lines {
		out[i] = order.SetLineView{CatalogueItemID: l.CatalogueItemID, DefaultQuantity: l.DefaultQuantity}
	}
	return out, nil
}
