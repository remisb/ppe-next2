package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/domain/asset"
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
// a shoe size, one without a clothing size), orders in every state, and
// company assets (SIM cards in each status, equipment and furniture, given,
// returned and one not returned), each made through the domain services as
// the seed admin.
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
		assets = asset.NewService(asset.NewPostgresRepository(pool), asset.WithLocation(loc), asset.WithClock(clock.now))
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

	s := seeder{ctx: ctx, actor: admin.ID, items: items, employees: employees, sets: sets, orders: orders, assets: assets,
		today: func() string { return clock.now().In(loc).Format(time.DateOnly) }}

	// Catalogue, in the manual's default order.
	// Purchase price, then accounting price, in cents.
	shoes := s.item("Safety shoes", "S3 SRC, steel toe cap", size.GroupShoes, ptr[int64](4200), 5490, 12, 10, catalogue.IconShoes)
	jacket := s.item("Work jacket", "Polyester/cotton, reflective strips", size.GroupClothing, ptr[int64](6150), 7900, 24, 20, catalogue.IconJacket)
	trousers := s.item("Work trousers", "Knee-pad pockets", size.GroupClothing, ptr[int64](3480), 4550, 12, 30, catalogue.IconTrousers)
	gloves := s.item("Protective gloves", "Nitrile-coated, pair", size.GroupNone, ptr[int64](245), 320, 1, 40, catalogue.IconGloves)
	helmet := s.item("Safety helmet", "EN 397, adjustable", size.GroupNone, ptr[int64](1390), 1800, 36, 50, catalogue.IconHelmet)
	vest := s.item("Hi-vis vest", "Class 2, yellow", size.GroupClothing, ptr[int64](720), 990, 12, 60, catalogue.IconVest)
	glasses := s.item("Safety glasses", "Anti-fog, clear lens", size.GroupNone, ptr[int64](480), 650, 12, 70, catalogue.IconGlasses)
	// No purchase price: optional, so it can still be ordered.
	s.item("Ear defenders", "SNR 30 dB", size.GroupNone, nil, 2200, 24, 80, catalogue.IconEar)
	// No prices or service period yet: selectable, but Mark as Ordered refuses it.
	s.itemWith(catalogue.Params{Name: "Winter jacket", Details: "Insulated, waterproof", SizeGroup: size.GroupClothing, Active: true, DisplayRank: ptr(90),
		Icon: catalogue.IconJacket})
	// Inactive: hidden from Add Item, still in old snapshots.
	s.itemWith(catalogue.Params{Name: "Rain coat", Details: "Discontinued model", SizeGroup: size.GroupClothing,
		AccountingPriceCents: ptr[int64](2500), ServicePeriodMonths: ptr(24), Active: false, DisplayRank: ptr(100), Icon: catalogue.IconJacket})

	starter := s.set("Warehouse starter kit", "Everything a new warehouse worker needs",
		shoes, 1, jacket, 1, trousers, 2, gloves, 10, helmet, 1)
	visitor := s.set("Visitor PPE", "Short-term site access",
		vest, 1, glasses, 1, helmet, 1)

	jonas := s.employee("Jonas", "Petraitis", "W-001", 184, 58, "43", "", "lt")
	ona := s.employee("Ona", "Kazlauskienė", "W-002", 165, 46, "39", "", "")
	tomas := s.employee("Tomas", "Jankauskas", "W-003", 190, 0, "45", "Clothing size not recorded yet; suggested from height", "")
	rasa := s.employee("Rasa", "Stankevičiūtė", "W-004", 171, 50, "", "Shoe size missing", "")
	mindaugas := s.employee("Mindaugas", "Vasiliauskas", "", 178, 54, "44", "", "")
	aleksandr := s.employee("Aleksandr", "Ivanov", "W-006", 189, 62, "46", "Prefers Russian", "ru")
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

	// Company Assets: SIM cards in each status and equipment, one record per
	// item, given on paper forms (furniture without one), one card returned and
	// then blocked, one not returned.
	clock.daysAgo(start, loc, 100)
	sim1 := s.sim("SIM-000001", "8937 0011 2233 4455 667", "+370 612 40118", "Telia", "Biz 10 GB", asset.StatusActive)
	sim2 := s.sim("SIM-000002", "8937 0011 2233 4455 668", "+370 612 40119", "Telia", "Biz 10 GB", asset.StatusActive)
	sim3 := s.sim("SIM-000003", "8937 0102 7788 1200 015", "+370 655 21987", "Bitė", "Verslas 20 GB", asset.StatusActive)
	sim4 := s.sim("SIM-000004", "8937 0102 7788 1200 016", "+370 655 21988", "Bitė", "Verslas 20 GB", asset.StatusActive)
	s.sim("SIM-000005", "8937 0011 2233 4455 669", "+370 612 40120", "Telia", "Biz 10 GB", asset.StatusActive)
	laptop := s.equipment("PC-000001", "Laptop Dell Latitude 5440", asset.CategoryComputer, "5CD3421K7Q", 90000)
	s.equipment("PC-000002", "Laptop Dell Latitude 5440", asset.CategoryComputer, "5CD3421K9T", 90000)
	phone := s.equipment("PH-000001", "Samsung Galaxy A55", asset.CategoryPhone, "R58X12AB34C", 35000)
	s.equipment("DRV-000001", "Backup drive 2 TB", asset.CategoryExternalDrive, "WX12A3456789", 9000)
	chair := s.equipment("FUR-000001", "Office chair", asset.CategoryFurniture, "", 0)
	s.equipment("FUR-000002", "Standing desk", asset.CategoryFurniture, "", 0)

	clock.daysAgo(start, loc, 95)
	s.give(sim1, jonas)
	s.give(laptop, jonas)
	clock.daysAgo(start, loc, 90)
	s.give(sim4, tomas)
	clock.daysAgo(start, loc, 60)
	s.give(sim3, mindaugas)
	clock.daysAgo(start, loc, 45)
	s.give(chair, ona)
	clock.daysAgo(start, loc, 30)
	s.give(sim2, aleksandr)
	s.give(phone, aleksandr)
	clock.daysAgo(start, loc, 25)
	s.giveBack(sim4)
	clock.daysAgo(start, loc, 24)
	s.status(sim4, asset.StatusBlocked)
	clock.daysAgo(start, loc, 3)
	s.notReturned(sim3, "Left without notice")
	clock.daysAgo(start, loc, 2)
	s.sim("SIM-000006", "8937 0203 5544 0099 001", "", "Tele2", "", asset.StatusNotActivated)
	if s.err != nil {
		return s.err
	}

	logger.Info("demo data seeded",
		slog.Int("catalogue_items", 10), slog.Int("item_sets", 2), slog.Int("employees", 6), slog.Int("orders", s.ordered),
		slog.Int("assets", s.assetCount),
		slog.String("without_shoe_size", rasa.FirstName+" "+rasa.LastName))
	return nil
}

