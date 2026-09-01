package auth

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

var ErrInvalidToken = errors.New("invalid token")

// ErrPasswordTooLong is returned by HashPassword when bcrypt refuses the input.
//
// Re-exported from bcrypt so callers can classify this without importing the
// crypto package, and so the handlers do not have to know which hashing
// algorithm is behind the service.
var ErrPasswordTooLong = errors.New("password is too long to hash")

// MaxPasswordBytes is bcrypt's hard input limit.
//
// It is 72 *bytes*, not characters — a password of 72 emoji is roughly 288
// bytes and is rejected. Validation therefore has to measure len() on the
// string, never utf8.RuneCountInString.
const MaxPasswordBytes = 72

// Claims for owner tokens
type Claims struct {
	OwnerID int64  `json:"owner_id"`
	Role    string `json:"role"` // "owner"
	jwt.RegisteredClaims
}

// TenantClaims for tenant portal tokens
type TenantClaims struct {
	TenantID int64  `json:"tenant_id"`
	Role     string `json:"role"` // "tenant"
	jwt.RegisteredClaims
}

type Service struct {
	secretKey []byte
	tokenTTL  time.Duration
}

func NewService(secretKey string, tokenTTL time.Duration) *Service {
	return &Service{
		secretKey: []byte(secretKey),
		tokenTTL:  tokenTTL,
	}
}

func (s *Service) HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if errors.Is(err, bcrypt.ErrPasswordTooLong) {
		// Mapped rather than passed through so that a call site which forgets
		// to validate gets a classifiable error instead of an opaque 500. That
		// is exactly how this reached production: Signup checked a minimum
		// length and no maximum, so a long passphrase from a password manager
		// became "failed to process password" with no way for the user to
		// guess what was wrong.
		return "", ErrPasswordTooLong
	}
	return string(bytes), err
}

func (s *Service) CheckPassword(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func (s *Service) GenerateToken(ownerID int64) (string, error) {
	claims := Claims{
		OwnerID: ownerID,
		Role:    "owner",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(s.tokenTTL)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(s.secretKey)
}

func (s *Service) ValidateToken(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		return s.secretKey, nil
	})
	if err != nil {
		return nil, ErrInvalidToken
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid || claims.Role != "owner" {
		return nil, ErrInvalidToken
	}
	return claims, nil
}

func (s *Service) GenerateTenantToken(tenantID int64) (string, error) {
	claims := TenantClaims{
		TenantID: tenantID,
		Role:     "tenant",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(s.tokenTTL)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(s.secretKey)
}

func (s *Service) ValidateTenantToken(tokenString string) (*TenantClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &TenantClaims{}, func(token *jwt.Token) (interface{}, error) {
		return s.secretKey, nil
	})
	if err != nil {
		return nil, ErrInvalidToken
	}
	claims, ok := token.Claims.(*TenantClaims)
	if !ok || !token.Valid || claims.Role != "tenant" {
		return nil, ErrInvalidToken
	}
	return claims, nil
}
