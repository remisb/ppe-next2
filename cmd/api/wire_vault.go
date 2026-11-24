package main

import (
	"context"
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/asset"
	"github.com/remisb/ppe-next2/internal/domain/company"
	"github.com/remisb/ppe-next2/internal/domain/employee"
	"github.com/remisb/ppe-next2/internal/domain/role"
	"github.com/remisb/ppe-next2/internal/domain/supplier"
	"github.com/remisb/ppe-next2/internal/domain/user"
	"github.com/remisb/ppe-next2/internal/files"
	"github.com/remisb/ppe-next2/internal/sealbox"
	"github.com/remisb/ppe-next2/internal/vault"
	vaultdoc "github.com/remisb/ppe-next2/internal/vault/document"
)

// The Document Vault's adapters (ADR 0008): the ports internal/vault declares,
// answered by the other contexts' services, so the vault imports none of them.

// newVault is the document service over repo, its links described by svc's
// services and its files kept in store.
func newVault(svc services, repo vaultdoc.Repository, store files.Store, keys *sealbox.Keyring, loc *time.Location) *vaultdoc.Service {
	subjects := vaultSubjects{employees: svc.employees, companies: svc.companies, assets: svc.assets, suppliers: svc.suppliers}
	opts := []vaultdoc.Option{vaultdoc.WithFiles(store), vaultdoc.WithEmployments(vaultEmployments{svc.employees}), vaultdoc.WithLocation(loc),
		vaultdoc.WithGeneration(svc.docTemplates, vaultPeople{employees: svc.employees, companies: svc.companies}, vaultUsers{svc.users})}
	if keys != nil {
		opts = append(opts, vaultdoc.WithKeys(keys))
	}
	return vaultdoc.NewService(repo, subjects, opts...)
}

// vaultPeople answers vaultdoc.People: an employee's facts for a template's
// fields, with one of their employments and its company (the chosen one, else
// the open one, else the latest).
type vaultPeople struct {
	employees *employee.Service
	companies *company.Service
}

var _ vaultdoc.People = vaultPeople{}

func (p vaultPeople) Facts(ctx context.Context, id uuid.UUID, employmentID *uuid.UUID) (vaultdoc.Facts, error) {
	e, err := p.employees.Get(ctx, id)
	if errors.Is(err, employee.ErrNotFound) {
		return vaultdoc.Facts{}, vaultdoc.ErrSubjectNotFound
	}
	if err != nil {
		return vaultdoc.Facts{}, err
	}
	str := func(s *string) string {
		if s == nil {
			return ""
		}
		return *s
	}
	f := vaultdoc.Facts{EmployeeLabel: e.FullName(), Values: map[string]string{
		"employee.name": e.FullName(), "employee.first_name": e.FirstName, "employee.last_name": e.LastName,
		"employee.code": str(e.Code), "employee.birth_date": str(e.BirthDate), "employee.nationality": str(e.Nationality),
	}}
	job, ok := pickEmployment(e.Employments, employmentID)
	if employmentID != nil && !ok {
		return vaultdoc.Facts{}, vaultdoc.ErrSubjectNotFound
	}
	if !ok {
		return f, nil
	}
	f.Values["employment.from"], f.Values["employment.until"] = str(job.StartedOn), str(job.EndedOn)
	c, err := p.companies.Get(ctx, job.CompanyID)
	if errors.Is(err, company.ErrNotFound) {
		return f, nil
	}
	if err != nil {
		return vaultdoc.Facts{}, err
	}
	address := strings.Join(slices.DeleteFunc([]string{c.Address, strings.TrimSpace(c.PostalCode + " " + c.City)}, func(s string) bool { return s == "" }), ", ")
	f.Values["company.name"], f.Values["company.code"], f.Values["company.vat_code"], f.Values["company.address"] = c.Name, c.CompanyCode, c.VATCode, address
	f.CompanyID, f.CompanyLabel = &c.ID, c.Name
	return f, nil
}

