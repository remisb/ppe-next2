package order

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strconv"
	"time"
)

// ReceiptTextVersion names the confirmation wording new orders are placed
// under. Each order keeps the version it was placed under
// (orders.receipt_text_version), and its record always shows and hashes that
// version's wording, so changing the wording never alters a stored record:
// add a version to ConfirmationTexts and point this at it.
const ReceiptTextVersion = "2026-09-v2"

// ConfirmationText is one version of the confirmation statements, as separate
// titled blocks (manual §8).
type ConfirmationText struct {
	TitleEN, TextEN, TitleRU, TextRU string
}

// ConfirmationTexts holds every wording an order has been placed under, by
// version. A version is never edited or removed once orders use it.
var ConfirmationTexts = map[string]ConfirmationText{
	// Orders placed up to the shorter wording.
	"2026-09-v1": {
		TitleEN: "Confirmation of receipt",
		TextEN:  "I confirm that I have received the items listed above, in the stated sizes and quantities and in good condition, for use in my work. I understand the service period of each item.",
		TitleRU: "Подтверждение получения",
		TextRU:  "Я подтверждаю, что получил(а) перечисленные выше предметы указанных размеров и в указанном количестве, в надлежащем состоянии, для использования в работе. Мне известен срок службы каждого предмета.",
	},
	"2026-09-v2": {
		TitleEN: "Confirmation of receipt",
		TextEN:  "I confirm receipt of the listed items in the stated sizes and quantities, in good condition for work. I know each item’s service period.",
		TitleRU: "Подтверждение получения",
		TextRU:  "Подтверждаю получение перечисленных предметов указанных размеров и количества, в надлежащем состоянии для работы. Знаю срок службы каждого предмета.",
	},
}

// ReceiptLine is one line of the Items Given Record, from the snapshot only.
// UnitPriceCents is the line's accounting price; the record shows no purchase
// price. Field names and JSON keys are part of DocumentHash, so they never
// change: renaming one would break every stored record's hash.
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

// ReceiptOf builds the receipt for a stored order, in the wording of the
// version the order was placed under.
func ReceiptOf(o Order) Receipt {
	text, ok := ConfirmationTexts[o.ReceiptTextVersion]
	if !ok {
		// Only this package writes the version, from ConfirmationTexts.
		panic("order: unknown receipt text version " + strconv.Quote(o.ReceiptTextVersion))
	}
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
		TextVersion:       o.ReceiptTextVersion,
		TitleEN:           text.TitleEN,
		TextEN:            text.TextEN,
		TitleRU:           text.TitleRU,
		TextRU:            text.TextRU,
	}
	for i, l := range o.Lines {
		r.Lines[i] = ReceiptLine{
			LineNo: l.LineNo, ItemName: l.ItemName, ItemDetails: l.ItemDetails, Size: l.Size, Quantity: l.Quantity,
			UnitPriceCents: l.AccountingPriceCents, TotalCents: l.TotalCents(), Currency: l.Currency,
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
