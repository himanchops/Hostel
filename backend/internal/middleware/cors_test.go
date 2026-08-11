package middleware

import (
	"reflect"
	"testing"
)

func TestParseOrigins(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want []string
	}{
		{"single", "https://app.example.com", []string{"https://app.example.com"}},
		{"multiple", "https://a.com,https://b.com", []string{"https://a.com", "https://b.com"}},
		{"whitespace", " https://a.com , https://b.com ", []string{"https://a.com", "https://b.com"}},
		{"trailing slash stripped", "https://a.com/", []string{"https://a.com"}},
		{"empty entries dropped", "https://a.com,,", []string{"https://a.com"}},
		{"empty string", "", []string{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ParseOrigins(tt.in)
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("ParseOrigins(%q) = %v, want %v", tt.in, got, tt.want)
			}
		})
	}
}

func TestDevOriginAllowed(t *testing.T) {
	tests := []struct {
		origin string
		want   bool
	}{
		// The regression this guards: these all used to be rejected, which made
		// login fail silently with no server-side error.
		{"http://localhost:3000", true},
		{"http://127.0.0.1:3000", true},
		{"http://192.168.1.42:3000", true}, // phone on the same Wi-Fi
		{"http://10.0.0.5:3000", true},
		{"http://172.16.0.9:3000", true},
		{"https://localhost:3000", true},
		{"http://localhost", true},

		// Public and malformed origins stay out even in dev.
		{"http://example.com", false},
		{"https://evil.example.com", false},
		{"http://8.8.8.8:3000", false},
		{"http://172.32.0.1:3000", false}, // just outside the 172.16/12 private range
		{"file:///etc/passwd", false},
		{"null", false},
		{"", false},
	}
	for _, tt := range tests {
		t.Run(tt.origin, func(t *testing.T) {
			got, err := DevOriginAllowed(tt.origin)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Errorf("DevOriginAllowed(%q) = %v, want %v", tt.origin, got, tt.want)
			}
		})
	}
}
