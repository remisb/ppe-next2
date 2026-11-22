package main

import (
	"net/http"
	"strings"
	"testing"
)

// The Orders list refuses a filter given twice, and one it does not know, as
// every other list does, rather than silently taking the first value.
func TestOrderListRefusesUnknownAndRepeatedParameters(t *testing.T) {
	api := newTestAPI(t)
	tok := api.tokenWith(t)
	for _, q := range []string{"status=ORDERED&status=GIVEN", "page=1&page=2", "colour=red"} {
		rec := api.do(t, "GET", "/api/v1/orders?"+q, tok, nil)
		if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "unknown or repeated query parameter") {
			t.Errorf("%s = %d %s, want 400 naming the parameter", q, rec.Code, rec.Body)
		}
	}
}
