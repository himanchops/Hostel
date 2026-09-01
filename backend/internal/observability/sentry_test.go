package observability

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	sentry "github.com/getsentry/sentry-go"
)

// A realistic registration payload. Every value below is one a real tenant
// would type into the public QR form.
const registrationBody = `{"name":"Priya Sharma","phone":"9876543210",` +
	`"email":"priya.sharma@example.com","aadhaar_number":"1234 5678 9012",` +
	`"password":"hunter2","id_proof_front_url":"https://pub-x.r2.dev/public/ab12.jpg"}`

func TestScrubEventStripsRequestBodyAndCookies(t *testing.T) {
	event := &sentry.Event{Request: &sentry.Request{
		Data:    registrationBody,
		Cookies: "session=abc123",
	}}

	got := ScrubEvent(event, nil)

	if got.Request.Data != "" {
		t.Errorf("request body survived scrubbing: %q", got.Request.Data)
	}
	if got.Request.Cookies != "" {
		t.Errorf("cookies survived scrubbing: %q", got.Request.Cookies)
	}
}

func TestScrubEventDropsNonAllowListedHeaders(t *testing.T) {
	event := &sentry.Event{Request: &sentry.Request{Headers: map[string]string{
		"Authorization":   "Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature",
		"Cookie":          "session=abc123",
		"X-Api-Key":       "sk_live_secret",
		"X-Forwarded-For": "203.0.113.9",
		"Content-Type":    "application/json",
		"User-Agent":      "Mozilla/5.0",
	}}}

	got := ScrubEvent(event, nil)

	for _, banned := range []string{"Authorization", "Cookie", "X-Api-Key", "X-Forwarded-For"} {
		if v, ok := got.Request.Headers[banned]; ok {
			t.Errorf("header %s survived scrubbing with value %q", banned, v)
		}
	}
	// The allow-list is not merely "drop everything" — useful headers stay.
	if got.Request.Headers["Content-Type"] != "application/json" {
		t.Errorf("allow-listed Content-Type was dropped: %v", got.Request.Headers)
	}
	if got.Request.Headers["User-Agent"] != "Mozilla/5.0" {
		t.Errorf("allow-listed User-Agent was dropped: %v", got.Request.Headers)
	}
}

// The case DataCollection cannot reach: values interpolated into an error
// string, which is how a phone number or an Aadhaar number would realistically
// escape — not via a structured field.
func TestScrubEventRedactsPIIInFreeText(t *testing.T) {
	cases := []struct {
		name    string
		in      string
		absent  []string
		present []string
	}{
		{
			name:   "aadhaar grouped as the form displays it",
			in:     `pq: duplicate key value violates unique constraint; aadhaar 1234 5678 9012`,
			absent: []string{"1234 5678 9012", "1234", "9012"},
			// The diagnostic half of the message must survive.
			present: []string{"duplicate key value violates unique constraint"},
		},
		{
			name:   "unspaced aadhaar",
			in:     `failed to insert tenant with aadhaar 123456789012`,
			absent: []string{"123456789012"},
		},
		{
			name:   "indian mobile with and without country code",
			in:     `tenant 9876543210 and +91 9123456780 both failed`,
			absent: []string{"9876543210", "9123456780"},
		},
		{
			name:    "email address",
			in:      `owner priya.sharma@example.com not found`,
			absent:  []string{"priya.sharma@example.com", "example.com"},
			present: []string{"not found"},
		},
		{
			name:    "small integers survive so error text stays readable",
			in:      `stay 42 has 3 payments totalling 250000 paise`,
			present: []string{"42", "3", "250000"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			event := &sentry.Event{
				Message:   tc.in,
				Exception: []sentry.Exception{{Value: tc.in}},
			}
			got := ScrubEvent(event, nil)

			for _, field := range []string{got.Message, got.Exception[0].Value} {
				for _, s := range tc.absent {
					if strings.Contains(field, s) {
						t.Errorf("PII %q survived in %q", s, field)
					}
				}
				for _, s := range tc.present {
					if !strings.Contains(field, s) {
						t.Errorf("diagnostic text %q was lost from %q", s, field)
					}
				}
			}
		})
	}
}

// End-to-end through the SDK's own request builder, so this fails if a future
// SDK version changes what newRequest collects — the thing most likely to
// regress silently, since it is upstream behaviour rather than ours.
func TestScrubEventOnSDKBuiltRequest(t *testing.T) {
	if err := sentry.Init(sentry.ClientOptions{
		Dsn:            "",
		SendDefaultPII: false,
		DataCollection: dataCollection(),
	}); err != nil {
		t.Fatalf("init: %v", err)
	}

	req := httptest.NewRequest("POST", "/public/register/7?end_date=2026-09-01", strings.NewReader(registrationBody))
	req.Header.Set("Authorization", "Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature")
	req.Header.Set("Cookie", "session=abc123")
	req.Header.Set("X-Forwarded-For", "203.0.113.9")
	req.Header.Set("Content-Type", "application/json")

	event := &sentry.Event{Request: sentry.NewRequest(req)}
	got := ScrubEvent(event, nil)

	serialized := marshal(t, got)
	for _, banned := range []string{
		"eyJhbGciOiJIUzI1NiJ9", "abc123", "203.0.113.9",
		"Priya Sharma", "9876543210", "1234 5678 9012", "hunter2",
		"priya.sharma@example.com",
	} {
		if strings.Contains(serialized, banned) {
			t.Errorf("%q reached the serialized payload:\n%s", banned, serialized)
		}
	}
}

func marshal(t *testing.T, event *sentry.Event) string {
	t.Helper()
	b, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("marshal event: %v", err)
	}
	return string(b)
}
