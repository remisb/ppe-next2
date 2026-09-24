package order

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"time"
)

// ReceiptTextVersion names the confirmation wording below. It is part of the
// hashed payload, so changing the wording changes every new document hash.
const ReceiptTextVersion = "2026-09-v1"

// The confirmation statements, as separate titled blocks (manual §8). The
// Russian wording awaits approval; see docs/specs/order-service.md.
const (
	ConfirmationTitleEN = "Confirmation of receipt"
	ConfirmationTextEN  = "I confirm that I have received the items listed above, in the stated sizes and quantities and in good condition, for use in my work. I understand the service period of each item."
	ConfirmationTitleRU = "Подтверждение получения"
	ConfirmationTextRU  = "Я подтверждаю, что получил(а) перечисленные выше предметы указанных размеров и в указанном количестве, в надлежащем состоянии, для использования в работе. Мне известен срок службы каждого предмета."
)

// ReceiptLine is one line of the Items Given Record, from the snapshot only.
type ReceiptLine struct {
	LineNo              int     `json:"line_no"`
	ItemName            string  `json:"item_name"`
	ItemDetails         string  `json:"item_details"`
	Size                *string `json:"size"`
	Quantity            int     `json:"quantity"`
	UnitPriceCents      int64   `json:"unit_price_cents"`
	TotalCents          int64   `json:"total_cents"`
	Currency            string  `json:"currency"`
	ServicePeriodMonths int     `json:"service_period_months"`
}

// Receipt is the locked document an employee confirms. It is built only from
// the order snapshot, never from live employee or catalogue rows (manual §8),
// and its canonical JSON is what DocumentHash hashes.
type Receipt struct {
	RecordNumber      string        `json:"record_number"`
	EmployeeFirstName string        `json:"employee_first_name"`
	EmployeeLastName  string        `json:"employee_last_name"`
	EmployeeCode      *string       `json:"employee_code"`
	OrderedAt         time.Time     `json:"ordered_at"`
	PreparedByName    string        `json:"prepared_by_name"`
	Lines             []ReceiptLine `json:"lines"`
	TotalCents        int64         `json:"total_cents"`
	Currency          string        `json:"currency"`
	TextVersion       string        `json:"text_version"`
	TitleEN           string        `json:"confirmation_title_en"`
	TextEN            string        `json:"confirmation_text_en"`
	TitleRU           string        `json:"confirmation_title_ru"`
	TextRU            string        `json:"confirmation_text_ru"`
}

// ReceiptOf builds the receipt for a stored order.
func ReceiptOf(o Order) Receipt {
	r := Receipt{
		RecordNumber:      o.RecordNumber(),
		EmployeeFirstName: o.EmployeeFirstName,
		EmployeeLastName:  o.EmployeeLastName,
		EmployeeCode:      o.EmployeeCode,
		OrderedAt:         o.OrderedAt.UTC().Truncate(time.Microsecond), // the precision Postgres stores
		PreparedByName:    o.PreparedByName,
		Lines:             make([]ReceiptLine, len(o.Lines)),
		TotalCents:        o.TotalCents(),
		Currency:          "EUR",
		TextVersion:       ReceiptTextVersion,
		TitleEN:           ConfirmationTitleEN,
		TextEN:            ConfirmationTextEN,
		TitleRU:           ConfirmationTitleRU,
		TextRU:            ConfirmationTextRU,
	}
	for i, l := range o.Lines {
		r.Lines[i] = ReceiptLine{
			LineNo: l.LineNo, ItemName: l.ItemName, ItemDetails: l.ItemDetails, Size: l.Size, Quantity: l.Quantity,
			UnitPriceCents: l.UnitPriceCents, TotalCents: l.TotalCents(), Currency: l.Currency,
			ServicePeriodMonths: l.ServicePeriodMonths,
		}
	}
	return r
}

// DocumentHash is the hex SHA-256 of the receipt's canonical JSON. Go encodes
// struct fields in declaration order, so the encoding is deterministic.
func DocumentHash(r Receipt) string {
	b, err := json.Marshal(r)
	if err != nil {
		panic("order: receipt is not marshalable: " + err.Error()) // fixed struct of plain fields
	}
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
