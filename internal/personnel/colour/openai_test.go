package colour

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fakeOpenAI answers /v1/images/edits as OpenAI does, and keeps what it was sent.
func fakeOpenAI(t *testing.T, status int, body func(r *http.Request) string) (*OpenAI, *[]*http.Request) {
	t.Helper()
	var got []*http.Request
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseMultipartForm(8 << 20); err != nil {
			t.Errorf("not multipart: %v", err)
		}
		got = append(got, r)
		w.Header().Set("x-request-id", "req_abc")
		w.WriteHeader(status)
		io.WriteString(w, body(r))
	}))
	t.Cleanup(srv.Close)
	return &OpenAI{Base: srv.URL, Client: srv.Client()}, &got
}

func pngB64(t *testing.T, w, h int) string {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for x := range w {
		img.Set(x, 0, color.RGBA{R: 200, G: 100, B: 50, A: 255})
	}
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(b.Bytes())
}

func TestOpenAIColorize(t *testing.T) {
	answer := `{"data":[{"b64_json":"` + pngB64(t, 1024, 1536) + `"}],"usage":{"input_tokens":1030,"input_tokens_details":{"text_tokens":30,"image_tokens":1000},"output_tokens":4160}}`
	o, sent := fakeOpenAI(t, 200, func(*http.Request) string { return answer })
	img, res, err := o.Colorize(context.Background(), Edit{Key: "sk-test-123", Model: "gpt-image-2", Quality: "medium"}, grey(300, 400))
	if err != nil {
		t.Fatal(err)
	}
	if img.Bounds().Dx() != 1024 || res.ProviderRequestID != "req_abc" ||
		res.Tokens.InputText != 30 || res.Tokens.InputImage != 1000 || res.Tokens.OutputImage != 4160 {
		t.Errorf("image %v, result %+v", img.Bounds(), res)
	}
	r := (*sent)[0]
	if r.URL.Path != "/v1/images/edits" || r.Header.Get("Authorization") != "Bearer sk-test-123" {
		t.Errorf("request %s %s", r.URL.Path, r.Header.Get("Authorization"))
	}
	if r.FormValue("model") != "gpt-image-2" || r.FormValue("quality") != "medium" || r.FormValue("size") != "1024x1536" || r.FormValue("prompt") != Prompt {
		t.Errorf("fields = %v", r.MultipartForm.Value)
	}
	if fh := r.MultipartForm.File["image"]; len(fh) != 1 || fh[0].Header.Get("Content-Type") != "image/png" {
		t.Errorf("image part = %v", r.MultipartForm.File)
	}
	// Nothing else goes with the portrait: no name, no document.
	for k := range r.MultipartForm.Value {
		if !strings.Contains("model prompt quality size n", k) {
			t.Errorf("unexpected field %q", k)
		}
	}
}

func TestOpenAIRefusalKeepsItsCodeAndTokens(t *testing.T) {
	o, _ := fakeOpenAI(t, 400, func(*http.Request) string {
		return `{"error":{"code":"moderation_blocked","message":"…"},"usage":{"input_tokens":1000,"output_tokens":0}}`
	})
	_, res, err := o.Colorize(context.Background(), Edit{Key: "sk-secret-key", Model: "gpt-image-2", Quality: "low"}, grey(30, 40))
	var e *Error
	if !errors.As(err, &e) || e.Code != "moderation_blocked" || e.ErrorCode() != "moderation_blocked" || res.Tokens.InputImage != 1000 {
		t.Errorf("err %v, result %+v", err, res)
	}
	if strings.Contains(err.Error(), "sk-secret-key") {
		t.Errorf("the error names the key: %v", err)
	}
}

func TestSizeFollowsTheShape(t *testing.T) {
	for _, c := range []struct {
		w, h int
		want string
	}{{300, 400, "1024x1536"}, {400, 400, "1024x1024"}, {600, 400, "1536x1024"}} {
		if got := sizeFor(image.NewGray(image.Rect(0, 0, c.w, c.h))); got != c.want {
			t.Errorf("%dx%d = %s, want %s", c.w, c.h, got, c.want)
		}
	}
}
