package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/domain/asset"
	"github.com/remisb/ppe-next2/internal/domain/company"
	"github.com/remisb/ppe-next2/internal/domain/employee"
	"github.com/remisb/ppe-next2/internal/domain/order"
	"github.com/remisb/ppe-next2/internal/domain/role"
	"github.com/remisb/ppe-next2/internal/domain/supplier"
	"github.com/remisb/ppe-next2/internal/domain/user"
	"github.com/remisb/ppe-next2/internal/files"
	"github.com/remisb/ppe-next2/internal/formpdf"
	"github.com/remisb/ppe-next2/internal/personnel/document"
	"github.com/remisb/ppe-next2/internal/recordpdf"
	"github.com/remisb/ppe-next2/internal/sealbox"
	"github.com/remisb/ppe-next2/internal/vault"
	vaultdoc "github.com/remisb/ppe-next2/internal/vault/document"
)

// The Document Vault's adapters (ADR 0008): the ports internal/vault declares,
// answered by the other contexts' services, so the vault imports none of them.

// newVault is the document service over repo, its links described by svc's
// services and its files kept in store.
func newVault(svc services, repo vaultdoc.Repository, store files.Store, keys *sealbox.Keyring, loc *time.Location) *vaultdoc.Service {
	subjects := vaultSubjects{employees: svc.employees, companies: svc.companies, assets: svc.assets, suppliers: svc.suppliers, orders: svc.orders}
	opts := []vaultdoc.Option{vaultdoc.WithFiles(store), vaultdoc.WithEmployments(vaultEmployments{svc.employees}), vaultdoc.WithLocation(loc),
		vaultdoc.WithGeneration(svc.docTemplates, vaultPeople{employees: svc.employees, companies: svc.companies}, vaultUsers{svc.users}),
		vaultdoc.WithRecords(vaultRecords{assets: svc.assets, orders: svc.orders, loc: loc})}
	if keys != nil {
		opts = append(opts, vaultdoc.WithKeys(keys))
	}
	if svc.documents != nil {
		// Personnel files' identity documents, listed beside an employee's (phase 7).
		opts = append(opts, vaultdoc.WithIdentityDocuments(vaultIdentity{svc.documents}))
	}
	v := vaultdoc.NewService(repo, subjects, opts...)
	archiver := vaultArchiver{v}
	if svc.assets != nil {
		// Company Assets keeps its signed copies here (phase 5), and its
		// stored forms are archived here (phase 6).
		asset.WithSignedForms(assetSignedForms{v})(svc.assets)
		asset.WithArchiver(archiver)(svc.assets)
	}
	if svc.orders != nil {
		// Given orders' Items Given Records are archived here (phase 6).
		order.WithArchiver(archiver)(svc.orders)
	}
	return v
}

// vaultArchiver answers asset.Archiver and order.Archiver: after a domain's
// commit it queues the record's archiving (vault.archive), best effort. What
// it fails to queue the upkeep's sweep (sweepArchives) finds.
type vaultArchiver struct{ vault *vaultdoc.Service }

var (
	_ asset.Archiver = vaultArchiver{}
	_ order.Archiver = vaultArchiver{}
)

func (a vaultArchiver) FormStored(ctx context.Context, id uuid.UUID) {
	a.queue(ctx, vault.AssignmentFormType, id)
}
func (a vaultArchiver) RecordGiven(ctx context.Context, id uuid.UUID) {
	a.queue(ctx, vault.OrderRecordType, id)
}

func (a vaultArchiver) queue(ctx context.Context, key string, id uuid.UUID) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if _, err := a.vault.QueueArchives(ctx, key, []uuid.UUID{id}); err != nil {
		slog.Default().WarnContext(ctx, "archiving not queued: the upkeep's sweep will queue it",
			slog.String("type", key), slog.String("record", id.String()), slog.Any("error", err))
	}
}

// vaultRecords answers vaultdoc.Records: Company Assets' stored forms drawn
// by formpdf and given orders' Items Given Records drawn by recordpdf, each
// with the hash its domain stored, named and linked as their lists name them.
type vaultRecords struct {
	assets *asset.Service
	orders *order.Service
	loc    *time.Location
}

