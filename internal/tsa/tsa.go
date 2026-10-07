// Package tsa gets and checks trusted timestamps (RFC 3161). A timestamp
// service signs "this hash existed at this time" with a certificate that
// chains to a public root, so a token cannot be made later with an earlier
// time: not by the API, and not by anyone with the database or the server.
// The Audit log anchors each day's seal with one (internal/audit, ADR 0003).
//
// Only the hash leaves the server. A token holds the service's certificates,
// so it can be checked later, here or with `openssl ts -verify`.
package tsa

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rand"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"sync"
	"time"

	"github.com/digitorus/pkcs7"
	"github.com/digitorus/timestamp"
	"golang.org/x/crypto/x509roots/fallback/bundle"
)

var (
	// ErrMismatch: the token is a timestamp of another hash.
	ErrMismatch = errors.New("tsa: the timestamp is of another hash")
	// ErrUntrusted: the token's signature or certificate does not check out.
	ErrUntrusted = errors.New("tsa: the timestamp is not signed by a trusted timestamp service")
)

// Client asks one timestamp service (by its URL) and checks its tokens.
type Client struct {
	url   string
	http  *http.Client
	roots *x509.CertPool
}

type Option func(*Client)

// WithRoots trusts only these roots; the default is Mozilla's (mozillaRoots).
func WithRoots(p *x509.CertPool) Option { return func(c *Client) { c.roots = p } }

// WithHTTPClient replaces the default client (30 s timeout).
func WithHTTPClient(h *http.Client) Option { return func(c *Client) { c.http = h } }

func New(url string, opts ...Option) *Client {
	c := &Client{url: url, http: &http.Client{Timeout: 30 * time.Second}}
	for _, o := range opts {
		o(c)
	}
	return c
}

// URL is the timestamp service's address.
func (c *Client) URL() string { return c.url }

// Stamp asks the service to timestamp digest, a SHA-256 hash, and returns
// the token, checked.
func (c *Client) Stamp(ctx context.Context, digest []byte) ([]byte, error) {
	if len(digest) != crypto.SHA256.Size() {
		return nil, fmt.Errorf("tsa: a SHA-256 hash has %d bytes, not %d", crypto.SHA256.Size(), len(digest))
	}
	nonce, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 64))
	if err != nil {
		return nil, err
	}
	body, err := (&timestamp.Request{HashAlgorithm: crypto.SHA256, HashedMessage: digest, Certificates: true, Nonce: nonce}).Marshal()
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/timestamp-query")
	req.Header.Set("Accept", "application/timestamp-reply")
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("tsa: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("tsa: %s answered %s", c.url, resp.Status)
	}
	reply, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("tsa: %w", err)
	}
	ts, err := timestamp.ParseResponse(reply)
	if err != nil {
		return nil, fmt.Errorf("tsa: %s: %w", c.url, err)
	}
	if ts.Nonce == nil || ts.Nonce.Cmp(nonce) != 0 {
		return nil, fmt.Errorf("tsa: %s answered another request", c.url)
	}
	if _, err := c.Check(ts.RawToken, digest); err != nil {
		return nil, err
	}
	return ts.RawToken, nil
}

// Check checks that token is a timestamp of digest, signed by a certificate
// for timestamping that chains to a trusted root and was valid then, and
// returns the time it states.
func (c *Client) Check(token, digest []byte) (time.Time, error) {
	ts, err := timestamp.Parse(token)
	if err != nil {
		return time.Time{}, fmt.Errorf("%w: %v", ErrUntrusted, err)
	}
	if !ts.AddTSACertificate {
		return time.Time{}, fmt.Errorf("%w: it holds no certificate", ErrUntrusted)
	}
	if ts.HashAlgorithm != crypto.SHA256 || !bytes.Equal(ts.HashedMessage, digest) {
		return time.Time{}, ErrMismatch
	}
	p7, err := pkcs7.Parse(token)
	if err != nil {
		return time.Time{}, fmt.Errorf("%w: %v", ErrUntrusted, err)
	}
	roots := c.roots
	if roots == nil {
		roots = mozillaRoots()
	}
	intermediates := x509.NewCertPool()
	for _, cert := range p7.Certificates {
		intermediates.AddCert(cert)
	}
	err = p7.VerifyWithOpts(x509.VerifyOptions{
		Roots: roots, Intermediates: intermediates, CurrentTime: ts.Time,
		KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageTimeStamping},
	})
	if err != nil {
		return time.Time{}, fmt.Errorf("%w: %v", ErrUntrusted, err)
	}
	return ts.Time.UTC(), nil
}

// mozillaRoots are the roots of Mozilla's trust store, built into the binary,
// so a token checks out the same everywhere. A system's own checker may judge
// a timestamping certificate by rules of its own: macOS refuses DigiCert's.
var mozillaRoots = sync.OnceValue(func() *x509.CertPool {
	pool := x509.NewCertPool()
	for r := range bundle.Roots() {
		cert, err := x509.ParseCertificate(r.Certificate)
		if err != nil {
			continue
		}
		pool.AddCertWithConstraint(cert, r.Constraint)
	}
	return pool
})
