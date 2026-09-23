package handlers

import (
	"context"
	"io"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
)

// fakeStorage signs by prefixing, so a test can see exactly which key was
// signed and with what lifetime.
type fakeStorage struct{ ttl time.Duration }

func (f *fakeStorage) Upload(context.Context, string, string, io.Reader) error { return nil }
func (f *fakeStorage) SignedURL(_ context.Context, key string, ttl time.Duration) (string, error) {
	f.ttl = ttl
	return "https://signed.example/" + key + "?sig", nil
}

func TestSignFiles(t *testing.T) {
	const key = "public/0123456789abcdef0123456789abcdef.jpg"
	e := echo.New()
	c := e.NewContext(httptest.NewRequest("GET", "/", nil), httptest.NewRecorder())
	s := &fakeStorage{}

	bare := key
	legacy := "https://pub-abc.r2.dev/" + key // stored before migration 010
	foreign := "https://evil.example/pixel.jpg"
	empty := ""

	if err := signFiles(c, s, &bare, &legacy, &foreign, &empty, nil); err != nil {
		t.Fatalf("signFiles: %v", err)
	}

	want := "https://signed.example/" + key + "?sig"
	if bare != want {
		t.Errorf("bare key: got %q, want %q", bare, want)
	}
	if legacy != want {
		t.Errorf("legacy URL: got %q, want %q", legacy, want)
	}
	if foreign != "" {
		t.Errorf("foreign URL must never reach a browser, got %q", foreign)
	}
	if empty != "" {
		t.Errorf("empty stays empty, got %q", empty)
	}
	if s.ttl != signedURLTTL {
		t.Errorf("ttl = %v, want %v", s.ttl, signedURLTTL)
	}
}

func TestValidFileRef(t *testing.T) {
	if !validFileRef("") {
		t.Error(`"" means no file and must be accepted`)
	}
	if !validFileRef("tenant/0123456789abcdef0123456789abcdef.png") {
		t.Error("an issued key must be accepted")
	}
	// Before uploads went private, the check looked only at the extension, so
	// any host's .jpg could be stored and later fetched by the owner's browser.
	if validFileRef("https://anywhere.example/x.jpg") {
		t.Error("a URL must be rejected, whatever its extension")
	}
}
