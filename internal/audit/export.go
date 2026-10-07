package audit

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"io"
	"strings"

	"github.com/google/uuid"
)

// Formats an export can be written in.
const (
	FormatCSV   = "csv"
	FormatJSONL = "jsonl"
)

// MaxExportDays is the longest span one export covers.
const MaxExportDays = 366

// exportPage is how many events the export reads at a time.
const exportPage = 1000

// csvColumns are an export's columns, in order.
var csvColumns = []string{
	"occurred_at", "event", "area", "entity_type", "entity_id", "entity_label", "entity_deleted",
	"actor_id", "actor_name", "source", "request_id", "session_id", "before", "after", "id",
}

// Export writes the events f selects to w as CSV (for spreadsheets) or JSON
// lines (one Entry each, for archives), newest first, with times in the
// organisation's timezone. The filter must give both from and to, at most
// MaxExportDays apart. The export is recorded as an audit.exported event by
// actor before anything is written, so one cut short is on the trail too.
func (s *Service) Export(ctx context.Context, f Filter, format string, actor uuid.UUID, w io.Writer) error {
	if format != FormatCSV && format != FormatJSONL {
		return fieldError("format", "must be csv or jsonl")
	}
	if actor == uuid.Nil {
		return fieldError("actor", "is required")
	}
	if f.FromDate == "" || f.ToDate == "" {
		return fieldError("from", "and to are required for an export")
	}
	f.After, f.PageSize = nil, 0
	q, err := f.resolve(s.loc)
	if err != nil {
		return err
	}
	if q.To.Sub(*q.From) > MaxExportDays*Day {
		return fieldError("to", "is more than a year after from")
	}
	record := map[string]any{"format": format, "from": f.FromDate, "to": f.ToDate}
	for k, v := range map[string]string{"area": string(f.Area), "event": f.Event, "entity_type": f.EntityType} {
		if v != "" {
			record[k] = v
		}
	}
	if f.ActorID != nil {
		record["actor"] = f.ActorID.String()
	}
	if f.EntityID != nil {
		record["entity_id"] = f.EntityID.String()
	}
	ev, err := New(s.newID(), &actor, EventExported, EntityLog, s.newID(), s.now(), nil, record)
	if err != nil {
		return err
	}
	if err := s.store.Insert(ctx, ev); err != nil {
		return err
	}

	var cw *csv.Writer
	enc := json.NewEncoder(w)
	if format == FormatCSV {
		cw = csv.NewWriter(w)
		if err := cw.Write(csvColumns); err != nil {
			return err
		}
	}
	q.Limit = exportPage
	for {
		rows, err := s.store.List(ctx, q)
		if err != nil {
			return err
		}
		for _, e := range rows {
			e.OccurredAt = e.OccurredAt.In(s.loc)
			if cw == nil {
				if err := enc.Encode(e); err != nil {
					return err
				}
				continue
			}
			if err := cw.Write(csvRow(e)); err != nil {
				return err
			}
		}
		if cw != nil {
			cw.Flush()
			if err := cw.Error(); err != nil {
				return err
			}
		}
		if len(rows) < exportPage {
			return nil
		}
		last := rows[len(rows)-1]
		q.After = &Cursor{At: last.OccurredAt, ID: last.ID}
	}
}

func csvRow(e Entry) []string {
	str := func(p *string) string {
		if p == nil {
			return ""
		}
		return *p
	}
	id := func(p *uuid.UUID) string {
		if p == nil {
			return ""
		}
		return p.String()
	}
	source := ""
	if e.Source != nil {
		source = string(*e.Source)
	}
	deleted := ""
	if e.EntityDeleted {
		deleted = "true"
	}
	return []string{
		e.OccurredAt.Format("2006-01-02T15:04:05.000000Z07:00"), e.Event, string(e.Area), e.EntityType, e.EntityID.String(),
		safeCell(str(e.EntityLabel)), deleted, id(e.ActorID), safeCell(str(e.ActorName)), source, str(e.RequestID), id(e.SessionID),
		string(e.Before), string(e.After), e.ID.String(),
	}
}

// safeCell keeps a spreadsheet from reading a name as a formula (CSV
// injection): one starting with =, +, - or @ gets a leading apostrophe.
func safeCell(s string) string {
	if s != "" && strings.ContainsRune("=+-@\t\r", rune(s[0])) {
		return "'" + s
	}
	return s
}
