package middleware

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
	"golang.org/x/time/rate"
)

// loginServer answers 200 when the body is "right" and 401 otherwise, behind
// the given limiter — the shape of both real login handlers.
func loginServer(f *failureLimiter) *echo.Echo {
	e := echo.New()
	e.HideBanner = true
	e.POST("/auth/login", func(c echo.Context) error {
		body, _ := io.ReadAll(c.Request().Body)
		if string(body) == "right" {
			return c.JSON(http.StatusOK, map[string]string{"token": "t"})
		}
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid email or password"})
	}, f.middleware)
	return e
}

func login(e *echo.Echo, ip, password string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/auth/login", strings.NewReader(password))
	req.RemoteAddr = ip + ":5000"
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

func testFailureLimiter() (*failureLimiter, *time.Time) {
	clock := time.Date(2026, 9, 23, 10, 0, 0, 0, time.UTC)
	f := newFailureLimiter(rate.Every(loginFailureRefill), loginFailureBurst, loginFailureExpiry)
	f.now = func() time.Time { return clock }
	return f, &clock
}

func TestFailedLoginLimiter_SuccessesAreFree(t *testing.T) {
	f, _ := testFailureLimiter()
	e := loginServer(f)

	// A hostel's worth of people signing in correctly from one Wi-Fi address.
	for i := 1; i <= 100; i++ {
		if rec := login(e, "203.0.113.20", "right"); rec.Code != http.StatusOK {
			t.Fatalf("success %d: got %d, want 200", i, rec.Code)
		}
	}
}

func TestFailedLoginLimiter_BlocksAfterTheBurstOfFailures(t *testing.T) {
	f, _ := testFailureLimiter()
	e := loginServer(f)

	for i := 1; i <= loginFailureBurst; i++ {
		if rec := login(e, "203.0.113.21", "wrong"); rec.Code != http.StatusUnauthorized {
			t.Fatalf("failure %d: got %d, want 401", i, rec.Code)
		}
	}

	// Blocked now — including the correct password, or the budget would only
	// stop attackers who are also bad at guessing.
	rec := login(e, "203.0.113.21", "right")
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("after %d failures: got %d, want 429", loginFailureBurst, rec.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || body["error"] == "" {
		t.Fatalf(`deny body must carry an "error" key: %s`, rec.Body.String())
	}
}

func TestFailedLoginLimiter_RefillsOverTime(t *testing.T) {
	f, clock := testFailureLimiter()
	e := loginServer(f)

	for i := 0; i < loginFailureBurst; i++ {
		login(e, "203.0.113.22", "wrong")
	}
	if rec := login(e, "203.0.113.22", "right"); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("got %d, want 429 while exhausted", rec.Code)
	}

	*clock = clock.Add(loginFailureRefill)
	if rec := login(e, "203.0.113.22", "right"); rec.Code != http.StatusOK {
		t.Fatalf("one refill later: got %d, want 200", rec.Code)
	}
}

func TestFailedLoginLimiter_IsPerClient(t *testing.T) {
	f, _ := testFailureLimiter()
	e := loginServer(f)

	for i := 0; i < loginFailureBurst+5; i++ {
		login(e, "203.0.113.23", "wrong")
	}
	if rec := login(e, "203.0.113.24", "right"); rec.Code != http.StatusOK {
		t.Fatalf("unrelated client: got %d, want 200", rec.Code)
	}
}

func TestFailedLoginLimiter_OwnerAndTenantBudgetsAreSeparate(t *testing.T) {
	e := echo.New()
	e.HideBanner = true
	deny := func(c echo.Context) error {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "no"})
	}
	e.POST("/tenant-auth/login", deny, FailedLoginLimiter())
	e.POST("/auth/login", func(c echo.Context) error {
		return c.JSON(http.StatusOK, nil)
	}, FailedLoginLimiter())

	for i := 0; i < loginFailureBurst+1; i++ {
		req := httptest.NewRequest(http.MethodPost, "/tenant-auth/login", nil)
		req.RemoteAddr = "203.0.113.25:5000"
		e.ServeHTTP(httptest.NewRecorder(), req)
	}

	req := httptest.NewRequest(http.MethodPost, "/auth/login", nil)
	req.RemoteAddr = "203.0.113.25:5000"
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("owner login after tenant failures: got %d, want 200", rec.Code)
	}
}

func TestPublicRegisterRateLimiter_IsPerOwner(t *testing.T) {
	e := echo.New()
	e.HideBanner = true
	e.POST("/public/register/:ownerId", func(c echo.Context) error {
		return c.JSON(http.StatusCreated, nil)
	}, PublicRegisterRateLimiter())

	post := func(owner string) int {
		req := httptest.NewRequest(http.MethodPost, "/public/register/"+owner, nil)
		req.RemoteAddr = "203.0.113.26:5000"
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		return rec.Code
	}

	for i := 1; i <= registerBurst; i++ {
		if code := post("4"); code != http.StatusCreated {
			t.Fatalf("registration %d: got %d, want 201", i, code)
		}
	}
	if code := post("4"); code != http.StatusTooManyRequests {
		t.Fatalf("past the burst: got %d, want 429", code)
	}
	// Same network, a different hostel's link: its own budget.
	if code := post("5"); code != http.StatusCreated {
		t.Fatalf("other owner: got %d, want 201", code)
	}
}
