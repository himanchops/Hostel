package middleware

import (
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
	echomw "github.com/labstack/echo/v4/middleware"
	"golang.org/x/time/rate"
)

// Public upload budget, per client IP.
//
// POST /public/upload takes no authentication — it has to, because a stranger
// scanning the QR code uploads their ID before any account exists. Combined
// with a publicly-readable R2 bucket that makes the endpoint an open file host
// on the owner's Cloudflare account, so it needs a ceiling.
//
// The numbers come from the legitimate worst case: one registration submits at
// most three files (ID front, ID back, photo), and a whole hostel can sit
// behind a single NAT'd Wi-Fi IP. A burst of 10 lets three people register
// back-to-back without waiting; refilling one every three minutes allows ~480
// uploads per IP per day, comfortably above any real day and far below what
// makes bulk hosting attractive.
//
// Being honest about what this does and does not do: it raises the cost of
// abuse, it does not remove it. A determined uploader with a handful of IPs can
// still fill the free tier. The actual fix is authenticating the upload against
// a short-lived token issued by the registration link, so an upload has to
// belong to a registration in progress — see docs/BACKLOG.md.
const (
	publicUploadRefill = 3 * time.Minute // one upload token every three minutes
	publicUploadBurst  = 10              // instantly available uploads per IP
	publicUploadExpiry = 1 * time.Hour   // forget an idle IP after this long
)

// PublicUploadRateLimiter caps unauthenticated uploads per client IP.
//
// Apply it as route middleware on the public upload endpoint only. The other
// public routes have their own cost profiles and are not covered here.
//
// The deny response deliberately uses the API's {"error": ...} envelope rather
// than Echo's default {"message": ...}, because the frontend reads body.error
// and would otherwise replace a perfectly clear "too many uploads" with a
// generic "Upload failed".
func PublicUploadRateLimiter() echo.MiddlewareFunc {
	store := echomw.NewRateLimiterMemoryStoreWithConfig(
		echomw.RateLimiterMemoryStoreConfig{
			Rate:      rate.Every(publicUploadRefill),
			Burst:     publicUploadBurst,
			ExpiresIn: publicUploadExpiry,
		},
	)

	return echomw.RateLimiterWithConfig(echomw.RateLimiterConfig{
		Store: store,
		IdentifierExtractor: func(c echo.Context) (string, error) {
			return c.RealIP(), nil
		},
		// No log line here on purpose. middleware.Logger() already records the
		// deny as a request line with status 429 and remote_ip set to the
		// resolved client, which is the whole of what an operator needs. An
		// extra c.Logger().Warnf would have been worse than nothing: Echo's
		// default logger level is ERROR, so it emits nothing while reading as
		// though it does.
		DenyHandler: func(c echo.Context, _ string, _ error) error {
			return c.JSON(http.StatusTooManyRequests, map[string]string{
				"error": "too many uploads from this network — wait a few minutes and try again",
			})
		},
	})
}
