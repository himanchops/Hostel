package handlers

import (
	"context"
	"io"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/winnow/hostel/internal/models"
)

// fakeStorage signs by prefixing, so a test can see exactly which key was
// signed and with what lifetime.
type fakeStorage struct{ ttl time.Duration }

func (f *fakeStorage) Upload(context.Context, string, string, io.Reader) error { return nil }
func (f *fakeStorage) Delete(context.Context, string) error                    { return nil }
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

func TestReplacedFiles(t *testing.T) {
	str := func(s string) *string { return &s }
	const (
		photo    = "tenant/00000000000000000000000000000001.jpg"
		newPhoto = "tenant/00000000000000000000000000000002.jpg"
		front    = "public/00000000000000000000000000000003.jpg"
		back     = "public/00000000000000000000000000000004.jpg"
	)
	before := &models.Tenant{PhotoURL: str(photo), IDProofFrontURL: str(front), IDProofBackURL: str(back)}
	after := &models.Tenant{
		PhotoURL:        str(newPhoto), // replaced
		IDProofFrontURL: str(front),    // kept
		IDProofBackURL:  str(""),       // cleared
		IDProofURL:      str(""),       // was never set
	}

	got := replacedFiles(before, after)
	want := []string{photo, back}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Errorf("replacedFiles = %v, want %v", got, want)
	}

	if got := replacedFiles(before, before); len(got) != 0 {
		t.Errorf("an edit that changes no file removes none, got %v", got)
	}
}
