package usage

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/audit"
)

// PostgresStore keeps user_activity and data_quality_samples (migration 0027)
// and reads the rest from the domains' tables.
type PostgresStore struct {
	pool *pgxpool.Pool
}

var _ Store = (*PostgresStore)(nil)

func NewPostgresStore(pool *pgxpool.Pool) *PostgresStore { return &PostgresStore{pool: pool} }

func (s *PostgresStore) RecordActivity(ctx context.Context, day time.Time, userID uuid.UUID, app string) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO user_activity (day, user_id, app) VALUES ($1::date, $2, $3)
		ON CONFLICT DO NOTHING`, day.Format(time.DateOnly), userID, app)
	return err
}

func (s *PostgresStore) PurgeActivity(ctx context.Context, before time.Time) (int64, error) {
	tag, err := s.pool.Exec(ctx, `DELETE FROM user_activity WHERE day < $1::date`, before.Format(time.DateOnly))
	return tag.RowsAffected(), err
}

func (s *PostgresStore) SampleQuality(ctx context.Context, q Quality) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO data_quality_samples (day, employees, employees_missing_sizes, catalogue_active, catalogue_unpriced, item_sets_active)
		VALUES ($1::date, $2, $3, $4, $5, $6)
		ON CONFLICT (day) DO UPDATE SET employees = EXCLUDED.employees,
			employees_missing_sizes = EXCLUDED.employees_missing_sizes, catalogue_active = EXCLUDED.catalogue_active,
			catalogue_unpriced = EXCLUDED.catalogue_unpriced, item_sets_active = EXCLUDED.item_sets_active`,
		q.Day.Format(time.DateOnly), q.Employees, q.EmployeesMissingSizes, q.CatalogueActive, q.CatalogueUnpriced, q.ItemSetsActive)
	return err
}

// series places (day, value) rows on the window's days.
type series struct {
	first time.Time
	n     int
}

func (sr series) index(day time.Time) int {
	d := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, time.UTC)
	f := time.Date(sr.first.Year(), sr.first.Month(), sr.first.Day(), 0, 0, 0, 0, time.UTC)
	i := int(d.Sub(f).Hours() / 24)
	if i < 0 || i >= sr.n {
		return -1
	}
	return i
}

