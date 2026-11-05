package aiusage

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/audit"
)

// PostgresStore keeps the ledger (ai_usage) and Settings → AI (ai_settings), migration 0051.
type PostgresStore struct {
	pool *pgxpool.Pool
}

var (
	_ Store         = (*PostgresStore)(nil)
	_ SettingsStore = (*PostgresStore)(nil)
)

func NewPostgresStore(pool *pgxpool.Pool) *PostgresStore { return &PostgresStore{pool: pool} }

func (p *PostgresStore) Insert(ctx context.Context, c Call) error {
	prices, err := json.Marshal(c.Prices)
	if err != nil {
		return err
	}
	var errorCode, providerID *string
	if c.ErrorCode != "" {
		errorCode = &c.ErrorCode
	}
	if c.ProviderRequestID != "" {
		providerID = &c.ProviderRequestID
	}
	source := c.Source
	if source == "" {
		source = string(audit.SourceSystem)
	}
	_, err = p.pool.Exec(ctx, `INSERT INTO ai_usage (id, at, operation, provider, model, outcome, error_code,
		input_text_tokens, input_image_tokens, output_text_tokens, output_image_tokens, cost_micro_usd, prices,
		duration_ms, user_id, source, request_id, provider_request_id, employee_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
		c.ID, c.At, c.Operation, c.Provider, c.Model, c.Outcome, errorCode,
		c.Tokens.InputText, c.Tokens.InputImage, c.Tokens.OutputText, c.Tokens.OutputImage, c.CostMicroUSD, prices,
		c.DurationMS, c.UserID, source, c.RequestID, providerID, c.EmployeeID)
	return err
}

func (p *PostgresStore) CostSince(ctx context.Context, from time.Time) (int64, error) {
	var sum int64
	err := p.pool.QueryRow(ctx, `SELECT coalesce(sum(cost_micro_usd), 0) FROM ai_usage WHERE at >= $1`, from).Scan(&sum)
	return sum, err
}

const settingsColumns = `enabled, model, quality, prices, budget_micro_usd, key_sealed, key_id, key_last4, key_set_at, key_set_by_user_id`

func scanSettings(row pgx.Row) (SettingsRow, error) {
	var r SettingsRow
	var prices []byte
	var keyID *int16
	var last4 *string
	var setAt *time.Time
	var setBy *uuid.UUID
	if err := row.Scan(&r.Enabled, &r.Model, &r.Quality, &prices, &r.BudgetMicroUSD, &r.SealedKey, &keyID, &last4, &setAt, &setBy); err != nil {
		return SettingsRow{}, err
	}
	if err := json.Unmarshal(prices, &r.Prices); err != nil {
		return SettingsRow{}, err
	}
	if keyID != nil && last4 != nil && setAt != nil && setBy != nil {
		r.KeyID = *keyID
		r.Key = &KeyInfo{Last4: *last4, SetAt: setAt.UTC(), SetByID: *setBy}
	}
	return r, nil
}

func (p *PostgresStore) Settings(ctx context.Context) (SettingsRow, bool, error) {
	r, err := scanSettings(p.pool.QueryRow(ctx, `SELECT `+settingsColumns+` FROM ai_settings`))
	if errors.Is(err, pgx.ErrNoRows) {
		return SettingsRow{}, false, nil
	}
	return r, err == nil, err
}

func (p *PostgresStore) UpdateSettings(ctx context.Context, mutate func(cur SettingsRow) (SettingsRow, []audit.Event, error)) error {
	return pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		cur, err := scanSettings(tx.QueryRow(ctx, `SELECT `+settingsColumns+` FROM ai_settings FOR UPDATE`))
		found := err == nil
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		next, events, err := mutate(current(cur, found))
		if err != nil || len(events) == 0 {
			return err
		}
		prices, err := json.Marshal(next.Prices)
		if err != nil {
			return err
		}
		var keyID *int16
		var last4 *string
		var setAt *time.Time
		var setBy *uuid.UUID
		if next.Key != nil {
			keyID, last4, setAt, setBy = &next.KeyID, &next.Key.Last4, &next.Key.SetAt, &next.Key.SetByID
		}
		actor := events[0].ActorUserID
		if _, err := tx.Exec(ctx, `INSERT INTO ai_settings (one, `+settingsColumns+`, updated_at, updated_by_user_id)
			VALUES (true, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
			ON CONFLICT (one) DO UPDATE SET enabled = $1, model = $2, quality = $3, prices = $4, budget_micro_usd = $5,
				key_sealed = $6, key_id = $7, key_last4 = $8, key_set_at = $9, key_set_by_user_id = $10, updated_at = $11, updated_by_user_id = $12`,
			next.Enabled, next.Model, next.Quality, prices, next.BudgetMicroUSD, next.SealedKey, keyID, last4, setAt, setBy,
			events[0].OccurredAt, actor); err != nil {
			return err
		}
		return audit.InsertAll(ctx, tx, events)
	})
}

// ClearEmployee clears an employee's link from their calls (shredding, D3), through the owner's function.
func (p *PostgresStore) ClearEmployee(ctx context.Context, employeeID uuid.UUID) error {
	_, err := p.pool.Exec(ctx, `SELECT clear_ai_usage_employee($1)`, employeeID)
	return err
}

var _ ReportStore = (*PostgresStore)(nil)

func (p *PostgresStore) Sums(ctx context.Context, from time.Time, tz string) ([]MonthSum, []KeySum, []KeySum, []KeySum, error) {
	months := []MonthSum{}
	rows, err := p.pool.Query(ctx, `SELECT to_char(at AT TIME ZONE $2, 'YYYY-MM') AS month, count(*), coalesce(sum(cost_micro_usd), 0)
		FROM ai_usage WHERE at >= $1 GROUP BY month ORDER BY month`, from, tz)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	for rows.Next() {
		var m MonthSum
		if err := rows.Scan(&m.Month, &m.Calls, &m.CostMicroUSD); err != nil {
			rows.Close()
			return nil, nil, nil, nil, err
		}
		months = append(months, m)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, nil, nil, nil, err
	}
	by := func(column string) ([]KeySum, error) {
		out := []KeySum{}
		rows, err := p.pool.Query(ctx, `SELECT `+column+`::text, count(*), coalesce(sum(cost_micro_usd), 0) FROM ai_usage
			WHERE at >= $1 GROUP BY 1 ORDER BY 3 DESC, 1`, from)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var k KeySum
			if err := rows.Scan(&k.Key, &k.Calls, &k.CostMicroUSD); err != nil {
				return nil, err
			}
			out = append(out, k)
		}
		return out, rows.Err()
	}
	byOp, err := by("operation")
	if err != nil {
		return nil, nil, nil, nil, err
	}
	byUser, err := by("user_id")
	if err != nil {
		return nil, nil, nil, nil, err
	}
	byModel, err := by("model")
	return months, byOp, byUser, byModel, err
}

func (p *PostgresStore) Calls(ctx context.Context, f Filter) ([]Call, error) {
	limit := f.Limit
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	var from, to *time.Time
	if !f.From.IsZero() {
		from = &f.From
	}
	if !f.To.IsZero() {
		to = &f.To
	}
	var op, outcome *string
	if f.Operation != "" {
		s := string(f.Operation)
		op = &s
	}
	if f.Outcome != "" {
		s := string(f.Outcome)
		outcome = &s
	}
	var user *uuid.UUID
	if f.UserID != uuid.Nil {
		user = &f.UserID
	}
	rows, err := p.pool.Query(ctx, `SELECT id, at, operation, provider, model, outcome, coalesce(error_code, ''),
		input_text_tokens, input_image_tokens, output_text_tokens, output_image_tokens, cost_micro_usd, prices,
		duration_ms, user_id, source, request_id, coalesce(provider_request_id, ''), employee_id
		FROM ai_usage
		WHERE ($1::timestamptz IS NULL OR at >= $1) AND ($2::timestamptz IS NULL OR at < $2)
		  AND ($3::text IS NULL OR operation = $3) AND ($4::uuid IS NULL OR user_id = $4) AND ($5::text IS NULL OR outcome = $5)
		ORDER BY at DESC, id LIMIT $6 OFFSET $7`, from, to, op, user, outcome, limit, f.Offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Call{}
	for rows.Next() {
		var c Call
		var prices []byte
		if err := rows.Scan(&c.ID, &c.At, &c.Operation, &c.Provider, &c.Model, &c.Outcome, &c.ErrorCode,
			&c.Tokens.InputText, &c.Tokens.InputImage, &c.Tokens.OutputText, &c.Tokens.OutputImage, &c.CostMicroUSD, &prices,
			&c.DurationMS, &c.UserID, &c.Source, &c.RequestID, &c.ProviderRequestID, &c.EmployeeID); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(prices, &c.Prices); err != nil {
			return nil, err
		}
		c.At = c.At.UTC()
		out = append(out, c)
	}
	return out, rows.Err()
}
