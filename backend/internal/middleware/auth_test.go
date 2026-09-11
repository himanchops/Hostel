package middleware

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/winnow/hostel/internal/auth"
)

// versions stands in for owners.token_version. A missing key is a deleted
// owner; the special owner 99 is a database that is down.
type versions map[int64]int

func (v versions) lookup(ownerID int64) (int, error) {
	if ownerID == 99 {
		return 0, errors.New("connection refused")
	}
	version, ok := v[ownerID]
	if !ok {
		return 0, sql.ErrNoRows
	}
	return version, nil
}

func protectedServer(svc *auth.Service, v versions) *echo.Echo {
	e := echo.New()
	e.HideBanner = true
	e.GET("/api/me", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]int64{"owner_id": GetOwnerID(c)})
	}, AuthMiddleware(svc, v.lookup))
	return e
}

func callMe(t *testing.T, e *echo.Echo, token string) (int, string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	msg, _ := body["error"].(string)
	return rec.Code, msg
}

func mustToken(t *testing.T, svc *auth.Service, ownerID int64, version int) string {
	t.Helper()
	tok, err := svc.GenerateToken(ownerID, version)
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

func TestAuthMiddleware_CurrentVersionIsAccepted(t *testing.T) {
	svc := auth.NewService("test-secret", time.Hour)
	e := protectedServer(svc, versions{4: 2})

	if code, msg := callMe(t, e, mustToken(t, svc, 4, 2)); code != http.StatusOK {
		t.Fatalf("got %d (%q), want 200", code, msg)
	}
}

// The audit's finding: sign out, replay the token, still 200. After a password
// change or "sign out everywhere" the column moves on and the old token must
// stop working — with a message that says why, not "invalid token".
func TestAuthMiddleware_TokenFromBeforeARevocationIsRefused(t *testing.T) {
	svc := auth.NewService("test-secret", time.Hour)
	old := mustToken(t, svc, 4, 2)
	e := protectedServer(svc, versions{4: 3})

	code, msg := callMe(t, e, old)
	if code != http.StatusUnauthorized {
		t.Fatalf("got %d, want 401", code)
	}
	if msg != ErrSessionEnded {
		t.Errorf("message = %q, want %q", msg, ErrSessionEnded)
	}
}

// Every token issued before the column existed carries no "tv" claim, which
// decodes as 0 — the column's default. Deploying this must not sign everyone out.
func TestAuthMiddleware_TokensFromBeforeVersioningStillWork(t *testing.T) {
	svc := auth.NewService("test-secret", time.Hour)
	e := protectedServer(svc, versions{4: 0})

	if code, msg := callMe(t, e, mustToken(t, svc, 4, 0)); code != http.StatusOK {
		t.Fatalf("got %d (%q), want 200", code, msg)
	}
}

func TestAuthMiddleware_DeletedOwnerIsRefused(t *testing.T) {
	svc := auth.NewService("test-secret", time.Hour)
	e := protectedServer(svc, versions{})

	if code, _ := callMe(t, e, mustToken(t, svc, 4, 0)); code != http.StatusUnauthorized {
		t.Fatalf("got %d, want 401", code)
	}
}

// A database outage is not a reason to sign anyone out. A 401 here would send
// the owner round a login loop that cannot fix it.
func TestAuthMiddleware_LookupFailureIsA500NotA401(t *testing.T) {
	svc := auth.NewService("test-secret", time.Hour)
	e := protectedServer(svc, versions{})

	if code, _ := callMe(t, e, mustToken(t, svc, 99, 0)); code != http.StatusInternalServerError {
		t.Fatalf("got %d, want 500", code)
	}
}

// A tenant token is signed with the same key. It must not pass as an owner's
// just because the version happens to line up.
func TestAuthMiddleware_TenantTokenIsNotAnOwnerToken(t *testing.T) {
	svc := auth.NewService("test-secret", time.Hour)
	tenantTok, err := svc.GenerateTenantToken(4)
	if err != nil {
		t.Fatal(err)
	}
	e := protectedServer(svc, versions{4: 0})

	if code, _ := callMe(t, e, tenantTok); code != http.StatusUnauthorized {
		t.Fatalf("got %d, want 401", code)
	}
}
