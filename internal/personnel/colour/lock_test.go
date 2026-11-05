package colour

import (
	"image"
	"image/color"
	"math"
	"testing"
)

// grey is a portrait-like picture: a gradient with a "face" of other greys.
func grey(w, h int) *image.Gray {
	img := image.NewGray(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			v := uint8(40 + (x*150)/w)
			if (x-w/2)*(x-w/2)+(y-h/2)*(y-h/2) < (w/4)*(w/4) {
				v = uint8(180 - (y*60)/h)
			}
			img.SetGray(x, y, color.Gray{Y: v})
		}
	}
	return img
}

// model is what a model might answer: another size, tinted, and with its own
// idea of the face (other lightness) that the lock must not keep.
func model(w, h int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			img.Set(x, y, color.RGBA{R: uint8(200 - x%50), G: uint8(120 + y%40), B: 90, A: 255})
		}
	}
	return img
}

func TestLockKeepsThePortraitsLightness(t *testing.T) {
	portrait := grey(120, 160)
	out := Lock(portrait, model(1024, 1536))
	if out.Bounds().Dx() != 120 || out.Bounds().Dy() != 160 {
		t.Fatalf("size = %v, want the portrait's", out.Bounds())
	}
	want, got := Lightness(portrait), Lightness(out)
	worst := 0.0
	for i := range want {
		worst = math.Max(worst, math.Abs(want[i]-got[i]))
	}
	// Rounding to bytes and out-of-gamut colours clipped move L* a little, never a feature's worth.
	if worst > 2.5 {
		t.Errorf("L* moved by up to %.2f, want under 2.5", worst)
	}
}

func TestLockTakesTheModelsColour(t *testing.T) {
	out := Lock(grey(60, 80), model(60, 80))
	_, a, b := lab(out.At(10, 10))
	_, ma, mb := lab(model(60, 80).At(10, 10))
	if math.Abs(a-ma) > 12 || math.Abs(b-mb) > 12 {
		t.Errorf("a*b* = %.1f %.1f, the model's %.1f %.1f", a, b, ma, mb)
	}
	r, g, bl, _ := out.At(10, 10).RGBA()
	if r == g && g == bl {
		t.Error("the result is still grey")
	}
}

func TestLabRoundTrips(t *testing.T) {
	for _, c := range []color.RGBA{{0, 0, 0, 255}, {255, 255, 255, 255}, {200, 120, 90, 255}, {12, 200, 40, 255}} {
		l, a, b := lab(c)
		back := rgbOf(l, a, b)
		if d := math.Abs(float64(back.R)-float64(c.R)) + math.Abs(float64(back.G)-float64(c.G)) + math.Abs(float64(back.B)-float64(c.B)); d > 3 {
			t.Errorf("%v → %v", c, back)
		}
	}
}
