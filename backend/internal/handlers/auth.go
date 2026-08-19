package handlers

import (
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
	if len(req.Password) < 8 {
		return c.JSON(http.StatusBadRequest, errorResponse("password must be at least 8 characters"))
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
