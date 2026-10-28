package main

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/asset"
	"github.com/remisb/ppe-next2/internal/domain/catalogue"
	"github.com/remisb/ppe-next2/internal/domain/employee"
	"github.com/remisb/ppe-next2/internal/domain/itemset"
	"github.com/remisb/ppe-next2/internal/domain/mailtemplate"
	"github.com/remisb/ppe-next2/internal/domain/order"
	"github.com/remisb/ppe-next2/internal/domain/session"
	"github.com/remisb/ppe-next2/internal/domain/settings"
	"github.com/remisb/ppe-next2/internal/domain/user"
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
	return order.EmployeeView{ID: e.ID, FirstName: e.FirstName, LastName: e.LastName, Code: e.Code, Sizes: e.Sizes(),
		PreferredLanguage: e.PreferredLanguage}, nil
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
			ID: i.ID, Name: i.Name, Details: i.Details, SizeGroup: i.SizeGroup,
			PurchasePriceCents: i.PurchasePriceCents, AccountingPriceCents: i.AccountingPriceCents, Currency: i.Currency, ServicePeriodMonths: i.ServicePeriodMonths, Active: i.Active,
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

// userSessions answers user.Sessions: the user service ends sign-ins when a
// password changes or an account is deactivated or deleted. Its End* reasons
// are the session service's.
type userSessions struct{ sessions *session.Service }

var _ user.Sessions = userSessions{}

func (u userSessions) EndAll(ctx context.Context, userID, keep uuid.UUID, reason string) error {
	return u.sessions.EndAll(ctx, userID, keep, reason)
}

// employeeHoldings answers employee.Holdings: Delete employee refuses an
// employee who holds company assets.
type employeeHoldings struct{ assets *asset.Service }

var _ employee.Holdings = employeeHoldings{}

func (e employeeHoldings) HeldBy(ctx context.Context, employeeID uuid.UUID) ([]string, error) {
	return e.assets.HeldBy(ctx, employeeID)
}

// assetMailer answers asset.Mailer: a SIM card's email from its mail
// template, with the provider's e-mail, the provider's default plan for a card
// without one, and the company's name from Settings, and the name and e-mail
// of the user preparing it.
type assetMailer struct {
	templates *mailtemplate.Service
	settings  *settings.Service
	users     *user.Service
}

var _ asset.Mailer = assetMailer{}

// simEmailKeys are the mail templates of a SIM card's emails.
var simEmailKeys = map[asset.EmailKind]string{
	asset.EmailActivation: mailtemplate.KeySIMActivation,
	asset.EmailBlocking:   mailtemplate.KeySIMBlocking,
}

func (m assetMailer) SIMEmail(ctx context.Context, kind asset.EmailKind, card asset.EmailCard) (asset.Email, error) {
	key, ok := simEmailKeys[kind]
	if !ok {
		return asset.Email{}, fmt.Errorf("no mail template for a SIM card's %s email", kind)
	}
	prefs, err := m.settings.Get(ctx)
	if err != nil {
		return asset.Email{}, err
	}
	provider, _ := prefs.Provider(card.Provider)
	// A card without a plan of its own gets its provider's when it is given (Give SIM), so the email names that one.
	plan := card.Plan
	if plan == "" {
		plan = provider.DefaultPlan
	}
	u, err := m.users.Get(ctx, card.Actor)
	if err != nil && !errors.Is(err, user.ErrNotFound) {
		return asset.Email{}, err
	}
	msg, err := m.templates.Render(ctx, key, map[string]string{
		mailtemplate.FieldSIMNumber:       card.SIMNumber,
		mailtemplate.FieldPhoneNumber:     card.PhoneNumber,
		mailtemplate.FieldInventoryNumber: card.InventoryNumber,
		mailtemplate.FieldPlan:            plan,
		mailtemplate.FieldProviderName:    card.Provider,
		mailtemplate.FieldProviderEmail:   provider.Email,
		mailtemplate.FieldEmployeeName:    card.EmployeeName,
		mailtemplate.FieldCompanyName:     prefs.CompanyName,
		mailtemplate.FieldUserName:        u.Name,
		mailtemplate.FieldUserEmail:       u.Email,
		mailtemplate.FieldToday:           card.Today,
	})
	if err != nil {
		return asset.Email{}, err
	}
	return asset.Email{To: msg.To, CC: msg.CC, Subject: msg.Subject, Body: msg.Body, Missing: msg.Missing}, nil
}
