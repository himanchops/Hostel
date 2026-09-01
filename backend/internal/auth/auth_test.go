package auth

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func testService() *Service { return NewService("test-secret", time.Hour) }

// bcrypt's limit is the reason a long passphrase became a 500 in production.
// HashPassword now classifies it so a call site that forgets to validate still
// produces something a handler can turn into a 400.
func TestHashPasswordRejectsOverLongInput(t *testing.T) {
	s := testService()

	_, err := s.HashPassword(strings.Repeat("a", MaxPasswordBytes+1))
	if !errors.Is(err, ErrPasswordTooLong) {
		t.Fatalf("expected ErrPasswordTooLong, got %v", err)
	}
}

// The boundary itself must still work — off-by-one here would lock people out
// of a password they had already chosen.
func TestHashPasswordAcceptsExactlyTheLimit(t *testing.T) {
	s := testService()

	hash, err := s.HashPassword(strings.Repeat("a", MaxPasswordBytes))
	if err != nil {
		t.Fatalf("expected 72 bytes to hash, got %v", err)
	}
	if !s.CheckPassword(strings.Repeat("a", MaxPasswordBytes), hash) {
		t.Error("a password at exactly the limit did not verify against its own hash")
	}
}

// The trap in the limit: it is bytes, not characters. Devanagari runs three
// bytes each, so 25 visible characters is already 75 bytes. Anything that
// counted runes would let the original 500 straight back in.
func TestHashPasswordLimitIsBytesNotCharacters(t *testing.T) {
	s := testService()

	password := strings.Repeat("क", 25) // 25 characters, 75 bytes
	if len([]rune(password)) > MaxPasswordBytes {
		t.Fatalf("fixture is wrong: %d runes should be under the limit", len([]rune(password)))
	}
	if len(password) <= MaxPasswordBytes {
		t.Fatalf("fixture is wrong: %d bytes should exceed the limit", len(password))
	}

	if _, err := s.HashPassword(password); !errors.Is(err, ErrPasswordTooLong) {
		t.Fatalf("expected ErrPasswordTooLong for a 75-byte password, got %v", err)
	}
}

func TestHashPasswordRoundTrips(t *testing.T) {
	s := testService()

	hash, err := s.HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	if !s.CheckPassword("correct horse battery staple", hash) {
		t.Error("the right password did not verify")
	}
	if s.CheckPassword("wrong password", hash) {
		t.Error("the wrong password verified")
	}
}