// seeder makes each call as the admin and keeps the first error, so the
// script reads as a list of data rather than of error checks.
type seeder struct {
	ctx        context.Context
	actor      uuid.UUID
	items      *catalogue.Service
	employees  *employee.Service
	sets       *itemset.Service
	orders     *order.Service
	assets     *asset.Service
	today      func() string // the clock's day in the organisation's timezone
	ordered    int
	assetCount int
	err        error
}

func (s *seeder) fail(what string, err error) {
	if err != nil && s.err == nil {
		s.err = fmt.Errorf("seed %s: %w", what, err)
	}
}

func (s *seeder) item(name, details string, g size.Group, purchase *int64, cents int64, months, rank int, icon catalogue.Icon) uuid.UUID {
	return s.itemWith(catalogue.Params{Name: name, Details: details, SizeGroup: g, PurchasePriceCents: purchase,
		AccountingPriceCents: &cents, ServicePeriodMonths: &months, Active: true, DisplayRank: &rank, Icon: icon})
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

// employee adds an employee; a clothing size of 0, an empty shoe size and an
// empty language are not recorded.
func (s *seeder) employee(first, last, code string, heightCm, clothing int, shoe, notes, lang string) employee.Employee {
	if s.err != nil {
		return employee.Employee{}
	}
	e, err := s.employees.Create(s.ctx, employee.Params{
		FirstName: first, LastName: last, Code: optional(code), HeightCm: &heightCm,
		ClothingSize: optionalInt(clothing), ShoeSize: optional(shoe), Notes: notes, PreferredLanguage: optional(lang),
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

func optionalInt(n int) *int {
	if n == 0 {
		return nil
	}
	return &n
}

func ptr[T any](v T) *T { return &v }

// sim adds a SIM card; without a phone number it has no plan or value yet.
func (s *seeder) sim(number, simNo, phoneNo, provider, plan string, status asset.Status) asset.View {
	p := asset.Params{InventoryNo: number, SimNo: &simNo, Provider: &provider}
	if phoneNo != "" {
		p.PhoneNo, p.Plan, p.NonReturnValueCents = &phoneNo, &plan, ptr[int64](2500)
	}
	return s.addAsset(asset.CreateParams{Kind: asset.KindSIM, ConnectionStatus: &status, Params: p})
}

// equipment adds one item; furniture has no value, as it is given without a form.
func (s *seeder) equipment(number, name string, c asset.Category, serial string, valueCents int64) asset.View {
	p := asset.Params{InventoryNo: number, Name: &name, Category: &c, SerialNo: optional(serial)}
	if valueCents > 0 {
		p.NonReturnValueCents = &valueCents
	}
	return s.addAsset(asset.CreateParams{Kind: asset.KindEquipment, Params: p})
}

func (s *seeder) addAsset(p asset.CreateParams) asset.View {
	if s.err != nil {
		return asset.View{}
	}
	v, err := s.assets.Create(s.ctx, p, s.actor)
	s.fail("asset "+p.InventoryNo, err)
	s.assetCount++
	return v
}

// give gives the asset today, against its printed and signed form when it
// needs one, as Give does after Print Form.
func (s *seeder) give(a asset.View, e employee.Employee) {
	if s.err != nil {
		return
	}
	p := asset.GiveParams{FormParams: asset.FormParams{EmployeeID: e.ID, GivenDate: s.today()}}
	if a.NeedsForm {
		form, err := s.assets.Preview(s.ctx, a.ID, p.FormParams)
		if err != nil {
			s.fail("form for "+a.InventoryNo, err)
			return
		}
		p.PaperFormSigned, p.FormHash = true, form.DocumentHash
	}
	_, err := s.assets.Give(s.ctx, a.ID, p, s.actor)
	s.fail("give "+a.InventoryNo, err)
}

func (s *seeder) giveBack(a asset.View) {
	if s.err != nil {
		return
	}
	_, err := s.assets.Return(s.ctx, a.ID, asset.ReturnParams{}, s.actor)
	s.fail("return "+a.InventoryNo, err)
}

func (s *seeder) status(a asset.View, st asset.Status) {
	if s.err != nil {
		return
	}
	_, err := s.assets.ChangeStatus(s.ctx, a.ID, string(st), s.actor)
	s.fail("status of "+a.InventoryNo, err)
}

func (s *seeder) notReturned(a asset.View, comment string) {
	if s.err != nil {
		return
	}
	_, err := s.assets.MarkNotReturned(s.ctx, a.ID, asset.NotReturnedParams{Whereabouts: string(asset.WhereaboutsUnknown), Comment: comment}, s.actor)
	s.fail("not returned "+a.InventoryNo, err)
}
