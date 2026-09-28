// Package size holds the compiled-in size vocabulary and the size resolution
// rules from the Developer Logic Manual §4.4. It owns no table and accepts no
// writes; the employees migrations mirror these lists in CHECK constraints
// (0003 for shoe sizes, 0012 for clothing sizes).
package size

import (
	"slices"
	"strconv"
)

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

// ClothingSize is one EU clothing size and, for six of them, the height range
// it is suggested for. MinCm and MaxCm are both nil on the sizes a height
// never suggests.
type ClothingSize struct {
	Code  string `json:"code"`
	MinCm *int   `json:"min_cm"`
	MaxCm *int   `json:"max_cm"`
}

// ShoeSize is one shoe size.
type ShoeSize struct {
	Code string `json:"code"`
}

// Clothing sizes are the even EU numbers MinClothing..MaxClothing. An
// employee stores the number; an order line stores its code, the number as a
// string ("54"), beside the letter sizes (S … 3XL) of lines ordered before
// migration 0012, which order lines keep for good.
const (
	MinClothing = 44
	MaxClothing = 66
)

// Smallest first. Order is part of the contract: UIs render it directly. The
// banded sizes' ranges are contiguous; TestClothingRangesContiguous keeps them so.
var clothingSizes = func() []ClothingSize {
	bands := map[int][2]int{
		46: {160, 167}, 50: {168, 175}, 54: {176, 181},
		58: {182, 187}, 62: {188, 193}, 66: {194, 200},
	}
	var out []ClothingSize
	for n := MinClothing; n <= MaxClothing; n += 2 {
		s := ClothingSize{Code: ClothingCode(n)}
		if b, ok := bands[n]; ok {
			s.MinCm, s.MaxCm = &b[0], &b[1]
		}
		out = append(out, s)
	}
	return out
}()

var shoeSizes = []ShoeSize{
	{Code: "39"}, {Code: "40"}, {Code: "41"}, {Code: "42"},
	{Code: "43"}, {Code: "44"}, {Code: "45"}, {Code: "46"},
}

// Clothing returns the clothing vocabulary, smallest first.
func Clothing() []ClothingSize { return slices.Clone(clothingSizes) }

// Shoes returns the shoe vocabulary, smallest first.
func Shoes() []ShoeSize { return slices.Clone(shoeSizes) }

// ClothingCode is the code an order line stores for clothing size n.
func ClothingCode(n int) string { return strconv.Itoa(n) }

// IsClothing reports whether code is a clothing size. Letter sizes on old
// order lines are not: a new line cannot use them.
func IsClothing(code string) bool {
	return slices.ContainsFunc(clothingSizes, func(s ClothingSize) bool { return s.Code == code })
}

// IsClothingNumber reports whether n is a clothing size an employee can have.
func IsClothingNumber(n int) bool { return IsClothing(ClothingCode(n)) }

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

// SuggestClothing returns the code of the clothing size whose height range
// contains heightCm, when exactly one does. It is a suggestion the user may
// change, never a stored default. Shoe sizes are never inferred from height.
func SuggestClothing(heightCm int) (string, bool) {
	var match string
	n := 0
	for _, s := range clothingSizes {
		if s.MinCm != nil && heightCm >= *s.MinCm && heightCm <= *s.MaxCm {
			match = s.Code
			n++
		}
	}
	return match, n == 1
}

// Defaults are the reusable sizes saved on an employee.
type Defaults struct {
	HeightCm     *int
	ClothingSize *int
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
			return Resolution{Size: ptr(ClothingCode(*d.ClothingSize))}
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
