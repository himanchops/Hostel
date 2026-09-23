package storage

import (
	"context"
	"net/url"
	"strings"
	"testing"
	"time"
)

const sampleKey = "public/0123456789abcdef0123456789abcdef.jpg"

func TestValidKey(t *testing.T) {
	good := []string{
		sampleKey,
		"tenant/0123456789abcdef0123456789abcdef.pdf",
		"public/ffffffffffffffffffffffffffffffff.webp",
	}
	for _, k := range good {
		if !ValidKey(k) {
			t.Errorf("ValidKey(%q) = false, want true", k)
		}
	}

	bad := []string{
		"",
		"https://evil.example/public/0123456789abcdef0123456789abcdef.jpg", // a URL, not a key
		"public/0123456789abcdef0123456789abcdef.svg",                      // not an allowed type
		"public/0123456789ABCDEF0123456789ABCDEF.jpg",                      // uppercase hex is never issued
		"public/0123.jpg",           // too short
		"smoke-test/1700000000.png", // storage-check keys are not tenant files
		"public/../0123456789abcdef0123456789abcdef.jpg",
		"public/0123456789abcdef0123456789abcdef.jpg?x=1",
	}
	for _, k := range bad {
		if ValidKey(k) {
			t.Errorf("ValidKey(%q) = true, want false", k)
		}
	}
}

func TestKeyFromStored(t *testing.T) {
	cases := []struct {
		stored string
		want   string
		ok     bool
	}{
		{sampleKey, sampleKey, true},
		// Rows written before migration 010, from each backend.
		{"https://pub-abc123.r2.dev/" + sampleKey, sampleKey, true},
		{"http://localhost:8080/uploads/" + sampleKey, sampleKey, true},
		// Neither a key nor a URL the upload handler ever returned.
		{"https://evil.example/tracking.jpg", "", false},
		{"", "", false},
	}
	for _, c := range cases {
		got, ok := KeyFromStored(c.stored)
		if got != c.want || ok != c.ok {
			t.Errorf("KeyFromStored(%q) = (%q, %v), want (%q, %v)", c.stored, got, ok, c.want, c.ok)
		}
	}
}

// Presigning is offline — it needs no bucket and no network — so the link's
// shape can be checked directly: right host and path, and an expiry that
// matches what was asked for.
func TestS3SignedURL_Expires(t *testing.T) {
	svc, err := NewS3Storage(context.Background(), S3Config{
		Endpoint:  "https://account.r2.cloudflarestorage.com",
		Region:    "auto",
		Bucket:    "hostel-uploads",
		AccessKey: "AKIAEXAMPLE",
		SecretKey: "secret",
	})
	if err != nil {
		t.Fatalf("NewS3Storage: %v", err)
	}

	link, err := svc.SignedURL(context.Background(), sampleKey, time.Hour)
	if err != nil {
		t.Fatalf("SignedURL: %v", err)
	}
	u, err := url.Parse(link)
	if err != nil {
		t.Fatalf("parse %q: %v", link, err)
	}
	if u.Host != "account.r2.cloudflarestorage.com" {
		t.Errorf("host = %q, want the S3 endpoint", u.Host)
	}
	if want := "/hostel-uploads/" + sampleKey; u.Path != want {
		t.Errorf("path = %q, want %q", u.Path, want)
	}
	if got := u.Query().Get("X-Amz-Expires"); got != "3600" {
		t.Errorf("X-Amz-Expires = %q, want 3600", got)
	}
	if !strings.Contains(u.RawQuery, "X-Amz-Signature=") {
		t.Errorf("link carries no signature: %s", link)
	}
}
