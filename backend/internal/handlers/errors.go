package handlers

import (
	"net/http"

	"github.com/labstack/echo/v4"
)

// errorResponse is the shape every error the API returns takes.
func errorResponse(msg string) map[string]string {
	return map[string]string{"error": msg}
}

// serverError logs the underlying cause, then returns the generic 500 the
// client sees.
//
// The two halves are deliberately different. The client gets a vague message
// because a database error can carry schema, query text and row contents, and
// none of that belongs in a response. But the cause must not be thrown away:
// the tenant portal's payment submission returned "failed to submit payment"
// for months while the real error — a Postgres type-deduction failure — went
// nowhere, so the feature looked merely broken rather than diagnosably broken.
//
// This is also the single place to attach error tracking (Sentry/GlitchTip)
// when it is added, rather than fifty call sites — see docs/DEPLOYMENT.md.
func serverError(c echo.Context, err error, msg string) error {
	c.Logger().Errorf("%s %s — %s: %v", c.Request().Method, c.Path(), msg, err)
	return c.JSON(http.StatusInternalServerError, errorResponse(msg))
}
