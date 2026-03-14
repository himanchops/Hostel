package middleware

import (
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"
	"github.com/winnow/hostel/internal/auth"
)

type contextKey string

const OwnerIDKey contextKey = "owner_id"

func AuthMiddleware(authService *auth.Service) echo.MiddlewareFunc {
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

			c.Set(string(OwnerIDKey), claims.OwnerID)
			return next(c)
		}
	}
}

// GetOwnerID extracts the owner ID from the context
func GetOwnerID(c echo.Context) int64 {
	return c.Get(string(OwnerIDKey)).(int64)
}