var _ vaultdoc.Records = vaultRecords{}

func (v vaultRecords) Record(ctx context.Context, source string, id uuid.UUID) (vaultdoc.Record, error) {
	switch source {
	case vault.SourceAssignment:
		f, err := v.assets.StoredForm(ctx, id)
		if errors.Is(err, asset.ErrNotFound) {
			return vaultdoc.Record{}, vaultdoc.ErrNotFound
		}
		if err != nil {
			return vaultdoc.Record{}, err
		}
		if !f.Matches() {
			return vaultdoc.Record{}, fmt.Errorf("assignment %s: its stored form does not match its document hash", id)
		}
		pdf, err := formpdf.Render(f.Form, f.StoredHash)
		if err != nil {
			return vaultdoc.Record{}, err
		}
		given := f.Assignment.GivenDate
		return vaultdoc.Record{
			// Named as its signed copies' document is (assetSignedForms).
			Title: f.Asset.InventoryNo + " · " + given, DocumentDate: &given,
			Links: []vaultdoc.Link{
				{Kind: vault.Asset, ID: f.Asset.ID, Label: assetLabel(f.Asset), Requires: []string{string(assetSight(f.Asset.Kind))}},
				{Kind: vault.Employee, ID: f.Assignment.EmployeeID, Label: f.Assignment.EmployeeName},
			},
			FileName: formpdf.Filename(f.Form), PDF: pdf, DocumentHash: f.StoredHash, Actor: f.Assignment.GivenByUserID,
		}, nil
	case vault.SourceOrder:
		rec, err := v.givenRecord(ctx, id)
		if err != nil {
			return vaultdoc.Record{}, err
		}
		pdf, err := recordpdf.Render(rec, v.loc)
		if err != nil {
			return vaultdoc.Record{}, err
		}
		number := rec.Receipt.RecordNumber
		given := rec.Order.GivenAt.In(v.loc).Format(time.DateOnly)
		return vaultdoc.Record{
			Title: number + " · " + given, Number: &number, DocumentDate: &given,
			Links: []vaultdoc.Link{
				{Kind: vault.Order, ID: rec.Order.ID, Label: number},
				{Kind: vault.Employee, ID: rec.Order.EmployeeID, Label: rec.Receipt.EmployeeFirstName + " " + rec.Receipt.EmployeeLastName},
			},
			FileName: recordpdf.Filename(rec), PDF: pdf, DocumentHash: rec.DocumentHash, Actor: *rec.Order.GivenByUserID,
		}, nil
	}
	return vaultdoc.Record{}, fmt.Errorf("vault: no records of %q", source)
}

func (v vaultRecords) Hash(ctx context.Context, source string, id uuid.UUID) (string, error) {
	switch source {
	case vault.SourceAssignment:
		f, err := v.assets.StoredForm(ctx, id)
		if errors.Is(err, asset.ErrNotFound) {
			return "", vaultdoc.ErrNotFound
		}
		return f.DocumentHash, err
	case vault.SourceOrder:
		rec, err := v.givenRecord(ctx, id)
		if err != nil {
			return "", err
		}
		// The receipt built again from the order's snapshot, hashed again.
		return order.DocumentHash(rec.Receipt), nil
	}
	return "", fmt.Errorf("vault: no records of %q", source)
}

