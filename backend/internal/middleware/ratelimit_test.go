package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
)

// upload fires one request at the limited endpoint from the given client
// address and returns the response recorder.
func upload(t *testing.T, e *echo.Echo, remoteAddr string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/public/upload", nil)
	req.RemoteAddr = remoteAddr
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

func limitedServer() *echo.Echo {
	e := echo.New()
	e.HideBanner = true
	e.POST("/public/upload", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"url": "https://example.invalid/x.jpg"})
	}, PublicUploadRateLimiter())
	return e
}

func TestPublicUploadRateLimiter_AllowsTheBurst(t *testing.T) {
	e := limitedServer()

	// A registration submits three files; the burst has to cover several
	// people back-to-back behind one NAT'd hostel Wi-Fi without stalling.
	for i := 1; i <= publicUploadBurst; i++ {
		rec := upload(t, e, "203.0.113.10:5000")
		if rec.Code != http.StatusOK {
			t.Fatalf("upload %d of %d: got %d, want 200", i, publicUploadBurst, rec.Code)
		}
	}
}

func TestPublicUploadRateLimiter_DeniesPastTheBurst(t *testing.T) {
	e := limitedServer()

	for i := 0; i < publicUploadBurst; i++ {
		upload(t, e, "203.0.113.11:5000")
	}

	rec := upload(t, e, "203.0.113.11:5000")
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("upload %d: got %d, want 429", publicUploadBurst+1, rec.Code)
	}

	// The frontend reads body.error (lib/api.ts) and shows a generic
	// "Upload failed" for anything else, so the envelope matters.
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("deny body is not JSON: %v (%s)", err, rec.Body.String())
	}
	if body["error"] == "" {
		t.Fatalf(`deny body has no "error" key: %s`, rec.Body.String())
	}
}

func TestPublicUploadRateLimiter_IsPerClient(t *testing.T) {
	e := limitedServer()

	for i := 0; i < publicUploadBurst+5; i++ {
		upload(t, e, "203.0.113.12:5000")
	}

	// One exhausted visitor must not lock out an unrelated one.
	rec := upload(t, e, "203.0.113.13:5000")
	if rec.Code != http.StatusOK {
		t.Fatalf("second client: got %d, want 200", rec.Code)
	}
}
