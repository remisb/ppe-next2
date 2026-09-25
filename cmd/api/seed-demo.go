package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/domain/catalogue"
	"github.com/remisb/ppe-next2/internal/domain/employee"
	"github.com/remisb/ppe-next2/internal/domain/itemset"
	"github.com/remisb/ppe-next2/internal/domain/order"
	"github.com/remisb/ppe-next2/internal/domain/size"
	"github.com/remisb/ppe-next2/internal/domain/user"
)

// seedClock is the clock every seeding service reads. Moving it back lets the
// demo have a history (orders months old, with usage time) while every row
// still goes through the services: validation, audit events, snapshots and
// record numbers are the real ones.
type seedClock struct{ t time.Time }

func (c *seedClock) now() time.Time { return c.t }

// daysAgo sets the clock to n days before start, at 09:30 organisation time.
func (c *seedClock) daysAgo(start time.Time, loc *time.Location, n int) {
	d := start.In(loc).AddDate(0, 0, -n)
	c.t = time.Date(d.Year(), d.Month(), d.Day(), 9, 30, 0, 0, loc).UTC()
}

// seedDemo fills an empty development database with demo data: a catalogue
// (one item without a price, one inactive), item sets, employees (one without
// a shoe size, one without a clothing size) and orders in every state, each
// made through the domain services as the seed admin.
//
// It refuses a database that already has catalogue items or employees, so it
// can never mix demo rows into real ones; empty the database to re-seed.
func seedDemo(ctx context.Context, pool *pgxpool.Pool, users *user.Service, cfg config, loc *time.Location, logger *slog.Logger) error {
	admin, err := users.ByEmail(ctx, cfg.SeedUserEmail)
	if errors.Is(err, user.ErrNotFound) {
		return fmt.Errorf("seed admin %s not found: run -seed-admin first", cfg.SeedUserEmail)
	}
	if err != nil {
		return err
	}

	clock := &seedClock{}
	start := time.Now()
	clock.daysAgo(start, loc, 150)
	var (
		employees = employee.NewService(employee.NewPostgresRepository(pool), employee.WithClock(clock.now))
		items     = catalogue.NewService(catalogue.NewPostgresRepository(pool), catalogue.WithClock(clock.now))
		sets      = itemset.NewService(itemset.NewPostgresRepository(pool), catalogueChecker{items}, itemset.WithClock(clock.now))
		orders    = order.NewService(order.NewPostgresRepository(pool), order.Readers{
			Employees: orderEmployees{employees},
			Catalogue: orderCatalogue{items},
			ItemSets:  orderItemSets{sets},
		}, order.WithLocation(loc), order.WithConfirmTTL(cfg.ConfirmTTL), order.WithClock(clock.now))
	)

	existingItems, err := items.List(ctx)
	if err != nil {
		return err
	}
	existingEmployees, err := employees.List(ctx)
	if err != nil {
		return err
	}
	if len(existingItems) > 0 || len(existingEmployees) > 0 {
		return fmt.Errorf("refusing to seed: the database already has %d catalogue items and %d employees", len(existingItems), len(existingEmployees))
	}

	s := seeder{ctx: ctx, actor: admin.ID, items: items, employees: employees, sets: sets, orders: orders}

	// Catalogue, in the manual's default order.
	shoes := s.item("Safety shoes", "S3 SRC, steel toe cap", size.GroupShoes, 5490, 12, 10)
	jacket := s.item("Work jacket", "Polyester/cotton, reflective strips", size.GroupClothing, 7900, 24, 20)
	trousers := s.item("Work trousers", "Knee-pad pockets", size.GroupClothing, 4550, 12, 30)
	gloves := s.item("Protective gloves", "Nitrile-coated, pair", size.GroupNone, 320, 1, 40)
	helmet := s.item("Safety helmet", "EN 397, adjustable", size.GroupNone, 1800, 36, 50)
	vest := s.item("Hi-vis vest", "Class 2, yellow", size.GroupClothing, 990, 12, 60)
	glasses := s.item("Safety glasses", "Anti-fog, clear lens", size.GroupNone, 650, 12, 70)
	s.item("Ear defenders", "SNR 30 dB", size.GroupNone, 2200, 24, 80)
	// No price or service period yet: selectable, but Mark as Ordered refuses it.
	s.itemWith(catalogue.Params{Name: "Winter jacket", Details: "Insulated, waterproof", SizeGroup: size.GroupClothing, Active: true, DisplayRank: ptr(90)})
	// Inactive: hidden from Add Item, still in old snapshots.
	s.itemWith(catalogue.Params{Name: "Rain coat", Details: "Discontinued model", SizeGroup: size.GroupClothing,
		UnitPriceCents: ptr[int64](2500), ServicePeriodMonths: ptr(24), Active: false, DisplayRank: ptr(100)})

	starter := s.set("Warehouse starter kit", "Everything a new warehouse worker needs",
		shoes, 1, jacket, 1, trousers, 2, gloves, 10, helmet, 1)
	visitor := s.set("Visitor PPE", "Short-term site access",
		vest, 1, glasses, 1, helmet, 1)

	jonas := s.employee("Jonas", "Petraitis", "W-001", 184, "XL", "43", "")
	ona := s.employee("Ona", "Kazlauskienė", "W-002", 165, "S", "39", "")
	tomas := s.employee("Tomas", "Jankauskas", "W-003", 190, "", "45", "Clothing size not recorded yet; suggested from height")
	rasa := s.employee("Rasa", "Stankevičiūtė", "W-004", 171, "M", "", "Shoe size missing")
	mindaugas := s.employee("Mindaugas", "Vasiliauskas", "", 178, "L", "44", "")
	aleksandr := s.employee("Aleksandr", "Ivanov", "W-006", 189, "2XL", "46", "Prefers Russian")
	if s.err != nil {
		return s.err
	}

	// Orders, oldest first so record numbers follow the dates.
	clock.daysAgo(start, loc, 120)
	o := s.orderSet(jonas, starter)
	clock.daysAgo(start, loc, 115)
	s.givePaper(o)

	clock.daysAgo(start, loc, 60)
	o = s.orderLines(ona, shoes, 1, gloves, 10)
	clock.daysAgo(start, loc, 57)
	s.givePaper(o)

	clock.daysAgo(start, loc, 30)
	o = s.orderLines(mindaugas, jacket, 1, trousers, 2)
	clock.daysAgo(start, loc, 28)
	s.giveElectronic(o)

	clock.daysAgo(start, loc, 10)
	s.orderLines(aleksandr, jacket, 1, trousers, 2, shoes, 1)

	clock.daysAgo(start, loc, 2)
	s.orderSet(tomas, visitor)

	clock.daysAgo(start, loc, 1)
	s.orderLines(jonas, gloves, 10)
	if s.err != nil {
		return s.err
	}

	logger.Info("demo data seeded",
		slog.Int("catalogue_items", 10), slog.Int("item_sets", 2), slog.Int("employees", 6), slog.Int("orders", s.ordered),
		slog.String("without_shoe_size", rasa.FirstName+" "+rasa.LastName))
	return nil
}

