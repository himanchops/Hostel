package middleware

import (
	"net/http"
	"sync"
	"time"

	"github.com/labstack/echo/v4"
	echomw "github.com/labstack/echo/v4/middleware"
	"golang.org/x/time/rate"
)

// Failed sign-in budget, per client IP.
//
// Only failures count. A hostel is dozens of people behind one Wi-Fi address,
// and every one of them signing in correctly on the first morning must never
// trip this — so a successful login costs nothing and a 401 costs one token.
// Ten wrong passwords in a row is far past any honest typo streak; after that,
// one more guess a minute (~1,400 a day) is useless against anything but a
// trivial password and costs a real person at most a minute's wait.
//
// What it does not do: slow down an attacker spread across many addresses, or
// protect one account from many IPs. That wants a second budget keyed on the
// phone/email, which needs the handler's parsed body and is noted in
// docs/BACKLOG.md rather than half-built here.
const (
	loginFailureRefill = 1 * time.Minute
	loginFailureBurst  = 10
	loginFailureExpiry = 1 * time.Hour
)

// Registration budget, per client IP per hostel.
//
// POST /public/register writes a row into an owner's pending queue, so the
// thing worth protecting is one owner's queue from one source. Keying on the
// owner as well as the IP means move-in day — twenty students on the hostel
// Wi-Fi registering within the hour — fits inside the burst, while someone
// scripting junk into a queue gets one registration every three minutes.
const (
	registerRefill = 3 * time.Minute
	registerBurst  = 20
	registerExpiry = 2 * time.Hour
)

// FailedLoginLimiter returns route middleware that refuses a client IP once it
// has run out of failed attempts, and charges one attempt for every response
// the login handler answers with 401.
//
// Each call returns an independent budget, so owner and tenant logins do not
// share one: a tenant fumbling the portal cannot lock the owner out of the
// dashboard from the same Wi-Fi.
func FailedLoginLimiter() echo.MiddlewareFunc {
	return newFailureLimiter(rate.Every(loginFailureRefill), loginFailureBurst, loginFailureExpiry).middleware
}

// PublicRegisterRateLimiter caps self-registrations per client IP per owner.
func PublicRegisterRateLimiter() echo.MiddlewareFunc {
	store := echomw.NewRateLimiterMemoryStoreWithConfig(
		echomw.RateLimiterMemoryStoreConfig{
			Rate:      rate.Every(registerRefill),
			Burst:     registerBurst,
			ExpiresIn: registerExpiry,
		},
	)
	return echomw.RateLimiterWithConfig(echomw.RateLimiterConfig{
		Store: store,
		IdentifierExtractor: func(c echo.Context) (string, error) {
			return c.RealIP() + "|" + c.Param("ownerId"), nil
		},
		DenyHandler: func(c echo.Context, _ string, _ error) error {
			return c.JSON(http.StatusTooManyRequests, map[string]string{
				"error": "Too many registrations from this network. Wait a few minutes and try again.",
			})
		},
	})
}

type failureLimiter struct {
	mu        sync.Mutex
	visitors  map[string]*failureVisitor
	limit     rate.Limit
	burst     int
	expiry    time.Duration
	lastSweep time.Time
	now       func() time.Time // swapped in tests
}

type failureVisitor struct {
	lim      *rate.Limiter
	lastSeen time.Time
}

func newFailureLimiter(limit rate.Limit, burst int, expiry time.Duration) *failureLimiter {
	return &failureLimiter{
		visitors: map[string]*failureVisitor{},
		limit:    limit,
		burst:    burst,
		expiry:   expiry,
		now:      time.Now,
	}
}

func (f *failureLimiter) visitor(ip string) *failureVisitor {
	f.mu.Lock()
	defer f.mu.Unlock()

	now := f.now()
	// Forget idle addresses now and then, so the map is bounded by recent
	// traffic rather than by every address that has ever tried.
	if now.Sub(f.lastSweep) > f.expiry {
		for k, v := range f.visitors {
			if now.Sub(v.lastSeen) > f.expiry {
				delete(f.visitors, k)
			}
		}
		f.lastSweep = now
	}

	v, ok := f.visitors[ip]
	if !ok {
		v = &failureVisitor{lim: rate.NewLimiter(f.limit, f.burst)}
		f.visitors[ip] = v
	}
	v.lastSeen = now
	return v
}

func (f *failureLimiter) middleware(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		v := f.visitor(c.RealIP())
		if v.lim.TokensAt(f.now()) < 1 {
			// Same {"error": ...} envelope as every other API error — the
			// login pages print body.error, and Echo's default {"message"}
			// would surface as a generic failure.
			return c.JSON(http.StatusTooManyRequests, map[string]string{
				"error": "Too many failed sign-in attempts from this network. Wait a few minutes and try again.",
			})
		}
		err := next(c)
		if c.Response().Status == http.StatusUnauthorized {
			v.lim.AllowN(f.now(), 1)
		}
		return err
	}
}
