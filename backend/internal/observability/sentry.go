// Package observability wires the backend into an error tracker.
//
// It deliberately exposes a tiny surface — Init, Flush, CaptureError — so that
// the rest of the codebase never imports the Sentry SDK directly. The tracker
// is reachable from exactly two call sites (handlers.serverError and the
// panic recovery hook in cmd/server), which is the whole reason step 1 of the
// observability plan (one serverError chokepoint) was done first.
//
// The DSN is protocol-level, not vendor-level: GlitchTip speaks the same
// ingest API, so switching is an env var change rather than a code change.
// See docs/DEPLOYMENT.md → "Where the logs go".
package observability

import (
	"log"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"time"

	sentry "github.com/getsentry/sentry-go"
)

// enabled records whether Init actually configured a client. Every exported
// function is a no-op when it is false, so local development and tests need no
// DSN and no network.
var enabled bool

// requestHeaderAllowList is the complete set of request headers permitted into
// an event payload.
//
// This is an allow-list rather than a deny-list on purpose. The SDK's built-in
// deny-list matches substrings like "auth" and "token", which does catch
// Authorization — but it only catches headers somebody thought of. An
// allow-list inverts the failure mode: a header we never anticipated is
// dropped rather than sent. The cost is that adding a useful header here is a
// deliberate act, which is the point.
var requestHeaderAllowList = []string{
	"Content-Type",
	"User-Agent",
	"Referer",
	"X-Request-Id",
	"Host",
}

// Patterns for values that can end up inside an *error string*, where no
// amount of header or body configuration can reach them. A Postgres error, a
// wrapped validation message, or a fmt.Errorf that interpolates a field will
// all arrive as free text in event.Message or the exception value.
//
// Ordering matters: Aadhaar (12 digits) is scrubbed before the 10-digit phone
// pattern. Both are \b-anchored so a phone pattern cannot bite a chunk out of
// a longer digit run, but the ordering makes that independent of regexp
// subtleties rather than dependent on them.
var (
	// 12 digits, optionally grouped 4-4-4 the way the form displays them.
	aadhaarPattern = regexp.MustCompile(`\b\d{4}[ -]?\d{4}[ -]?\d{4}\b`)
	// Indian mobile numbers: 10 digits starting 6-9, with an optional +91.
	phonePattern = regexp.MustCompile(`(?:\+?91[ -]?)?\b[6-9]\d{9}\b`)
	emailPattern = regexp.MustCompile(`\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b`)
)

const redacted = "[redacted]"

// dataCollection is the production data-collection policy, in a function so
// that the unit tests exercise the same object the server runs with rather
// than a hand-copied approximation that can drift away from it.
func dataCollection() *sentry.DataCollection {
	return &sentry.DataCollection{
		// The single most important line here. Request bodies are the only
		// place a full registration payload — name, phone, email, Aadhaar
		// number, ID proof URLs — exists as one object. Never collect them.
		HTTPBodies: []sentry.BodyType{},
		Cookies:    &sentry.KeyValueCollectionBehavior{Mode: sentry.CollectionOff},
		HTTPHeaders: &sentry.HeaderCollectionConfig{
			Request: &sentry.KeyValueCollectionBehavior{
				Mode:  sentry.CollectionAllowList,
				Terms: requestHeaderAllowList,
			},
			Response: &sentry.KeyValueCollectionBehavior{Mode: sentry.CollectionOff},
		},
		// Only end_date and pending are ever read from the query string, and
		// the built-in deny-list still covers anything added later that looks
		// like a secret.
		QueryParams: &sentry.KeyValueCollectionBehavior{Mode: sentry.CollectionDenyList},
		// Client IP and user identity are never populated automatically. The
		// owner id CaptureError attaches is deliberate, and is an integer
		// rather than a person.
		UserInfo: sentry.Set(false),
	}
}

// Init configures the error tracker from the environment and reports, on one
// line, whether it is live.
//
// That log line exists because the failure mode this whole change is meant to
// close is "looks healthy, reports nothing". A DSN that is unset, malformed,
// or pointing at a dead host must not be indistinguishable from a quiet week.
func Init() {
	dsn := os.Getenv("SENTRY_DSN")
	if dsn == "" {
		log.Print("error tracking: DISABLED (SENTRY_DSN unset) — 500s will only reach stdout")
		return
	}

	err := sentry.Init(sentry.ClientOptions{
		Dsn:         dsn,
		Environment: envOr("SENTRY_ENVIRONMENT", "development"),
		// Render exposes the deployed commit as RENDER_GIT_COMMIT. Tagging the
		// release is what makes "this started after Tuesday's deploy" answerable.
		Release: os.Getenv("RENDER_GIT_COMMIT"),
		// Errors only. Tracing would sample every request and is a different
		// (and much larger) quota conversation.
		EnableTracing: false,
		// Turn on with SENTRY_DEBUG=1 to make transport failures visible on
		// stdout instead of swallowed.
		Debug: os.Getenv("SENTRY_DEBUG") == "1",

		// SendDefaultPII stays false, but the DataCollection block below is set
		// explicitly rather than left to the SDK's defaults. As of v0.49 the
		// nil-DataCollection path is documented as a *backwards-compatibility*
		// shim for SendDefaultPII, and inheriting privacy behaviour from a
		// compatibility shim is not a thing to build on.
		SendDefaultPII: false,
		DataCollection: dataCollection(),

		// Second, independent layer. DataCollection governs structured fields;
		// BeforeSend is the only thing that can reach free text.
		BeforeSend: ScrubEvent,
	})
	if err != nil {
		// A bad DSN must be loud. It is not fatal — the app serves traffic
		// perfectly well without a tracker — but it must not look like success.
		log.Printf("error tracking: FAILED to initialise (%v) — 500s will only reach stdout", err)
		return
	}

	enabled = true
	log.Printf("error tracking: enabled (environment=%s release=%q)",
		envOr("SENTRY_ENVIRONMENT", "development"), os.Getenv("RENDER_GIT_COMMIT"))
}

