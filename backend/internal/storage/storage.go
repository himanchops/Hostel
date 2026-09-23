package storage

import (
	"context"
	"io"
	"regexp"
	"time"
)

// Service is the interface for file storage backends.
//
// Uploads are private. Nothing an upload returns is a link anyone can open:
// the database stores the object key, and every read mints a link that works
// for a short while, after the handler has checked who is asking. Tenant ID
// scans used to sit at permanent public URLs, where a link leaked through a
// forwarded screenshot, a browser history or a log line was a copy of
// someone's Aadhaar card for ever.
type Service interface {
	// Upload stores the reader under key.
	Upload(ctx context.Context, key, contentType string, r io.Reader) error
	// SignedURL returns a link to key that stops working after ttl.
	SignedURL(ctx context.Context, key string, ttl time.Duration) (string, error)
}

// keyPattern is the only shape of key the upload handler ever creates:
// `<prefix>/<32 hex chars from crypto/rand>.<ext>`. Anything a client sends
// back as a file reference must match it exactly, which is what makes a
// stored value impossible to aim at another host.
var keyPattern = regexp.MustCompile(`^(public|tenant)/[0-9a-f]{32}\.(jpg|png|webp|pdf)$`)

// legacyKeyPattern finds the key at the end of a URL stored before uploads
// went private, whatever host it was served from.
var legacyKeyPattern = regexp.MustCompile(`/((?:public|tenant)/[0-9a-f]{32}\.(?:jpg|png|webp|pdf))$`)

// ValidKey reports whether s is a key the upload handler could have issued.
func ValidKey(s string) bool {
	return keyPattern.MatchString(s)
}

// KeyFromStored returns the object key behind a stored file reference. It
// accepts a bare key, or a full URL from before uploads went private
// (migration 010 converts those, but a read must not depend on the migration
// having run first). ok is false for anything else — a value that is neither
// is not something to hand a browser.
func KeyFromStored(s string) (key string, ok bool) {
	if ValidKey(s) {
		return s, true
	}
	if m := legacyKeyPattern.FindStringSubmatch(s); m != nil {
		return m[1], true
	}
	return "", false
}
