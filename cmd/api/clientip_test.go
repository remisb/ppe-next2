package main

import (
	"net/http/httptest"
	"testing"
)

func TestClientAddrKey(t *testing.T) {
	trusted, err := parsePrefixes([]string{"127.0.0.1", "::1", "10.0.0.0/8"})
	if err != nil {
		t.Fatal(err)
	}
	c := clientAddr{trusted: trusted}
	tests := []struct {
		name   string
		remote string
		xff    []string
		want   string
	}{
		{"direct client", "203.0.113.7:5000", nil, "203.0.113.7"},
		{"untrusted peer cannot spoof", "203.0.113.7:5000", []string{"198.51.100.1"}, "203.0.113.7"},
		{"trusted proxy names the client", "127.0.0.1:40000", []string{"203.0.113.7"}, "203.0.113.7"},
		{"ipv6 loopback proxy", "[::1]:40000", []string{"2001:db8::5"}, "2001:db8::5"},
		{"mapped loopback is loopback", "[::ffff:127.0.0.1]:40000", []string{"203.0.113.7"}, "203.0.113.7"},
		{"client-supplied entries left of the client are ignored", "127.0.0.1:40000", []string{"6.6.6.6, 203.0.113.7"}, "203.0.113.7"},
		{"trusted hops are skipped", "127.0.0.1:40000", []string{"203.0.113.7, 10.1.2.3"}, "203.0.113.7"},
		{"repeated headers are one list", "127.0.0.1:40000", []string{"6.6.6.6", "203.0.113.7"}, "203.0.113.7"},
		{"garbage stops at the last trusted hop", "127.0.0.1:40000", []string{"not-an-ip"}, "127.0.0.1"},
		{"no header: the proxy itself", "127.0.0.1:40000", nil, "127.0.0.1"},
		{"all hops trusted: the leftmost", "127.0.0.1:40000", []string{"10.9.9.9, 10.1.1.1"}, "10.9.9.9"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequest("POST", "/", nil)
			r.RemoteAddr = tt.remote
			for _, h := range tt.xff {
				r.Header.Add("X-Forwarded-For", h)
			}
			if got := c.key(r); got != tt.want {
				t.Errorf("key = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestClientAddrTrustsNothingByDefault(t *testing.T) {
	r := httptest.NewRequest("POST", "/", nil)
	r.RemoteAddr = "127.0.0.1:40000"
	r.Header.Set("X-Forwarded-For", "203.0.113.7")
	if got := (clientAddr{}).key(r); got != "127.0.0.1" {
		t.Errorf("key = %q, want the peer", got)
	}
}

func TestParsePrefixes(t *testing.T) {
	got, err := parsePrefixes([]string{"127.0.0.1", "10.0.0.0/8", "::1", "172.16.5.4/12"})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"127.0.0.1/32", "10.0.0.0/8", "::1/128", "172.16.0.0/12"}
	for i, p := range got {
		if p.String() != want[i] {
			t.Errorf("prefix %d = %s, want %s", i, p, want[i])
		}
	}
	if _, err := parsePrefixes([]string{"localhost"}); err == nil {
		t.Error("a host name should be rejected")
	}
}
