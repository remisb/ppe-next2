package main

import (
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// clientAddr finds the address rate limits are keyed on. Behind a reverse
// proxy every request arrives from the proxy, so a limit keyed on RemoteAddr
// would be shared by all clients; X-Forwarded-For names the real client, but
// anyone can send that header, so it is believed only from trusted proxies.
type clientAddr struct {
	trusted []netip.Prefix
}

// key returns the client address. When the connection comes from a trusted
// proxy it walks X-Forwarded-For right to left, skipping trusted hops, and
// returns the first address it does not trust: entries left of that one were
// written by the client and could be anything.
func (c clientAddr) key(r *http.Request) string {
	peer, ok := parseAddr(r.RemoteAddr)
	if !ok {
		return strings.TrimSpace(r.RemoteAddr)
	}
	if !c.isTrusted(peer) {
		return peer.String()
	}
	hops := r.Header.Values("X-Forwarded-For")
	last := peer
	for i := len(hops) - 1; i >= 0; i-- {
		parts := strings.Split(hops[i], ",")
		for j := len(parts) - 1; j >= 0; j-- {
			a, ok := parseAddr(parts[j])
			if !ok {
				// A trusted proxy writes valid addresses; stop at the last
				// hop we could vouch for.
				return last.String()
			}
			if !c.isTrusted(a) {
				return a.String()
			}
			last = a
		}
	}
	return last.String()
}

func (c clientAddr) isTrusted(a netip.Addr) bool {
	for _, p := range c.trusted {
		if p.Contains(a) {
			return true
		}
	}
	return false
}

// parseAddr accepts "ip", "ip:port" and "[ipv6]:port", and unmaps
// IPv4-in-IPv6 so 127.0.0.1 and ::ffff:127.0.0.1 are the same client.
func parseAddr(s string) (netip.Addr, bool) {
	s = strings.TrimSpace(s)
	if host, _, err := net.SplitHostPort(s); err == nil {
		s = host
	}
	a, err := netip.ParseAddr(s)
	if err != nil {
		return netip.Addr{}, false
	}
	return a.Unmap().WithZone(""), true
}

// parsePrefixes reads API_TRUSTED_PROXIES: CIDRs or bare addresses.
func parsePrefixes(list []string) ([]netip.Prefix, error) {
	out := make([]netip.Prefix, 0, len(list))
	for _, s := range list {
		if p, err := netip.ParsePrefix(s); err == nil {
			out = append(out, p.Masked())
			continue
		}
		a, err := netip.ParseAddr(s)
		if err != nil {
			return nil, fmt.Errorf("%q is not an IP address or CIDR", s)
		}
		out = append(out, netip.PrefixFrom(a.Unmap(), a.Unmap().BitLen()))
	}
	return out, nil
}
