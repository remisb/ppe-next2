package registerpdf

import (
	"strconv"

	"github.com/remisb/ppe-next2/internal/domain/asset"
)

// words are the report's text in one language: the staff app's words for
// the register (web/apps/workwear/src/i18n/<lang>/assets.ts) where it has them.
type words struct {
	title, printed, filters, none, sortBy, asc, desc, noMatches     string
	location, office, withEmployee, unknown                         string
	status, provider, notReturned, search                           string
	documents, signedCopyUploaded, signedCopyMissing                string
	colNo, colPhone, colSIM, colInventory, colEmployee, colProvider string
	colPlan, colStatus, colGiven, colDays, colDocuments             string
	colValue                                                        string
	statuses                                                        map[asset.Status]string
	sorts                                                           map[asset.SortKey]string
	page                                                            func(n, total int) string
	count                                                           func(n int) string
	lastHeldBy                                                      func(name string) string
}

func itoa(n int) string { return strconv.Itoa(n) }

var en = words{
	title: "SIM Cards", printed: "Printed", filters: "Filters", none: "none, every SIM card", sortBy: "Sort by",
	asc: "ascending", desc: "descending", noMatches: "No SIM cards match these filters.",
	location: "Location", office: "Office", withEmployee: "With Employee", unknown: "Unknown",
	status: "Status", provider: "Provider", notReturned: "Not Returned", search: "Search",
	documents: "Documents", signedCopyUploaded: "Signed Copy Uploaded", signedCopyMissing: "Signed Copy Missing",
	colNo: "No.", colPhone: "Phone No.", colSIM: "SIM No.", colInventory: "Inventory No.", colEmployee: "Employee", colProvider: "Provider",
	colPlan: "Plan", colStatus: "Status", colGiven: "Given Date", colDays: "Days Held", colDocuments: "Documents",
	colValue: "Non-return Value",
	statuses: map[asset.Status]string{asset.StatusNotActivated: "Not Activated", asset.StatusActive: "Active", asset.StatusBlocked: "Blocked"},
	sorts: map[asset.SortKey]string{asset.SortPhone: "Phone / SIM", asset.SortHolder: "Employee", asset.SortInventory: "Inventory No.",
		asset.SortStatus: "Status", asset.SortGiven: "Given Date"},
	page: func(n, total int) string { return "Page " + itoa(n) + " of " + itoa(total) },
	count: func(n int) string {
		if n == 1 {
			return "1 SIM"
		}
		return itoa(n) + " SIMs"
	},
	lastHeldBy: func(name string) string { return "last held by " + name },
}

var lt = words{
	title: "SIM kortelės", printed: "Atspausdinta", filters: "Filtrai", none: "nėra, visos SIM kortelės", sortBy: "Rikiuoti pagal",
	asc: "didėjančiai", desc: "mažėjančiai", noMatches: "Šiuos filtrus atitinkančių SIM kortelių nėra.",
	location: "Vieta", office: "Biure", withEmployee: "Pas darbuotoją", unknown: "Nežinoma",
	status: "Būsena", provider: "Tiekėjas", notReturned: "Negrąžinta", search: "Paieška",
	documents: "Dokumentai", signedCopyUploaded: "Pasirašyta kopija įkelta", signedCopyMissing: "Trūksta pasirašytos kopijos",
	colNo: "Nr.", colPhone: "Telefono Nr.", colSIM: "SIM Nr.", colInventory: "Inventoriaus Nr.", colEmployee: "Darbuotojas", colProvider: "Tiekėjas",
	colPlan: "Planas", colStatus: "Būsena", colGiven: "Išdavimo data", colDays: "Dienų", colDocuments: "Dokumentai",
	colValue: "Negrąžinimo vertė",
	statuses: map[asset.Status]string{asset.StatusNotActivated: "Neaktyvuota", asset.StatusActive: "Aktyvi", asset.StatusBlocked: "Užblokuota"},
	sorts: map[asset.SortKey]string{asset.SortPhone: "Telefonas / SIM", asset.SortHolder: "Darbuotojas", asset.SortInventory: "Inventoriaus Nr.",
		asset.SortStatus: "Būsena", asset.SortGiven: "Išdavimo data"},
	page:       func(n, total int) string { return "Puslapis " + itoa(n) + " iš " + itoa(total) },
	count:      func(n int) string { return itoa(n) + " SIM" },
	lastHeldBy: func(name string) string { return "paskutinis turėjo " + name },
}

var ru = words{
	title: "SIM-карты", printed: "Напечатано", filters: "Фильтры", none: "нет, все SIM-карты", sortBy: "Сортировать по",
	asc: "по возрастанию", desc: "по убыванию", noMatches: "Нет SIM-карт, подходящих под эти фильтры.",
	location: "Местонахождение", office: "В офисе", withEmployee: "У сотрудника", unknown: "Неизвестно",
	status: "Статус", provider: "Оператор", notReturned: "Не возвращено", search: "Поиск",
	documents: "Документы", signedCopyUploaded: "Подписанная копия загружена", signedCopyMissing: "Нет подписанной копии",
	colNo: "№", colPhone: "№ телефона", colSIM: "№ SIM", colInventory: "Инвентарный №", colEmployee: "Сотрудник", colProvider: "Оператор",
	colPlan: "Тариф", colStatus: "Статус", colGiven: "Дата выдачи", colDays: "Дней", colDocuments: "Документы",
	colValue: "Стоимость при невозврате",
	statuses: map[asset.Status]string{asset.StatusNotActivated: "Не активирована", asset.StatusActive: "Активна", asset.StatusBlocked: "Заблокирована"},
	sorts: map[asset.SortKey]string{asset.SortPhone: "Телефон / SIM", asset.SortHolder: "Сотрудник", asset.SortInventory: "Инвентарный №",
		asset.SortStatus: "Статус", asset.SortGiven: "Дата выдачи"},
	page:       func(n, total int) string { return "Стр. " + itoa(n) + " из " + itoa(total) },
	count:      func(n int) string { return itoa(n) + " SIM" },
	lastHeldBy: func(name string) string { return "последний держатель: " + name },
}

// wordsFor is lang's words, English for any other.
func wordsFor(lang string) words {
	switch lang {
	case "lt":
		return lt
	case "ru":
		return ru
	}
	return en
}
