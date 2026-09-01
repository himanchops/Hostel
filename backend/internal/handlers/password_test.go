package handlers

import (
	"strings"
	"testing"

	"github.com/winnow/hostel/internal/auth"
)

// Owner signup (minimum 8) and public tenant registration (minimum 6) share
// this validator precisely because they had drifted apart: both enforced their
// own minimum and neither enforced bcrypt's maximum, so the same 500 existed on
// two paths and was only noticed on one.
func TestValidatePassword(t *testing.T) {
	long := strings.Repeat("a", auth.MaxPasswordBytes+1)
	// 25 Devanagari characters is 75 bytes — under the limit by any rune count,
	// over it by the only measure bcrypt cares about.
	multibyte := strings.Repeat("क", 25)

	cases := []struct {
		name    string
		pw      string
		min     int
		wantMsg string
	}{
		{"a normal signup password", "hunter2hunter2", 8, ""},
		{"exactly the minimum", "12345678", 8, ""},
		{"exactly bcrypt's maximum", strings.Repeat("a", auth.MaxPasswordBytes), 8, ""},

		{"too short for signup", "short", 8, "password must be at least 8 characters"},
		{"the tenant path has a lower minimum", "abc12", 6, "password must be at least 6 characters"},
		{"five characters is fine for signup? no", "abc12", 8, "password must be at least 8 characters"},

		{"one byte over the maximum", long, 8, "password must be 72 characters or fewer"},
		{"the maximum applies on the public path too", long, 6, "password must be 72 characters or fewer"},
		{"multibyte counts as bytes, not characters", multibyte, 8, "password must be 72 characters or fewer"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := validatePassword(tc.pw, tc.min); got != tc.wantMsg {
				t.Errorf("validatePassword(len=%d bytes, min=%d) = %q, want %q",
					len(tc.pw), tc.min, got, tc.wantMsg)
			}
		})
	}
}

// The regression itself: before this, a password manager's generated passphrase
// reached bcrypt, failed, and came back as a 500 "failed to process password".
// It is a validation failure and must be caught before any work happens.
func TestOverLongPasswordIsRejectedAsValidationNotFailure(t *testing.T) {
	msg := validatePassword(strings.Repeat("x", 100), 8)
	if msg == "" {
		t.Fatal("a 100-byte password was accepted; it would 500 at bcrypt")
	}
	if !strings.Contains(msg, "72") {
		t.Errorf("the message should tell the user the actual limit, got %q", msg)
	}
}
