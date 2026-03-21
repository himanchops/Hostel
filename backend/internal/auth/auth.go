package auth

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

var ErrInvalidToken = errors.New("invalid token")

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
