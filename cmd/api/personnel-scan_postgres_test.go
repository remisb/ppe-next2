package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"image"
	"image/jpeg"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/remisb/ppe-next2/internal/domain/role"
	"github.com/remisb/ppe-next2/internal/personnel/scan"
)

// keepScan sends a scan as Scan Document does: the "scan" JSON part and the
// pages as page-1 … page-N.
func (a *testAPI) keepScan(t *testing.T, token string, meta any, pages [][]byte) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	b, err := json.Marshal(meta)
	if err != nil {
		t.Fatal(err)
	}
	if err := mw.WriteField("scan", string(b)); err != nil {
		t.Fatal(err)
	}
	for i, p := range pages {
		fw, err := mw.CreateFormFile("page-"+strconv.Itoa(i+1), "page.jpg")
		if err != nil {
			t.Fatal(err)
		}
		fw.Write(p)
	}
	mw.Close()
	req := httptest.NewRequest("POST", "/api/v1/personnel/scans", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	a.handler.ServeHTTP(rec, req)
	return rec
}

func scanPage(t *testing.T, w, h int) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := jpeg.Encode(&b, image.NewGray(image.Rect(0, 0, w, h)), nil); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// Kept scans (Scan Document): keep, list, download (the zip compared with
// the pages sent), the uploader alone, and remove.
func TestPostgresPersonnelScansHTTP(t *testing.T) {
	api, pool := newPostgresAPI(t)
	_, clerk := api.userWith(t, role.KeyPersonnel)
	_, other := api.userWith(t, role.KeyPersonnel)
	_, mgr := api.userWith(t, role.KeyManager)
	pages := [][]byte{scanPage(t, 50, 35), scanPage(t, 35, 50)}
	meta := map[string]any{"surname": "Žemaitė", "given_names": "Ona Marija", "kind": "id_card", "number": "AB1234567"}

	if rec := api.keepScan(t, mgr, meta, pages); rec.Code != http.StatusForbidden {
		t.Errorf("keep without personnel.documents.manage = %d", rec.Code)
	}
	rec := api.keepScan(t, clerk, meta, pages)
	if rec.Code != http.StatusCreated {
		t.Fatalf("keep = %d %s", rec.Code, rec.Body)
	}
	kept := decode[scan.Scan](t, rec.Body.Bytes())
	if kept.FileName != "Žemaitė_Ona_Marija_id-card.zip" || kept.Pages != 2 || rec.Header().Get("Cache-Control") != "no-store" {
		t.Errorf("kept = %+v (Cache-Control %q)", kept, rec.Header().Get("Cache-Control"))
	}

	// Refused: no pages, more than ten, bytes that are not a JPEG, an unknown field.
	if rec := api.keepScan(t, clerk, meta, nil); rec.Code != http.StatusBadRequest {
		t.Errorf("no pages = %d %s", rec.Code, rec.Body)
	}
	eleven := make([][]byte, 11)
	for i := range eleven {
		eleven[i] = pages[0]
	}
	if rec := api.keepScan(t, clerk, meta, eleven); rec.Code != http.StatusBadRequest && rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("eleven pages = %d %s", rec.Code, rec.Body)
	}
	if rec := api.keepScan(t, clerk, meta, [][]byte{[]byte("not a jpeg")}); rec.Code != http.StatusUnsupportedMediaType {
		t.Errorf("not a JPEG = %d %s", rec.Code, rec.Body)
	}
	if rec := api.keepScan(t, clerk, map[string]any{"surname": "A", "kind": "passport", "extra": 1}, pages); rec.Code != http.StatusBadRequest {
		t.Errorf("unknown field = %d", rec.Code)
	}

	rec = api.do(t, "GET", "/api/v1/personnel/scans", clerk, nil)
	if list := decode[[]scan.Scan](t, rec.Body.Bytes()); rec.Code != http.StatusOK || len(list) != 1 || list[0].ID != kept.ID {
		t.Errorf("list = %d %s", rec.Code, rec.Body)
	}
	rec = api.do(t, "GET", "/api/v1/personnel/scans", other, nil)
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != "[]" {
		t.Errorf("another user's list = %d %s", rec.Code, rec.Body)
	}

	archive := "/api/v1/personnel/scans/" + kept.ID.String() + "/archive"
	if rec := api.do(t, "GET", archive, other, nil); rec.Code != http.StatusNotFound {
		t.Errorf("another user's download = %d", rec.Code)
	}
	rec = api.do(t, "GET", archive, clerk, nil)
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "application/zip" {
		t.Fatalf("download = %d %s", rec.Code, rec.Header())
	}
	if cd := rec.Header().Get("Content-Disposition"); !strings.HasPrefix(cd, "attachment;") || attachmentFileName(t, cd) != kept.FileName {
		t.Errorf("Content-Disposition = %q", cd)
	}
	zr, err := zip.NewReader(bytes.NewReader(rec.Body.Bytes()), int64(rec.Body.Len()))
	if err != nil {
		t.Fatal(err)
	}
	if len(zr.File) != 2 {
		t.Fatalf("zip has %d files", len(zr.File))
	}
	for i, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		got, _ := io.ReadAll(rc)
		rc.Close()
		if want := []string{"page-01.jpg", "page-02.jpg"}[i]; f.Name != want || !bytes.Equal(got, pages[i]) {
			t.Errorf("zip file %d = %s (%d bytes), want %s as sent", i, f.Name, len(got), want)
		}
	}

	// The events carry ids and page counts only, never a name or number.
	var events string
	if err := pool.QueryRow(t.Context(), `SELECT string_agg(event || ' ' || coalesce(before::text, '') || coalesce(after::text, ''), '|' ORDER BY occurred_at)
		FROM audit_events WHERE entity_type = 'personnel_scan' AND entity_id = $1`, kept.ID).Scan(&events); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(events, scan.EventKept) || !strings.Contains(events, scan.EventDownloaded) ||
		strings.Contains(events, "Žemait") || strings.Contains(events, "AB1234567") {
		t.Errorf("events = %s", events)
	}

	if rec := api.do(t, "DELETE", "/api/v1/personnel/scans/"+kept.ID.String(), other, nil); rec.Code != http.StatusNotFound {
		t.Errorf("another user's remove = %d", rec.Code)
	}
	if rec := api.do(t, "DELETE", "/api/v1/personnel/scans/"+kept.ID.String(), clerk, nil); rec.Code != http.StatusNoContent {
		t.Errorf("remove = %d %s", rec.Code, rec.Body)
	}
	if rec := api.do(t, "GET", archive, clerk, nil); rec.Code != http.StatusNotFound {
		t.Errorf("download after remove = %d", rec.Code)
	}
}

// attachmentFileName reads a Content-Disposition's file name, filename* first.
func attachmentFileName(t *testing.T, cd string) string {
	t.Helper()
	_, params, err := mime.ParseMediaType(cd)
	if err != nil {
		t.Fatal(err)
	}
	return params["filename"]
}
