// Package size holds the compiled-in size vocabulary and the size resolution
// rules from the Developer Logic Manual §4.4. It owns no table and accepts no
// writes; the employees migration mirrors these lists in CHECK constraints.
package size

import "slices"

// Group says which size dimension an item uses.
type Group string

const (
	GroupClothing Group = "CLOTHING"
	GroupShoes    Group = "SHOES"
	// GroupNone items (gloves, helmets, …) have no size: stored as null,
	// shown as an en dash.
	GroupNone Group = "NONE"
)

// Valid reports whether g is a known group.
func (g Group) Valid() bool {
	return g == GroupClothing || g == GroupShoes || g == GroupNone
}

// ClothingSize is one clothing size and the height range it is cut for.
type ClothingSize struct {
	Code  string `json:"code"`
	MinCm int    `json:"min_cm"`
	MaxCm int    `json:"max_cm"`
}

// ShoeSize is one shoe size.
type ShoeSize struct {
	Code string `json:"code"`
}

// Smallest first. Order is part of the contract: UIs render it directly, and a
// lexicographic sort would put 2XL between L and XL. Ranges are contiguous;
// TestClothingRangesContiguous keeps them so.
var clothingSizes = []ClothingSize{
	{Code: "S", MinCm: 160, MaxCm: 167},
	{Code: "M", MinCm: 168, MaxCm: 175},
	{Code: "L", MinCm: 176, MaxCm: 181},
	{Code: "XL", MinCm: 182, MaxCm: 187},
	{Code: "2XL", MinCm: 188, MaxCm: 193},
	{Code: "3XL", MinCm: 194, MaxCm: 200},
}

var shoeSizes = []ShoeSize{
	{Code: "39"}, {Code: "40"}, {Code: "41"}, {Code: "42"},
	{Code: "43"}, {Code: "44"}, {Code: "45"}, {Code: "46"},
}

// Clothing returns the clothing vocabulary, smallest first.
func Clothing() []ClothingSize { return slices.Clone(clothingSizes) }

// Shoes returns the shoe vocabulary, smallest first.
func Shoes() []ShoeSize { return slices.Clone(shoeSizes) }

// IsClothing reports whether code is a clothing size.
func IsClothing(code string) bool {
	return slices.ContainsFunc(clothingSizes, func(s ClothingSize) bool { return s.Code == code })
}

// IsShoe reports whether code is a shoe size.
func IsShoe(code string) bool {
	return slices.ContainsFunc(shoeSizes, func(s ShoeSize) bool { return s.Code == code })
}

// Fits reports whether size is acceptable for an item in group g: a clothing
// size for CLOTHING, a shoe size for SHOES, and nil for NONE.
func Fits(g Group, size *string) bool {
	switch g {
	case GroupClothing:
		return size != nil && IsClothing(*size)
	case GroupShoes:
		return size != nil && IsShoe(*size)
	case GroupNone:
		return size == nil
	}
	return false
}

// SuggestClothing returns the clothing size whose height range contains
// heightCm, when exactly one does. It is a suggestion the user may change,
// never a stored default. Shoe sizes are never inferred from height.
func SuggestClothing(heightCm int) (string, bool) {
	var match string
	n := 0
	for _, s := range clothingSizes {
		if heightCm >= s.MinCm && heightCm <= s.MaxCm {
			match = s.Code
			n++
		}
	}
	return match, n == 1
}

// Defaults are the reusable sizes saved on an employee.
type Defaults struct {
	HeightCm     *int
	ClothingSize *string
	ShoeSize     *string
}

// Resolution is the size chosen for one working line.
type Resolution struct {
	Size *string `json:"size"`
	// Suggested is true when a clothing size came from height, not a saved size.
	Suggested bool `json:"suggested"`
	// Missing is true when the group needs a size and none could be resolved;
	// the UI shows the inline dropdown. It is not an error.
	Missing bool `json:"missing"`
}

// Resolve applies the manual's algorithm A size rules for group g.
func Resolve(g Group, d Defaults) Resolution {
	switch g {
	case GroupClothing:
		if d.ClothingSize != nil {
			return Resolution{Size: ptr(*d.ClothingSize)}
		}
		if d.HeightCm != nil {
			if code, ok := SuggestClothing(*d.HeightCm); ok {
				return Resolution{Size: &code, Suggested: true}
			}
		}
		return Resolution{Missing: true}
	case GroupShoes:
		if d.ShoeSize != nil {
			return Resolution{Size: ptr(*d.ShoeSize)}
		}
		return Resolution{Missing: true}
	default:
		return Resolution{}
	}
}

func ptr[T any](v T) *T { return &v }
