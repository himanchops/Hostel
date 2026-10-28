package middleware

import (
	"errors"
	"net/http"
	"time"

	"github.com/getsentry/sentry-go"
	"github.com/labstack/echo/v4"
	"github.com/winnow/hostel/internal/observability"
)

// reportSlow is observability.ReportSlow, swappable so the middleware can be
// tested without a Sentry DSN.
var reportSlow = observability.ReportSlow

// Timing records how long each request took and speaks up about slow ones
// (Oct 2026). The owner found the live app slow and nothing anywhere said so:
// a slow request is not an error, so it never reached Sentry, and the Render
// log that does show each request's latency rolls off within hours.
//
// Every request becomes a Sentry transaction named by its route, joined to
// the page that made it when the browser sent a trace. Any request slower
// than `slow` is also logged and sent as a warning, one Sentry issue per
// route. /health is left out: the uptime check calls it every ten minutes
// and its timing says nothing about the app.
func Timing(slow time.Duration) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			route := c.Path()
			if route == "/health" {
				return next(c)
			}
			req := c.Request()
			method := req.Method
			start := time.Now()

			span := observability.StartRequest(req, method, route)
			if span != nil {
				c.SetRequest(req.WithContext(span.Context()))
			}

			err := next(c)
			took := time.Since(start)

			status := c.Response().Status
			if err != nil {
				// The error handler writes the response after this returns,
				// so the status is the error's, not the default 200.
				status = http.StatusInternalServerError
				var he *echo.HTTPError
				if errors.As(err, &he) {
					status = he.Code
				}
			}

			if span != nil {
				span.Status = sentry.HTTPtoSpanStatus(status)
				span.SetData("http.response.status_code", status)
				span.Finish()
			}

			if took > slow {
				c.Logger().Warnf("SLOW %s %s took %dms (status %d)", method, route, took.Milliseconds(), status)
				var ownerID int64
				if id, ok := c.Get(string(OwnerIDKey)).(int64); ok {
					ownerID = id
				}
				reportSlow(req, method, route, took, status, ownerID)
			}
			return err
		}
	}
}
