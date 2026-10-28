package middleware

import (
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
)

type slowReport struct {
	method, route string
	status        int
	ownerID       int64
}

// A request slower than the threshold is reported once, by route, with its
// status and owner; a quick one, and /health however slow, are not.
func TestTiming_ReportsOnlySlowRequests(t *testing.T) {
	var got []slowReport
	original := reportSlow
	t.Cleanup(func() { reportSlow = original })
	reportSlow = func(_ *http.Request, method, route string, _ time.Duration, status int, ownerID int64) {
		got = append(got, slowReport{method, route, status, ownerID})
	}

	e := echo.New()
	e.Use(Timing(20 * time.Millisecond))
	e.GET("/api/tenants/:id", func(c echo.Context) error {
		c.Set(string(OwnerIDKey), int64(4))
		if c.Param("id") == "1" {
			time.Sleep(40 * time.Millisecond)
		}
		return c.NoContent(http.StatusOK)
	})
	e.GET("/api/broken", func(c echo.Context) error {
		time.Sleep(40 * time.Millisecond)
		return echo.NewHTTPError(http.StatusBadGateway, "upstream")
	})
	e.GET("/health", func(c echo.Context) error {
		time.Sleep(40 * time.Millisecond)
		return c.NoContent(http.StatusOK)
	})

	for _, path := range []string{"/api/tenants/1", "/api/tenants/2", "/api/broken", "/health"} {
		e.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, path, nil))
	}

	want := []slowReport{
		{"GET", "/api/tenants/:id", http.StatusOK, 4},
		{"GET", "/api/broken", http.StatusBadGateway, 0},
	}
	if !slices.Equal(got, want) {
		t.Fatalf("reported %+v, want %+v", got, want)
	}
}

// Without the two Sentry headers in the allow list, every traced request
// fails its preflight in production.
func TestAllowHeaders_CarryTheTrace(t *testing.T) {
	for _, h := range []string{"Authorization", "Content-Type", "sentry-trace", "baggage"} {
		if !slices.Contains(AllowHeaders, h) {
			t.Errorf("%s missing from AllowHeaders", h)
		}
	}
}