// Ended is when a record's retention starts: an assignment's return (its form
// and its signed copies), or the end of a given order's longest service
// period (VAD 2.30); not ended while the asset is held, the order not given,
// or the record gone.
func (v vaultRecords) Ended(ctx context.Context, source string, id uuid.UUID) (string, bool, error) {
	switch source {
	case vault.SourceAssignment, vault.SourceSignedForm:
		f, err := v.assets.StoredForm(ctx, id)
		if errors.Is(err, asset.ErrNotFound) {
			return "", false, nil
		}
		if err != nil || f.Assignment.ReturnedDate == nil {
			return "", false, err
		}
		return *f.Assignment.ReturnedDate, true, nil
	case vault.SourceOrder:
		rec, err := v.givenRecord(ctx, id)
		if errors.Is(err, vaultdoc.ErrNotFound) {
			return "", false, nil
		}
		if err != nil {
			return "", false, err
		}
		longest := 0
		for _, l := range rec.Order.Lines {
			longest = max(longest, l.ServicePeriodMonths)
		}
		return rec.Order.GivenAt.In(v.loc).AddDate(0, longest, 0).Format(time.DateOnly), true, nil
	}
	return "", false, fmt.Errorf("vault: no records of %q", source)
}

// givenRecord is order id's record once given; vaultdoc.ErrNotFound for an
// order deleted, missing or not given.
func (v vaultRecords) givenRecord(ctx context.Context, id uuid.UUID) (order.Record, error) {
	rec, err := v.orders.Record(ctx, id)
	if errors.Is(err, order.ErrNotFound) {
		return order.Record{}, vaultdoc.ErrNotFound
	}
	if err != nil {
		return order.Record{}, err
	}
	if rec.Order.Status != order.StatusGiven || rec.Order.GivenAt == nil || rec.Order.GivenByUserID == nil {
		return order.Record{}, vaultdoc.ErrNotFound
	}
	return rec, nil
}

// archiveSweep is what sweepArchives found: the records without their
// archived document, by type.
type archiveSweep struct {
	Forms   int
	Records int
}

// sweepArchives finds the stored forms and given orders since since (the
// zero time: all) that have no archived document yet and, with queue,
// queues their archiving (docs/specs/vault-service.md, "Archiving"): the
// upkeep sweeps the last week, -vault-backfill everything.
func sweepArchives(ctx context.Context, svc services, since time.Time, queue bool) (archiveSweep, error) {
	var out archiveSweep
	forms, err := svc.assets.FormsSince(ctx, since)
	if err != nil {
		return out, err
	}
	records, err := svc.orders.GivenSince(ctx, since)
	if err != nil {
		return out, err
	}
	for _, s := range []struct {
		key string
		ids []uuid.UUID
		n   *int
	}{{vault.AssignmentFormType, forms, &out.Forms}, {vault.OrderRecordType, records, &out.Records}} {
		missing, err := svc.vault.Unarchived(ctx, s.key, s.ids)
		if err != nil {
			return out, err
		}
		*s.n = len(missing)
		if queue && len(missing) > 0 {
			if _, err := svc.vault.QueueArchives(ctx, s.key, missing); err != nil {
				return out, err
			}
		}
	}
	return out, nil
}

// assetSignedForms answers asset.SignedForms from the vault: an assignment's
// signed copies are one document of type asset.signed_form, its source the
// assignment, each copy a version with the copy's id (migration 0065 moved the
// earlier ones in).
type assetSignedForms struct{ vault *vaultdoc.Service }

var _ asset.SignedForms = assetSignedForms{}

func (f assetSignedForms) Add(ctx context.Context, sf asset.SignedForm) (asset.SignedCopy, error) {
	a, as := sf.Asset, sf.Assignment
	given := as.GivenDate
	got, err := f.vault.AddSourced(ctx, vaultdoc.Sourced{
		Type: vault.SignedFormType, SourceID: as.ID,
		// Named and linked as migration 0065 names and links the ones it moved.
		Title: a.InventoryNo + " · " + as.GivenDate, DocumentDate: &given,
		Links: []vaultdoc.Link{
			{Kind: vault.Asset, ID: a.ID, Label: assetLabel(a), Requires: []string{string(assetSight(a.Kind))}},
			{Kind: vault.Employee, ID: as.EmployeeID, Label: as.EmployeeName},
		},
		FileID: sf.Copy.ID, Upload: vaultdoc.Upload{FileName: sf.Copy.FileName, Data: sf.Data}, Actor: sf.Copy.UploadedByUserID,
		Event: func(v vaultdoc.SourcedFile) (audit.Event, error) { return sf.Event(signedCopyOf(v)) },
	})
	if err != nil {
		return asset.SignedCopy{}, signedFormError(err)
	}
	return signedCopyOf(got), nil
}