// pickEmployment is the period with id, else the open one, else the latest started.
func pickEmployment(periods []employee.Employment, id *uuid.UUID) (employee.Employment, bool) {
	if id != nil {
		i := slices.IndexFunc(periods, func(p employee.Employment) bool { return p.ID == *id })
		if i < 0 {
			return employee.Employment{}, false
		}
		return periods[i], true
	}
	if i := slices.IndexFunc(periods, func(p employee.Employment) bool { return p.EndedOn == nil }); i >= 0 {
		return periods[i], true
	}
	if len(periods) == 0 {
		return employee.Employment{}, false
	}
	latest := periods[0]
	for _, p := range periods[1:] {
		if p.StartedOn != nil && (latest.StartedOn == nil || *p.StartedOn > *latest.StartedOn) {
			latest = p
		}
	}
	return latest, true
}

// vaultUsers answers vaultdoc.Users.
type vaultUsers struct{ users *user.Service }

func (u vaultUsers) Name(ctx context.Context, id uuid.UUID) (string, error) {
	got, err := u.users.Get(ctx, id)
	if err != nil {
		return "", err
	}
	return got.Name, nil
}

// vaultEmployments answers vaultdoc.Employments: when an employee's last
// employment ended. Employed now, never employed, or not found: not ended.
type vaultEmployments struct{ employees *employee.Service }

var _ vaultdoc.Employments = vaultEmployments{}

func (e vaultEmployments) EmploymentEnded(ctx context.Context, id uuid.UUID) (bool, string, error) {
	emp, err := e.employees.Get(ctx, id)
	if errors.Is(err, employee.ErrNotFound) {
		return false, "", nil
	}
	if err != nil {
		return false, "", err
	}
	return employmentEnded(emp.Employments)
}

// employmentEnded is whether periods have all ended, and the last day: false
// for none, or while one is open.
func employmentEnded(periods []employee.Employment) (bool, string, error) {
	last := ""
	for _, p := range periods {
		if p.EndedOn == nil {
			return false, "", nil
		}
		last = max(last, *p.EndedOn)
	}
	return last != "", last, nil
}

// vaultSubjects answers vaultdoc.Subjects: what a linked record is called and
// which permission a reader needs to see it.
type vaultSubjects struct {
	employees *employee.Service
	companies *company.Service
	assets    *asset.Service
	suppliers *supplier.Service
}

var _ vaultdoc.Subjects = vaultSubjects{}

func (s vaultSubjects) Describe(ctx context.Context, kind vault.SubjectKind, id uuid.UUID) (vaultdoc.SubjectInfo, error) {
	missing := func(err error, notFound error) (vaultdoc.SubjectInfo, error) {
		if errors.Is(err, notFound) {
			return vaultdoc.SubjectInfo{}, vaultdoc.ErrSubjectNotFound
		}
		return vaultdoc.SubjectInfo{}, err
	}
	switch kind {
	case vault.Employee:
		e, err := s.employees.Get(ctx, id)
		if err != nil {
			return missing(err, employee.ErrNotFound)
		}
		return vaultdoc.SubjectInfo{Label: e.FullName()}, nil
	case vault.Company:
		c, err := s.companies.Get(ctx, id)
		if err != nil {
			return missing(err, company.ErrNotFound)
		}
		return vaultdoc.SubjectInfo{Label: c.Name}, nil
	case vault.Supplier:
		sup, err := s.suppliers.Get(ctx, id)
		if err != nil {
			return missing(err, supplier.ErrNotFound)
		}
		return vaultdoc.SubjectInfo{Label: sup.Name}, nil
	case vault.Asset:
		a, err := s.assets.Get(ctx, id)
		if err != nil {
			return missing(err, asset.ErrNotFound)
		}
		return vaultdoc.SubjectInfo{Label: assetLabel(a.Asset), Requires: []string{string(assetSight(a.Kind))}}, nil
	}
	// Employments and orders are linked by later phases.
	return vaultdoc.SubjectInfo{}, vaultdoc.ErrSubjectNotFound
}

// assetSight is the permission that shows assets of kind k.
func assetSight(k asset.Kind) role.Permission {
	if k == asset.KindSIM {
		return role.SIMCardsRead
	}
	return role.EquipmentRead
}

// assetLabel names an asset as lists do: its inventory number, then its name
// or, for a SIM card, its phone number.
func assetLabel(a asset.Asset) string {
	parts := []string{a.InventoryNo}
	switch {
	case a.Name != nil && *a.Name != "":
		parts = append(parts, *a.Name)
	case a.PhoneNo != nil && *a.PhoneNo != "":
		parts = append(parts, *a.PhoneNo)
	}
	return strings.Join(parts, " ")
}
