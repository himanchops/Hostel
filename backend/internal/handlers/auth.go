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

type changePasswordRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

// ownerMinPassword is the owner's floor. Tenant portal passwords use 6; see
// validatePassword for why the two differ and the ceiling does not.
const ownerMinPassword = 8

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
	if msg := validatePassword(req.Password, ownerMinPassword); msg != "" {
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
		 RETURNING id, email, name, phone, token_version, created_at, updated_at`,
		req.Email, hash, req.Name, req.Phone, time.Now(),
	).StructScan(&owner)
	if err != nil {
		return serverError(c, err, "failed to create account")
	}

	token, err := h.authService.GenerateToken(owner.ID, owner.TokenVersion)
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
		`SELECT id, email, password_hash, name, phone, token_version, created_at, updated_at
		 FROM owners WHERE email = $1`,
		req.Email,
	).StructScan(&owner)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, errorResponse("invalid email or password"))
	}

	if !h.authService.CheckPassword(req.Password, owner.PasswordHash) {
		return c.JSON(http.StatusUnauthorized, errorResponse("invalid email or password"))
	}

	token, err := h.authService.GenerateToken(owner.ID, owner.TokenVersion)
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

// ChangePassword replaces the owner's password and revokes every token issued
// before the change.
//
// Revoking is the point, not a side effect: the usual reason to change a
// password is that someone else might know it, and a change that leaves their
// session alive has not helped. The caller gets a fresh token back, so the
// device the change was made from stays signed in and nothing else does.
// PUT /api/me/password
func (h *AuthHandler) ChangePassword(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)

	var req changePasswordRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid request body"))
	}
	if req.CurrentPassword == "" || req.NewPassword == "" {
		return c.JSON(http.StatusBadRequest, errorResponse("enter both your current password and a new one"))
	}
	if msg := validatePassword(req.NewPassword, ownerMinPassword); msg != "" {
		return c.JSON(http.StatusBadRequest, errorResponse(msg))
	}

	var hash string
	if err := h.db.Get(&hash, `SELECT password_hash FROM owners WHERE id = $1`, ownerID); err != nil {
		return serverError(c, err, "failed to load the account")
	}
	// 400, not 401. The session is fine; the typed password is not. Every
	// client treats a 401 as "you have been signed out", which is the wrong
	// thing to do to someone who mistyped.
	if !h.authService.CheckPassword(req.CurrentPassword, hash) {
		return c.JSON(http.StatusBadRequest, errorResponse("your current password is not correct"))
	}
	if req.NewPassword == req.CurrentPassword {
		return c.JSON(http.StatusBadRequest, errorResponse("the new password is the same as the current one"))
	}

	newHash, err := h.authService.HashPassword(req.NewPassword)
	if err != nil {
		return serverError(c, err, "failed to process password")
	}

	var version int
	err = h.db.Get(&version, `
		UPDATE owners
		SET password_hash = $1, token_version = token_version + 1, updated_at = NOW()
		WHERE id = $2
		RETURNING token_version`,
		newHash, ownerID,
	)
	if err != nil {
		return serverError(c, err, "failed to change password")
	}

	token, err := h.authService.GenerateToken(ownerID, version)
	if err != nil {
		return serverError(c, err, "failed to generate token")
	}
	return c.JSON(http.StatusOK, map[string]string{"token": token})
}

// SignOutEverywhere revokes every token this owner holds, the caller's
// included.
//
// Plain sign-out stays local: it forgets this browser's token and touches no
// other device, which is what someone signing out of a shared front-desk
// machine expects. This is the other thing — a phone left in an auto-rickshaw
// — and it needs no password change to use.
// POST /api/me/sign-out-everywhere
func (h *AuthHandler) SignOutEverywhere(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	if _, err := h.db.Exec(
		`UPDATE owners SET token_version = token_version + 1, updated_at = NOW() WHERE id = $1`,
		ownerID,
	); err != nil {
		return serverError(c, err, "failed to sign out other devices")
	}
	return c.NoContent(http.StatusNoContent)
}
