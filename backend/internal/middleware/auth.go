package middleware

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"
	"github.com/winnow/hostel/internal/auth"
	"github.com/winnow/hostel/internal/observability"
)

type contextKey string

const (
	OwnerIDKey  contextKey = "owner_id"
	TenantIDKey contextKey = "tenant_id"
)

// TokenVersionLookup returns an owner's current owners.token_version, or
// sql.ErrNoRows when the owner no longer exists.
//
// A function rather than a *sqlx.DB so this package stays free of the
// database, and so the tests can hand it a map.
type TokenVersionLookup func(ownerID int64) (int, error)

// ErrSessionEnded is what a revoked token hears. Deliberately not "invalid
// token": the token is perfectly well-formed, the owner ended the session —
// from another device, or by changing the password — and saying so tells the
// person holding a half-typed form why they have to sign in again.
const ErrSessionEnded = "your session has ended — sign in again"

// AuthMiddleware checks the signature, then asks the database whether the
// token has been revoked since it was issued.
//
// The second step costs one primary-key lookup per request. That is the price
// of sign-out meaning something: without it a token copied before sign-out
// kept working for its full 24 hours, which the UX audit demonstrated by
// replaying one against /api/me after signing out.
func AuthMiddleware(authService *auth.Service, currentVersion TokenVersionLookup) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			authHeader := c.Request().Header.Get("Authorization")
			if authHeader == "" {
				return c.JSON(http.StatusUnauthorized, map[string]string{
					"error": "missing authorization header",
				})
			}

			parts := strings.Split(authHeader, " ")
			if len(parts) != 2 || parts[0] != "Bearer" {
				return c.JSON(http.StatusUnauthorized, map[string]string{
					"error": "invalid authorization header format",
				})
			}

			claims, err := authService.ValidateToken(parts[1])
			if err != nil {
				return c.JSON(http.StatusUnauthorized, map[string]string{
					"error": "invalid token",
				})
			}

			version, err := currentVersion(claims.OwnerID)
			if errors.Is(err, sql.ErrNoRows) {
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid token"})
			}
			if err != nil {
				// Not a 401: the token may be fine and the database is not.
				// Answering "sign in again" would send the owner round a login
				// loop that cannot fix a database outage.
				c.Logger().Errorf("%s %s — failed to check token version: %v", c.Request().Method, c.Path(), err)
				observability.CaptureError(err, c.Request(), c.Request().Method, c.Path(), "failed to check session", claims.OwnerID)
				return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to check session"})
			}
			if version != claims.TokenVersion {
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": ErrSessionEnded})
			}

			c.Set(string(OwnerIDKey), claims.OwnerID)
			return next(c)
		}
	}
}

// GetOwnerID extracts the owner ID from the context
func GetOwnerID(c echo.Context) int64 {
	return c.Get(string(OwnerIDKey)).(int64)
}

func TenantAuthMiddleware(authService *auth.Service) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			authHeader := c.Request().Header.Get("Authorization")
			if authHeader == "" {
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "missing authorization header"})
			}
			parts := strings.Split(authHeader, " ")
			if len(parts) != 2 || parts[0] != "Bearer" {
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid authorization header format"})
			}
			claims, err := authService.ValidateTenantToken(parts[1])
			if err != nil {
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid token"})
			}
			c.Set(string(TenantIDKey), claims.TenantID)
			return next(c)
		}
	}
}

func GetTenantID(c echo.Context) int64 {
	return c.Get(string(TenantIDKey)).(int64)
}
