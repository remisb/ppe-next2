package tsa

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"errors"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/digitorus/timestamp"
)

// testService is a timestamp service with its own root, as a public one has
// (its certificate is for timestamping only).
type testService struct {
	roots *x509.CertPool
	cert  *x509.Certificate
	key   crypto.Signer
	at    time.Time
	nonce func(*big.Int) *big.Int
}

func newTestService(t *testing.T) *testService {
	t.Helper()
	rootKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	root := &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "Test Root"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(24 * time.Hour),
		IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign,
	}
	rootDER, err := x509.CreateCertificate(rand.Reader, root, root, &rootKey.PublicKey, rootKey)
	if err != nil {
		t.Fatal(err)
	}
	root, _ = x509.ParseCertificate(rootDER)
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	leaf := &x509.Certificate{
		SerialNumber: big.NewInt(2), Subject: pkix.Name{CommonName: "Test TSA"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(24 * time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageTimeStamping},
	}
	leafDER, err := x509.CreateCertificate(rand.Reader, leaf, root, &key.PublicKey, rootKey)
	if err != nil {
		t.Fatal(err)
	}
	cert, _ := x509.ParseCertificate(leafDER)
	roots := x509.NewCertPool()
	roots.AddCert(root)
	return &testService{roots: roots, cert: cert, key: key, at: time.Now().UTC().Truncate(time.Second), nonce: func(n *big.Int) *big.Int { return n }}
}

func (s *testService) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	req, err := timestamp.ParseRequest(body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	ts := timestamp.Timestamp{
		HashAlgorithm: req.HashAlgorithm, HashedMessage: req.HashedMessage, Time: s.at,
		Nonce: s.nonce(req.Nonce), Policy: asn1.ObjectIdentifier{1, 2, 3, 4, 1}, AddTSACertificate: true,
	}
	reply, err := ts.CreateResponseWithOpts(s.cert, s.key, crypto.SHA256)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/timestamp-reply")
	_, _ = w.Write(reply)
}

func TestStampAndCheck(t *testing.T) {
	svc := newTestService(t)
	srv := httptest.NewServer(svc)
	defer srv.Close()
	c := New(srv.URL, WithRoots(svc.roots))
	digest := sha256.Sum256([]byte("a seal"))

	token, err := c.Stamp(context.Background(), digest[:])
	if err != nil {
		t.Fatalf("Stamp: %v", err)
	}
	at, err := c.Check(token, digest[:])
	if err != nil || !at.Equal(svc.at) {
		t.Fatalf("Check = %v, %v; want %v", at, err, svc.at)
	}

	other := sha256.Sum256([]byte("another seal"))
	if _, err := c.Check(token, other[:]); !errors.Is(err, ErrMismatch) {
		t.Errorf("another hash: %v, want ErrMismatch", err)
	}
	// Another service's roots, as a token made by someone else would meet.
	if _, err := New(srv.URL, WithRoots(newTestService(t).roots)).Check(token, digest[:]); !errors.Is(err, ErrUntrusted) {
		t.Errorf("untrusted root: %v, want ErrUntrusted", err)
	}
	altered := append([]byte(nil), token...)
	altered[len(altered)-10] ^= 0xff
	if _, err := c.Check(altered, digest[:]); err == nil {
		t.Error("an altered token was accepted")
	}
	if _, err := c.Stamp(context.Background(), []byte("short")); err == nil {
		t.Error("a hash that is not SHA-256 was sent")
	}
}

func TestStampRefusesAnotherRequestsAnswer(t *testing.T) {
	svc := newTestService(t)
	svc.nonce = func(*big.Int) *big.Int { return big.NewInt(42) }
	srv := httptest.NewServer(svc)
	defer srv.Close()
	digest := sha256.Sum256([]byte("a seal"))
	if _, err := New(srv.URL, WithRoots(svc.roots)).Stamp(context.Background(), digest[:]); err == nil {
		t.Error("an answer with another nonce was accepted")
	}
}

func TestStampReportsAServiceError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "down", http.StatusServiceUnavailable)
	}))
	defer srv.Close()
	digest := sha256.Sum256([]byte("a seal"))
	if _, err := New(srv.URL).Stamp(context.Background(), digest[:]); err == nil {
		t.Error("a 503 was taken for a timestamp")
	}
}

// A real service, when API_TEST_TSA_URL names one: its token must check out
// against the system's roots, as the API's will.
func TestLiveService(t *testing.T) {
	url := os.Getenv("API_TEST_TSA_URL")
	if url == "" {
		t.Skip("API_TEST_TSA_URL is not set")
	}
	c := New(url)
	digest := sha256.Sum256([]byte("ppe-next2 tsa test"))
	token, err := c.Stamp(context.Background(), digest[:])
	if err != nil {
		t.Fatalf("Stamp: %v", err)
	}
	at, err := c.Check(token, digest[:])
	if err != nil || time.Since(at) > time.Hour || time.Until(at) > time.Minute {
		t.Fatalf("Check = %v, %v", at, err)
	}
	t.Logf("%s: %d-byte token at %s", url, len(token), at)
}
