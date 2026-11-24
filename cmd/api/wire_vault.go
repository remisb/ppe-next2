package main

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/asset"
	"github.com/remisb/ppe-next2/internal/domain/company"
	"github.com/remisb/ppe-next2/internal/domain/employee"
	"github.com/remisb/ppe-next2/internal/domain/role"
	"github.com/remisb/ppe-next2/internal/domain/supplier"
	"github.com/remisb/ppe-next2/internal/files"
	"github.com/remisb/ppe-next2/internal/vault"
	vaultdoc "github.com/remisb/ppe-next2/internal/vault/document"
)

// The Document Vault's adapters (ADR 0008): the ports internal/vault declares,
// answered by the other contexts' services, so the vault imports none of them.

// newVault is the document service over repo, its links described by svc's
// services and its files kept in store.
func newVault(svc services, repo vaultdoc.Repository, store files.Store) *vaultdoc.Service {
	subjects := vaultSubjects{employees: svc.employees, companies: svc.companies, assets: svc.assets, suppliers: svc.suppliers}
	return vaultdoc.NewService(repo, subjects, vaultdoc.WithFiles(store))
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
