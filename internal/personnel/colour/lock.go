// Package colour keeps an AI-coloured portrait true to the document (ADR
// 0007, decision 7; docs-import plan §5.4): the luminance lock. Whatever
// model makes the colour, only its colour is taken: the result's lightness
// is the document's own, pixel for pixel, so the model cannot redraw the
// face, only tint it.
//
// It works in CIELAB (D65): L* from the grey portrait, a* and b* from the
// model's answer resized to the portrait, then back to sRGB.
package colour

import (
	"image"
	"image/color"
	"math"

	"golang.org/x/image/draw"
)

// Lock is the coloured picture's colour on the grey portrait's lightness: the
// portrait's size, its L* kept, the model's a* and b* taken.
func Lock(portrait, coloured image.Image) *image.RGBA {
	b := portrait.Bounds()
	// The model's answer at the portrait's size (it answers at its own sizes).
	tint := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.CatmullRom.Scale(tint, tint.Bounds(), coloured, coloured.Bounds(), draw.Src, nil)
	out := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	for y := 0; y < b.Dy(); y++ {
		for x := 0; x < b.Dx(); x++ {
			l, _, _ := lab(portrait.At(b.Min.X+x, b.Min.Y+y))
			_, a, bb := lab(tint.At(x, y))
			out.Set(x, y, rgbOf(l, a, bb))
		}
	}
	return out
}

// Lightness is a picture's L* (0–100) at each pixel, row by row: for tests,
// and for checking a result kept the portrait's.
func Lightness(img image.Image) []float64 {
	b := img.Bounds()
	out := make([]float64, 0, b.Dx()*b.Dy())
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			l, _, _ := lab(img.At(x, y))
			out = append(out, l)
		}
	}
	return out
}

// D65's white point.
const xn, yn, zn = 0.95047, 1.0, 1.08883

func lab(c color.Color) (l, a, b float64) {
	r, g, bl, _ := c.RGBA()
	R, G, B := linear(float64(r)/0xffff), linear(float64(g)/0xffff), linear(float64(bl)/0xffff)
	x := (0.4124564*R + 0.3575761*G + 0.1804375*B) / xn
	y := (0.2126729*R + 0.7151522*G + 0.0721750*B) / yn
	z := (0.0193339*R + 0.1191920*G + 0.9503041*B) / zn
	fx, fy, fz := f(x), f(y), f(z)
	return 116*fy - 16, 500 * (fx - fy), 200 * (fy - fz)
}

func rgbOf(l, a, b float64) color.RGBA {
	fy := (l + 16) / 116
	fx := fy + a/500
	fz := fy - b/200
	x, y, z := finv(fx)*xn, finv(fy)*yn, finv(fz)*zn
	R := 3.2404542*x - 1.5371385*y - 0.4985314*z
	G := -0.9692660*x + 1.8760108*y + 0.0415560*z
	B := 0.0556434*x - 0.2040259*y + 1.0572252*z
	return color.RGBA{R: byteOf(gamma(R)), G: byteOf(gamma(G)), B: byteOf(gamma(B)), A: 255}
}

const epsilon, kappa = 216.0 / 24389, 24389.0 / 27

func f(t float64) float64 {
	if t > epsilon {
		return math.Cbrt(t)
	}
	return (kappa*t + 16) / 116
}

func finv(t float64) float64 {
	if t3 := t * t * t; t3 > epsilon {
		return t3
	}
	return (116*t - 16) / kappa
}

func linear(c float64) float64 {
	if c <= 0.04045 {
		return c / 12.92
	}
	return math.Pow((c+0.055)/1.055, 2.4)
}

func gamma(c float64) float64 {
	if c <= 0.0031308 {
		return 12.92 * c
	}
	return 1.055*math.Pow(c, 1/2.4) - 0.055
}

func byteOf(c float64) uint8 {
	return uint8(math.Round(math.Min(1, math.Max(0, c)) * 255))
}