// seeder makes each call as the admin and keeps the first error, so the
// script reads as a list of data rather than of error checks.
type seeder struct {
	ctx       context.Context
	actor     uuid.UUID
	items     *catalogue.Service
	employees *employee.Service
	sets      *itemset.Service
	orders    *order.Service
	ordered   int
	err       error
}

func (s *seeder) fail(what string, err error) {
	if err != nil && s.err == nil {
		s.err = fmt.Errorf("seed %s: %w", what, err)
	}
}

func (s *seeder) item(name, details string, g size.Group, cents int64, months, rank int) uuid.UUID {
	return s.itemWith(catalogue.Params{Name: name, Details: details, SizeGroup: g,
		UnitPriceCents: &cents, ServicePeriodMonths: &months, Active: true, DisplayRank: &rank})
}

func (s *seeder) itemWith(p catalogue.Params) uuid.UUID {
	if s.err != nil {
		return uuid.Nil
	}
	it, err := s.items.Create(s.ctx, p, s.actor)
	s.fail("catalogue item "+p.Name, err)
	return it.ID
}

// set takes item/quantity pairs.
func (s *seeder) set(name, description string, pairs ...any) uuid.UUID {
	if s.err != nil {
		return uuid.Nil
	}
	p := itemset.Params{Name: name, Description: description, Active: true}
	for i := 0; i < len(pairs); i += 2 {
		p.Lines = append(p.Lines, itemset.LineParams{CatalogueItemID: pairs[i].(uuid.UUID), DefaultQuantity: pairs[i+1].(int)})
	}
	set, err := s.sets.Create(s.ctx, p, s.actor)
	s.fail("item set "+name, err)
	return set.ID
}