func (s *PostgresStore) Read(ctx context.Context, w Window) (Report, error) {
	r := Report{
		Active:            Active{Total: make([]int, Days), ByApp: map[string][]int{}, ByRole: []RoleSeries{}},
		SignIns:           make([]int, Days),
		Failed:            make([]int, Days),
		Devices:           []Device{},
		UserLanguages:     map[string]int{},
		EmployeeLanguages: map[string]int{},
		Changes:           []AreaWeeks{},
		TopPeople:         []Person{},
		Quality:           []Quality{},
	}
	for _, app := range Apps {
		r.Active.ByApp[app] = make([]int, Days)
	}
	days := series{first: w.FirstDay, n: Days}
	first := w.FirstDay.Format(time.DateOnly)
	tz := w.Loc.String()

	err := pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		// Active people per day, in total and by app.
		if err := eachRow(ctx, tx, `SELECT day, NULL, count(DISTINCT user_id) FROM user_activity WHERE day >= $1::date GROUP BY day
			UNION ALL
			SELECT day, app, count(DISTINCT user_id) FROM user_activity WHERE day >= $1::date GROUP BY day, app`,
			[]any{first}, func(row pgx.Rows) error {
				var day time.Time
				var app *string
				var n int
				if err := row.Scan(&day, &app, &n); err != nil {
					return err
				}
				if i := days.index(day); i >= 0 {
					if app == nil {
						r.Active.Total[i] = n
					} else if v, ok := r.Active.ByApp[*app]; ok {
						v[i] = n
					}
				}
				return nil
			}); err != nil {
			return err
		}

		// By role, every live role, a person counted under each role they hold.
		byRole := map[uuid.UUID]int{}
		if err := eachRow(ctx, tx, `SELECT id, key, name FROM roles WHERE deleted_at IS NULL ORDER BY key NULLS LAST, lower(name)`, nil,
			func(row pgx.Rows) error {
				var role Role
				if err := row.Scan(&role.ID, &role.Key, &role.Name); err != nil {
					return err
				}
				byRole[role.ID] = len(r.Active.ByRole)
				r.Active.ByRole = append(r.Active.ByRole, RoleSeries{Role: role, Values: make([]int, Days)})
				return nil
			}); err != nil {
			return err
		}
		if err := eachRow(ctx, tx, `SELECT a.day, ur.role_id, count(DISTINCT a.user_id) FROM user_activity a
			JOIN user_roles ur ON ur.user_id = a.user_id WHERE a.day >= $1::date GROUP BY 1, 2`,
			[]any{first}, func(row pgx.Rows) error {
				var day time.Time
				var id uuid.UUID
				var n int
				if err := row.Scan(&day, &id, &n); err != nil {
					return err
				}
				if j, ok := byRole[id]; ok {
					if i := days.index(day); i >= 0 {
						r.Active.ByRole[j].Values[i] = n
					}
				}
				return nil
			}); err != nil {
			return err
		}
		last7 := w.FirstDay.AddDate(0, 0, Days-7).Format(time.DateOnly)
		if err := tx.QueryRow(ctx, `SELECT
				(SELECT count(DISTINCT user_id) FROM user_activity WHERE day >= $1::date),
				(SELECT count(DISTINCT user_id) FROM user_activity WHERE day >= $2::date),
				(SELECT count(*) FROM users WHERE deleted_at IS NULL AND is_active)`, last7, first).
			Scan(&r.Active.Last7, &r.Active.Last30, &r.Active.Users); err != nil {
			return err
		}

		// Sign-ins and failures per day, in the organisation's calendar.
		if err := eachRow(ctx, tx, `SELECT (occurred_at AT TIME ZONE $2)::date, kind, count(*) FROM auth_events
			WHERE kind IN ('sign_in', 'sign_in_failed') AND (occurred_at AT TIME ZONE $2)::date >= $1::date GROUP BY 1, 2`,
			[]any{first, tz}, func(row pgx.Rows) error {
				var day time.Time
				var kind string
				var n int
				if err := row.Scan(&day, &kind, &n); err != nil {
					return err
				}
				if i := days.index(day); i >= 0 {
					if kind == "sign_in" {
						r.SignIns[i] = n
					} else {
						r.Failed[i] = n
					}
				}
				return nil
			}); err != nil {
			return err
		}

		// Browsers used in the window, by the people using them.
		if err := eachRow(ctx, tx, `SELECT s.user_agent, count(DISTINCT s.user_id) FROM user_sessions s
			JOIN users u ON u.id = s.user_id AND u.deleted_at IS NULL
			WHERE s.last_used_at >= $1 GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT $2`,
			[]any{w.FirstDay, DeviceLimit}, func(row pgx.Rows) error {
				var d Device
				if err := row.Scan(&d.UserAgent, &d.People); err != nil {
					return err
				}
				r.Devices = append(r.Devices, d)
				return nil
			}); err != nil {
			return err
		}

		// Languages: users' interface, employees' preferred ("" for none).
		if err := eachRow(ctx, tx, `SELECT 'user', language, count(*) FROM users WHERE deleted_at IS NULL AND is_active GROUP BY 2
			UNION ALL
			SELECT 'employee', coalesce(preferred_language, ''), count(*) FROM employees WHERE deleted_at IS NULL GROUP BY 2`, nil,
			func(row pgx.Rows) error {
				var who, lang string
				var n int
				if err := row.Scan(&who, &lang, &n); err != nil {
					return err
				}
				if who == "user" {
					r.UserLanguages[lang] = n
				} else {
					r.EmployeeLanguages[lang] = n
				}
				return nil
			}); err != nil {
			return err
		}

		// Changes per area per week, and the most active people.
		weeks := series{first: w.FirstWeek, n: Weeks * 7}
		areaRow := map[string]int{}
		for _, a := range audit.Areas() {
			areaRow[string(a)] = len(r.Changes)
			r.Changes = append(r.Changes, AreaWeeks{Area: string(a), Counts: make([]int, Weeks)})
		}
		if err := eachRow(ctx, tx, `SELECT date_trunc('week', occurred_at AT TIME ZONE $2)::date, entity_type, count(*)
			FROM audit_events WHERE occurred_at >= $1 GROUP BY 1, 2`,
			[]any{w.FirstWeek, tz}, func(row pgx.Rows) error {
				var week time.Time
				var entity string
				var n int
				if err := row.Scan(&week, &entity, &n); err != nil {
					return err
				}
				j, ok := areaRow[string(audit.AreaOf(entity))]
				i := weeks.index(week)
				if ok && i >= 0 {
					// Weeks are seven days apart: the index counts days.
					r.Changes[j].Counts[i/7] += n
				}
				return nil
			}); err != nil {
			return err
		}
		if err := eachRow(ctx, tx, `SELECT a.actor_user_id, u.name, count(*) FROM audit_events a
			JOIN users u ON u.id = a.actor_user_id WHERE a.occurred_at >= $1
			GROUP BY 1, 2 ORDER BY 3 DESC, 2 LIMIT $2`, []any{w.FirstDay, TopPeople}, func(row pgx.Rows) error {
			var p Person
			if err := row.Scan(&p.ID, &p.Name, &p.Changes); err != nil {
				return err
			}
			r.TopPeople = append(r.TopPeople, p)
			return nil
		}); err != nil {
			return err
		}

		// The confirmation links created in the funnel's span, on orders not deleted.
		if err := tx.QueryRow(ctx, `SELECT count(*),
				count(*) FILTER (WHERE c.first_opened_at IS NOT NULL),
				count(*) FILTER (WHERE c.confirmed_at IS NOT NULL),
				count(*) FILTER (WHERE c.confirmed_at IS NULL AND c.revoked_at IS NULL AND c.expires_at > $2),
				count(*) FILTER (WHERE c.confirmed_at IS NULL AND c.revoked_at IS NULL AND c.expires_at <= $2),
				count(*) FILTER (WHERE c.confirmed_at IS NULL AND c.revoked_at IS NOT NULL)
			FROM order_confirmations c JOIN orders o ON o.id = c.order_id AND o.deleted_at IS NULL
			WHERE c.method = 'ELECTRONIC' AND c.created_at >= $1`, w.Now.AddDate(0, 0, -FunnelDays), w.Now).
			Scan(&r.Funnel.Created, &r.Funnel.Opened, &r.Funnel.Confirmed, &r.Funnel.Waiting, &r.Funnel.Expired, &r.Funnel.Replaced); err != nil {
			return err
		}

		return eachRow(ctx, tx, `SELECT day, employees, employees_missing_sizes, catalogue_active, catalogue_unpriced, item_sets_active
			FROM data_quality_samples WHERE day >= $1::date ORDER BY day`,
			[]any{w.Now.AddDate(0, 0, -QualityDays).Format(time.DateOnly)}, func(row pgx.Rows) error {
				var q Quality
				if err := row.Scan(&q.Day, &q.Employees, &q.EmployeesMissingSizes, &q.CatalogueActive, &q.CatalogueUnpriced, &q.ItemSetsActive); err != nil {
					return err
				}
				q.Day = time.Date(q.Day.Year(), q.Day.Month(), q.Day.Day(), 0, 0, 0, 0, time.UTC)
				r.Quality = append(r.Quality, q)
				return nil
			})
	})
	return r, err
}

func eachRow(ctx context.Context, tx pgx.Tx, sql string, args []any, f func(pgx.Rows) error) error {
	rows, err := tx.Query(ctx, sql, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		if err := f(rows); err != nil {
			return err
		}
	}
	return rows.Err()
}