func (f assetSignedForms) Of(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID][]asset.SignedCopy, error) {
	got, err := f.vault.SourcedFiles(ctx, vault.SignedFormType, ids)
	if err != nil {
		return nil, err
	}
	out := make(map[uuid.UUID][]asset.SignedCopy, len(got))
	for id, vs := range got {
		for _, v := range vs {
			out[id] = append(out[id], signedCopyOf(v))
		}
	}
	return out, nil
}

func (f assetSignedForms) Open(ctx context.Context, assignmentID, copyID uuid.UUID) (asset.SignedCopy, io.ReadCloser, error) {
	got, data, err := f.vault.OpenSourced(ctx, vault.SignedFormType, assignmentID, copyID)
	if err != nil {
		return asset.SignedCopy{}, nil, signedFormError(err)
	}
	return signedCopyOf(got), io.NopCloser(bytes.NewReader(data)), nil
}

func (f assetSignedForms) Holding(ctx context.Context) ([]uuid.UUID, error) {
	return f.vault.Sources(ctx, vault.SignedFormType)
}

// signedCopyOf is a vault version as Company Assets shows a signed copy.
func signedCopyOf(v vaultdoc.SourcedFile) asset.SignedCopy {
	return asset.SignedCopy{
		ID: v.ID, AssignmentID: v.SourceID, FileName: v.FileName, ContentType: v.ContentType, SizeBytes: v.SizeBytes,
		SHA256: v.SHA256, UploadedAt: v.CreatedAt, UploadedByUserID: v.CreatedByUserID, UploadedByName: v.CreatedByName,
	}
}

// signedFormError is the vault's refusal in Company Assets' words, so its
// routes answer as before.
func signedFormError(err error) error {
	switch {
	case errors.Is(err, vaultdoc.ErrNoStorage):
		return asset.ErrNoStorage
	case errors.Is(err, vaultdoc.ErrFileType):
		return asset.ErrFileType
	case errors.Is(err, vaultdoc.ErrTooLarge):
		return asset.ErrFileTooLarge
	case errors.Is(err, vaultdoc.ErrNotFound):
		return asset.ErrNotFound
	}
	return err
}

// vaultIdentity answers vaultdoc.IdentityDocuments from Personnel files
// (ADR 0008 decision 5): an employee's identity documents, metadata only.
// In full (personnel.documents.read) the superseded ones and issue dates
// too; else the current ones' kind, issuing state and expiry, which every
// signed-in user sees on the employee page (Validity).
type vaultIdentity struct{ documents *document.Service }

var _ vaultdoc.IdentityDocuments = vaultIdentity{}

func (v vaultIdentity) Of(ctx context.Context, employeeID uuid.UUID, full bool) ([]vaultdoc.IdentityDocument, error) {
	docs, err := v.documents.Documents(ctx, employeeID)
	if err != nil {
		return nil, err
	}
	out := make([]vaultdoc.IdentityDocument, 0, len(docs))
	for _, d := range docs {
		superseded := d.SupersededAt != nil
		if superseded && !full {
			continue
		}
		row := vaultdoc.IdentityDocument{ID: d.ID, Kind: string(d.Kind), IssuingState: d.IssuingState, ExpiresOn: d.ExpiresOn, Superseded: superseded}
		if full {
			row.IssuedOn = d.IssuedOn
		}
		out = append(out, row)
	}
	return out, nil
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
	orders    *order.Service
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
	case vault.Order:
		if s.orders == nil {
			return vaultdoc.SubjectInfo{}, vaultdoc.ErrSubjectNotFound
		}
		o, err := s.orders.Get(ctx, id)
		if err != nil {
			return missing(err, order.ErrNotFound)
		}
		return vaultdoc.SubjectInfo{Label: o.RecordNumber()}, nil
	}
	// Employments are linked by a later phase.
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
