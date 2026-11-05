package colour

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strings"
	"time"

	_ "image/jpeg" // the answer may be a JPEG
	_ "image/png"

	"github.com/remisb/ppe-next2/internal/aiusage"
)

// Prompt is what the model is asked, the same every time: no name or other
// data goes with the portrait (PR-9). The luminance lock keeps the face
// whatever it does.
const Prompt = "Colourise this black-and-white portrait naturally. Change nothing else: not the face, the features, the expression, the hair, the background or the framing."

// OpenAI colours portraits with OpenAI's image edit endpoint
// (POST /v1/images/edits), the company's key and model from Settings → AI.
// It is the only code that talks to OpenAI; aiusage.Service.Run records
// each call it makes.
type OpenAI struct {
	// Base is https://api.openai.com unless a test's server.
	Base   string
	Client *http.Client
}

// NewOpenAI is the client for api.openai.com, with a timeout an image edit fits in.
func NewOpenAI() *OpenAI {
	return &OpenAI{Base: "https://api.openai.com", Client: &http.Client{Timeout: 120 * time.Second}}
}

// Edit is one colouring: the key, the model and its quality, and the grey portrait.
type Edit struct {
	Key     string
	Model   string
	Quality string
}

// Error is OpenAI's refusal, by its status and code: never the image or the key.
type Error struct {
	Status int
	Code   string
}

func (e *Error) Error() string {
	return fmt.Sprintf("openai refused the colouring (%d %s)", e.Status, e.Code)
}
func (e *Error) ErrorCode() string { return e.Code }

// usage is OpenAI's usage block of an image edit.
type usage struct {
	InputTokens        int `json:"input_tokens"`
	InputTokensDetails struct {
		TextTokens  int `json:"text_tokens"`
		ImageTokens int `json:"image_tokens"`
	} `json:"input_tokens_details"`
	OutputTokens int `json:"output_tokens"`
}

// Colorize sends the grey portrait and returns the model's picture and what
// OpenAI says the call used. Its tokens come back on failure too, when OpenAI
// sends them.
func (o *OpenAI) Colorize(ctx context.Context, e Edit, grey image.Image) (image.Image, aiusage.Result, error) {
	var res aiusage.Result
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	for k, v := range map[string]string{"model": e.Model, "prompt": Prompt, "quality": e.Quality, "size": sizeFor(grey), "n": "1"} {
		if err := mw.WriteField(k, v); err != nil {
			return nil, res, err
		}
	}
	h := make(textproto.MIMEHeader)
	h.Set("Content-Disposition", `form-data; name="image"; filename="portrait.png"`)
	h.Set("Content-Type", "image/png")
	part, err := mw.CreatePart(h)
	if err != nil {
		return nil, res, err
	}
	if err := png.Encode(part, grey); err != nil {
		return nil, res, err
	}
	if err := mw.Close(); err != nil {
		return nil, res, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(o.Base, "/")+"/v1/images/edits", &body)
	if err != nil {
		return nil, res, err
	}
	req.Header.Set("Authorization", "Bearer "+e.Key)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	resp, err := o.Client.Do(req)
	if err != nil {
		// The transport's error names the address, never the key or the image.
		return nil, res, fmt.Errorf("openai: %w", err)
	}
	defer resp.Body.Close()
	res.ProviderRequestID = resp.Header.Get("x-request-id")
	var answer struct {
		Data []struct {
			B64JSON string `json:"b64_json"`
		} `json:"data"`
		Usage *usage `json:"usage"`
		Error *struct {
			Code string `json:"code"`
			Type string `json:"type"`
		} `json:"error"`
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return nil, res, err
	}
	_ = json.Unmarshal(raw, &answer)
	if u := answer.Usage; u != nil {
		res.Tokens = aiusage.Tokens{InputText: u.InputTokensDetails.TextTokens, InputImage: u.InputTokensDetails.ImageTokens, OutputImage: u.OutputTokens}
		if res.Tokens.InputText+res.Tokens.InputImage == 0 {
			res.Tokens.InputImage = u.InputTokens
		}
	}
	if resp.StatusCode != http.StatusOK || len(answer.Data) == 0 {
		code := "no_image"
		if answer.Error != nil {
			code = answer.Error.Code
			if code == "" {
				code = answer.Error.Type
			}
		}
		return nil, res, &Error{Status: resp.StatusCode, Code: code}
	}
	img, _, err := image.Decode(base64.NewDecoder(base64.StdEncoding, strings.NewReader(answer.Data[0].B64JSON)))
	if err != nil {
		return nil, res, &Error{Status: resp.StatusCode, Code: "bad_image"}
	}
	return img, res, nil
}

// sizeFor is the edit size nearest the portrait's shape: OpenAI's image
// models answer 1024 × 1024, 1024 × 1536 (portrait) or 1536 × 1024.
func sizeFor(img image.Image) string {
	b := img.Bounds()
	switch r := float64(b.Dx()) / float64(b.Dy()); {
	case r < 0.85:
		return "1024x1536"
	case r > 1.18:
		return "1536x1024"
	}
	return "1024x1024"
}

// Check asks OpenAI whether the key works, by listing its models: it costs
// nothing and records no AI usage. An *Error says why not.
func (o *OpenAI) Check(ctx context.Context, key string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(o.Base, "/")+"/v1/models", nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	resp, err := o.Client.Do(req)
	if err != nil {
		return fmt.Errorf("openai: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusOK {
		return nil
	}
	var answer struct {
		Error *struct {
			Code string `json:"code"`
			Type string `json:"type"`
		} `json:"error"`
	}
	_ = json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&answer)
	code := "refused"
	if answer.Error != nil {
		code = answer.Error.Code
		if code == "" {
			code = answer.Error.Type
		}
	}
	return &Error{Status: resp.StatusCode, Code: code}
}
