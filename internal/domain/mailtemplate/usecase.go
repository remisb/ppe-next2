package mailtemplate

import "slices"

// The use cases' keys. A use case is a place in the app that prepares an
// email; each has one template, which administrators edit.
const (
	KeySIMActivation = "sim.activation"
	KeySIMBlocking   = "sim.blocking"
)

// The fields' keys, as templates write them ({{sim.phone_number}}).
const (
	FieldSIMNumber       = "sim.number"
	FieldPhoneNumber     = "sim.phone_number"
	FieldInventoryNumber = "sim.inventory_number"
	FieldPlan            = "sim.plan"
	FieldProviderName    = "provider.name"
	FieldProviderEmail   = "provider.email"
	FieldEmployeeName    = "employee.name"
	FieldCompanyName     = "company.name"
	FieldUserName        = "user.name"
	FieldUserEmail       = "user.email"
	FieldToday           = "today"
)

// Field is a value a use case's template may write as {{key}}. Label is what
// the email shows in brackets when the value is missing ([Phone Number]);
// Sample is what the editor's preview fills in.
type Field struct {
	Key    string `json:"key"`
	Label  string `json:"label"`
	Sample string `json:"sample"`
}

// Text is a template's parts: the recipient, who gets a copy (Cc, empty for
// no one), the subject and the body.
type Text struct {
	To      string `json:"to"`
	CC      string `json:"cc"`
	Subject string `json:"subject"`
	Body    string `json:"body"`
}

// UseCase is one place that prepares an email: the fields its caller fills
// in, and the text its template starts with and is reset to.
type UseCase struct {
	Key     string
	Fields  []Field
	Default Text
}

// Field returns the use case's field with that key.
func (u UseCase) Field(key string) (Field, bool) {
	i := slices.IndexFunc(u.Fields, func(f Field) bool { return f.Key == key })
	if i < 0 {
		return Field{}, false
	}
	return u.Fields[i], true
}

// simFields are what Company Assets fills in for a SIM card's emails.
var simFields = []Field{
	{FieldSIMNumber, "SIM Number", "8937 0011 2233 4455 667"},
	{FieldPhoneNumber, "Phone Number", "+370 612 40118"},
	{FieldInventoryNumber, "Inventory Number", "SIM-000001"},
	{FieldPlan, "Plan", "Biz 10 GB"},
	{FieldProviderName, "Provider", "Telia"},
	{FieldProviderEmail, "Provider E-mail", "verslas@telia.lt"},
	{FieldEmployeeName, "Employee", "Jonas Jonaitis"},
	{FieldCompanyName, "Company Name", "UAB Pavyzdys"},
	{FieldUserName, "Your Name", "Ona Onaitė"},
	{FieldUserEmail, "Your E-mail", "ona.onaite@pavyzdys.lt"},
	{FieldToday, "Date", "2026-10-28"},
}

// useCases is every use case, in the editor's order. The defaults are in
// English, which the providers read; a use case added here needs its caller,
// its labels in the Administration app and a line in the spec.
var useCases = []UseCase{
	{
		Key:    KeySIMActivation,
		Fields: simFields,
		Default: Text{
			To:      "{{provider.email}}",
			Subject: "SIM activation request - {{sim.number}}",
			Body: "Hello,\n\nPlease activate the following SIM:\n\n" +
				"SIM number: {{sim.number}}\nPlan: {{sim.plan}}\nCompany: {{company.name}}\n\n" +
				"Please confirm once the SIM has been activated, with its phone number.\n\nThank you.\n{{user.name}}",
		},
	},
	{
		Key:    KeySIMBlocking,
		Fields: simFields,
		Default: Text{
			To:      "{{provider.email}}",
			Subject: "SIM blocking request - {{sim.phone_number}}",
			Body: "Hello,\n\nPlease block the following SIM:\n\n" +
				"Phone number: {{sim.phone_number}}\nSIM number: {{sim.number}}\nCompany: {{company.name}}\n\n" +
				"Please confirm once the SIM has been blocked.\n\nThank you.\n{{user.name}}",
		},
	},
}

// UseCases returns every use case in the editor's order.
func UseCases() []UseCase { return slices.Clone(useCases) }

// Find returns the use case with that key.
func Find(key string) (UseCase, bool) {
	i := slices.IndexFunc(useCases, func(u UseCase) bool { return u.Key == key })
	if i < 0 {
		return UseCase{}, false
	}
	return useCases[i], true
}