// Flush drains the queue on shutdown. Events are sent on a background
// goroutine, so without this a crash-then-exit loses the very event that
// explains the exit.
func Flush() {
	if !enabled {
		return
	}
	sentry.Flush(2 * time.Second)
}

// CaptureError sends one error, tagged with the route that produced it.
//
// Grouping is set explicitly via Fingerprint. Left to itself the SDK would
// group on the stack trace, and because every error funnels through this one
// helper the top frames are identical for all of them — exactly the shape that
// collapses unrelated failures into one issue. Method + route + message is
// stable across deploys and splits the way a human would.
func CaptureError(err error, req *http.Request, method, route, msg string, ownerID int64) {
	if !enabled || err == nil {
		return
	}

	hub := sentry.CurrentHub().Clone()
	scope := hub.Scope()
	if req != nil {
		scope.SetRequest(req)
	}
	scope.SetTag("route", route)
	scope.SetTag("method", method)
	scope.SetLevel(sentry.LevelError)
	scope.SetContext("handler", sentry.Context{"message": msg})
	if ownerID > 0 {
		// An opaque integer, not a person: enough to tell "one owner hitting
		// this repeatedly" from "everybody is", without a name or an email.
		scope.SetTag("owner_id", strconv.FormatInt(ownerID, 10))
	}
	scope.SetFingerprint([]string{method, route, msg})

	hub.CaptureException(err)
}

// ScrubEvent is the BeforeSend hook. Exported so it can be unit-tested against
// a realistic event rather than trusted.
func ScrubEvent(event *sentry.Event, _ *sentry.EventHint) *sentry.Event {
	if event == nil {
		return nil
	}

	if event.Request != nil {
		// Belt and braces: DataCollection is configured never to populate this,
		// so if it is ever non-empty something upstream changed and the change
		// should fail closed.
		event.Request.Data = ""
		event.Request.Cookies = ""
		event.Request.Headers = filterHeaders(event.Request.Headers)
		event.Request.URL = scrubText(event.Request.URL)
		event.Request.QueryString = scrubText(event.Request.QueryString)
	}

	event.Message = scrubText(event.Message)
	for i := range event.Exception {
		event.Exception[i].Value = scrubText(event.Exception[i].Value)
	}
	for i := range event.Breadcrumbs {
		if event.Breadcrumbs[i] != nil {
			event.Breadcrumbs[i].Message = scrubText(event.Breadcrumbs[i].Message)
		}
	}

	return event
}

// filterHeaders keeps only the allow-listed headers, dropping the rest
// entirely rather than replacing their values — a key alone can be a hint
// ("X-Internal-Admin-Token was present") and there is no reason to keep it.
func filterHeaders(headers map[string]string) map[string]string {
	if headers == nil {
		return nil
	}
	kept := make(map[string]string, len(headers))
	for name, value := range headers {
		for _, allowed := range requestHeaderAllowList {
			if http.CanonicalHeaderKey(name) == http.CanonicalHeaderKey(allowed) {
				kept[name] = scrubText(value)
				break
			}
		}
	}
	return kept
}

// scrubText replaces personally identifying values inside free text.
//
// It is deliberately blunt. A 12-digit run in a Go error string is far more
// likely to be an Aadhaar number than anything worth reading, and losing the
// occasional large integer from an error message costs less than sending one
// national identity number to a third party.
func scrubText(s string) string {
	if s == "" {
		return s
	}
	s = aadhaarPattern.ReplaceAllString(s, redacted)
	s = phonePattern.ReplaceAllString(s, redacted)
	s = emailPattern.ReplaceAllString(s, redacted)
	return s
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// CapturePanic reports a recovered panic.
//
// Unlike CaptureError this sets no fingerprint. A panic's stack trace is the
// real identity of the bug — two panics on the same route are usually two
// different bugs — so the SDK's stack-based grouping is the right one here,
// where for handled errors it was the wrong one.
func CapturePanic(err error, req *http.Request, method, route string) {
	if !enabled || err == nil {
		return
	}
	hub := sentry.CurrentHub().Clone()
	scope := hub.Scope()
	if req != nil {
		scope.SetRequest(req)
	}
	scope.SetTag("route", route)
	scope.SetTag("method", method)
	scope.SetLevel(sentry.LevelFatal)
	scope.SetContext("handler", sentry.Context{"message": "unrecovered panic"})
	hub.CaptureException(err)
}

// Fatalf reports a startup or shutdown failure, waits for it to be delivered,
// then exits.
//
// This exists because log.Fatalf and echo.Logger.Fatal both call os.Exit,
// which skips every deferred Flush — so the process would die with the report
// still sitting in the send queue. The failures that kill the process at boot
// (no database, no storage backend) are precisely the ones worth an email.
func Fatalf(err error, msg string) {
	log.Printf("%s: %v", msg, err)
	if enabled {
		hub := sentry.CurrentHub().Clone()
		hub.Scope().SetLevel(sentry.LevelFatal)
		hub.Scope().SetContext("startup", sentry.Context{"message": msg})
		hub.Scope().SetFingerprint([]string{"startup", msg})
		hub.CaptureException(err)
		sentry.Flush(5 * time.Second)
	}
	os.Exit(1)
}