func (s *seeder) employee(first, last, code string, heightCm int, clothing, shoe, notes string) employee.Employee {
	if s.err != nil {
		return employee.Employee{}
	}
	e, err := s.employees.Create(s.ctx, employee.Params{
		FirstName: first, LastName: last, Code: optional(code), HeightCm: &heightCm,
		ClothingSize: optional(clothing), ShoeSize: optional(shoe), Notes: notes,
	}, s.actor)
	s.fail("employee "+first+" "+last, err)
	return e
}

// orderSet applies an item set as Create Order does and marks it as ordered.
func (s *seeder) orderSet(e employee.Employee, setID uuid.UUID) uuid.UUID {
	if s.err != nil {
		return uuid.Nil
	}
	res, err := s.orders.ApplyItemSet(s.ctx, setID, e.ID)
	s.fail("apply item set", err)
	return s.markAsOrdered(e, res)
}

// orderLines resolves item/quantity pairs as Create Order does and marks them
// as ordered.
func (s *seeder) orderLines(e employee.Employee, pairs ...any) uuid.UUID {
	if s.err != nil {
		return uuid.Nil
	}
	var lines []order.ResolveLine
	for i := 0; i < len(pairs); i += 2 {
		lines = append(lines, order.ResolveLine{CatalogueItemID: pairs[i].(uuid.UUID), Quantity: pairs[i+1].(int)})
	}
	res, err := s.orders.Resolve(s.ctx, e.ID, lines)
	s.fail("resolve order", err)
	return s.markAsOrdered(e, res)
}

// markAsOrdered takes the resolved sizes, including suggestions from height,
// as a user accepting the form would.
func (s *seeder) markAsOrdered(e employee.Employee, res order.Resolution) uuid.UUID {
	if s.err != nil {
		return uuid.Nil
	}
	p := order.MarkAsOrderedParams{EmployeeID: e.ID}
	for _, l := range res.Lines {
		if l.SizeMissing || l.PriceMissing || l.Unavailable {
			s.fail("order for "+e.FirstName, fmt.Errorf("line %s is not orderable", l.ItemName))
			return uuid.Nil
		}
		p.Lines = append(p.Lines, order.LineParams{CatalogueItemID: l.CatalogueItemID, Quantity: l.Quantity, Size: l.Size})
	}
	o, err := s.orders.MarkAsOrdered(s.ctx, p, s.actor)
	s.fail("mark as ordered for "+e.FirstName, err)
	if err == nil {
		s.ordered++
	}
	return o.ID
}

func (s *seeder) givePaper(orderID uuid.UUID) {
	if s.err != nil {
		return
	}
	_, err := s.orders.ConfirmPaper(s.ctx, orderID, s.actor)
	s.fail("paper confirmation", err)
}

// giveElectronic confirms through a link, as the employee would on the public
// page. The token is used here and never printed.
func (s *seeder) giveElectronic(orderID uuid.UUID) {
	if s.err != nil {
		return
	}
	token, _, err := s.orders.CreateConfirmationLink(s.ctx, orderID, s.actor)
	if err != nil {
		s.fail("confirmation link", err)
		return
	}
	_, err = s.orders.ConfirmByToken(s.ctx, token, true)
	s.fail("electronic confirmation", err)
}

func optional(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func ptr[T any](v T) *T { return &v }
