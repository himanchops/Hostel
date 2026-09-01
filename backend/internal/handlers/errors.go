package handlers

import (
	"net/http"

	"github.com/labstack/echo/v4"
	appMiddleware "github.com/winnow/hostel/internal/middleware"
	"github.com/winnow/hostel/internal/observability"
)

// errorResponse is the shape every error the API returns takes.
func errorResponse(msg string) map[string]string {
	return map[string]string{"error": msg}
}

// serverError logs the underlying cause, reports it to the error tracker, then
// returns the generic 500 the client sees.
//
// The parts are deliberately different. The client gets a vague message
// because a database error can carry schema, query text and row contents, and
// none of that belongs in a response. But the cause must not be thrown away:
// the tenant portal's payment submission returned "failed to submit payment"
// for months while the real error — a Postgres type-deduction failure — went
// nowhere, so the feature looked merely broken rather than diagnosably broken.
//
// stdout keeps the full cause for whoever is tailing Render. The tracker adds
// the two things a tail cannot: it outlives log rotation, and it raises a hand.
// observability.CaptureError is a no-op when SENTRY_DSN is unset, so local
// development and the test suite are unchanged.
func serverError(c echo.Context, err error, msg string) error {
	c.Logger().Errorf("%s %s — %s: %v", c.Request().Method, c.Path(), msg, err)
	observability.CaptureError(err, c.Request(), c.Request().Method, c.Path(), msg, ownerIDForReport(c))
	return c.JSON(http.StatusInternalServerError, errorResponse(msg))
}

// ownerIDForReport reads the authenticated owner id off the context when there
// is one, purely to tag the report.
//
// Public routes have no owner, so this uses a checked assertion where
// middleware.GetOwnerID uses a bare one — a panic inside error reporting would
// turn a handled 500 into an unhandled crash, which is a poor trade for a tag.
// The zero return means "do not tag", not "owner 0".
func ownerIDForReport(c echo.Context) int64 {
	if id, ok := c.Get(string(appMiddleware.OwnerIDKey)).(int64); ok {
		return id
	}
	return 0
}
