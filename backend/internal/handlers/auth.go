package handlers

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/labstack/echo/v4"
	"github.com/winnow/hostel/internal/auth"
	appMiddleware "github.com/winnow/hostel/internal/middleware"
	"github.com/winnow/hostel/internal/models"
)

type AuthHandler struct {
	db          *sqlx.DB
	authService *auth.Service
}

func NewAuthHandler(db *sqlx.DB, authService *auth.Service) *AuthHandler {
	return &AuthHandler{db: db, authService: authService}
}

type signupRequest struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Password string `json:"password"`
	Phone    string `json:"phone"`
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type authResponse struct {
	Token string       `json:"token"`
	Owner models.Owner `json:"owner"`
}

// validatePassword returns the message to show the user, or "" if the password
// is acceptable.
//
// Shared by owner signup and public tenant registration because they had
// drifted: both enforced a minimum and neither enforced a maximum, so bcrypt's
// 72-byte ceiling surfaced as a 500 on two different paths. The minimum differs
// between them (8 and 6) and is therefore a parameter; the maximum is bcrypt's
// and is not negotiable.
//
// len() is deliberate: bcrypt counts bytes, so a passphrase of accented or
// Devanagari characters hits the ceiling at far fewer than 72 visible
// characters. Measuring runes here would let exactly the 500 this fixes back in.
func validatePassword(password string, minLength int) string {
	if len(password) < minLength {
		return fmt.Sprintf("password must be at least %d characters", minLength)
	}
	if len(password) > auth.MaxPasswordBytes {
		return fmt.Sprintf("password must be %d characters or fewer", auth.MaxPasswordBytes)
	}
	return ""
}

func (h *AuthHandler) Signup(c echo.Context) error {
	var req signupRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid request body"))
	}

	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.Name = strings.TrimSpace(req.Name)

	if req.Email == "" || req.Password == "" || req.Name == "" {
		return c.JSON(http.StatusBadRequest, errorResponse("name, email, and password are required"))
	}
	if msg := validatePassword(req.Password, 8); msg != "" {
		return c.JSON(http.StatusBadRequest, errorResponse(msg))
	}

	// Check duplicate email
	var count int
	err := h.db.Get(&count, "SELECT COUNT(*) FROM owners WHERE email = $1", req.Email)
	if err != nil {
		return serverError(c, err, "database error")
	}
	if count > 0 {
		return c.JSON(http.StatusConflict, errorResponse("email already registered"))
	}

	hash, err := h.authService.HashPassword(req.Password)
	if err != nil {
		return serverError(c, err, "failed to process password")
	}

	var owner models.Owner
	err = h.db.QueryRowx(
		`INSERT INTO owners (email, password_hash, name, phone, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $5)
		 RETURNING id, email, name, phone, created_at, updated_at`,
		req.Email, hash, req.Name, req.Phone, time.Now(),
	).StructScan(&owner)
	if err != nil {
		return serverError(c, err, "failed to create account")
	}

	token, err := h.authService.GenerateToken(owner.ID)
	if err != nil {
		return serverError(c, err, "failed to generate token")
	}

	return c.JSON(http.StatusCreated, authResponse{Token: token, Owner: owner})
}

func (h *AuthHandler) Login(c echo.Context) error {
	var req loginRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid request body"))
	}

	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if req.Email == "" || req.Password == "" {
		return c.JSON(http.StatusBadRequest, errorResponse("email and password are required"))
	}

	var owner models.Owner
	err := h.db.QueryRowx(
		`SELECT id, email, password_hash, name, phone, created_at, updated_at FROM owners WHERE email = $1`,
		req.Email,
	).StructScan(&owner)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, errorResponse("invalid email or password"))
	}

	if !h.authService.CheckPassword(req.Password, owner.PasswordHash) {
		return c.JSON(http.StatusUnauthorized, errorResponse("invalid email or password"))
	}

	token, err := h.authService.GenerateToken(owner.ID)
	if err != nil {
		return serverError(c, err, "failed to generate token")
	}

	return c.JSON(http.StatusOK, authResponse{Token: token, Owner: owner})
}

func (h *AuthHandler) Me(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)

	var owner models.Owner
	err := h.db.QueryRowx(
		`SELECT id, email, name, phone, created_at, updated_at FROM owners WHERE id = $1`,
		ownerID,
	).StructScan(&owner)
	if err != nil {
		return c.JSON(http.StatusNotFound, errorResponse("owner not found"))
	}

	return c.JSON(http.StatusOK, owner)
}
