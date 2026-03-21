package handlers

import (
	"net/http"
	"strings"

	"github.com/jmoiron/sqlx"
	"github.com/labstack/echo/v4"
	"github.com/winnow/hostel/internal/auth"
	appMiddleware "github.com/winnow/hostel/internal/middleware"
	"github.com/winnow/hostel/internal/models"
)

type TenantAuthHandler struct {
	db          *sqlx.DB
	authService *auth.Service
}

func NewTenantAuthHandler(db *sqlx.DB, authService *auth.Service) *TenantAuthHandler {
	return &TenantAuthHandler{db: db, authService: authService}
}

type tenantLoginRequest struct {
	Phone    string `json:"phone"`
	Password string `json:"password"`
}

type tenantAuthResponse struct {
	Token  string        `json:"token"`
	Tenant models.Tenant `json:"tenant"`
}

func (h *TenantAuthHandler) Login(c echo.Context) error {
	var req tenantLoginRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid request body"))
	}
	req.Phone = strings.TrimSpace(req.Phone)
	if req.Phone == "" || req.Password == "" {
		return c.JSON(http.StatusBadRequest, errorResponse("phone and password are required"))
	}

	var tenant models.Tenant
	err := h.db.QueryRowx(
		`SELECT id, owner_id, name, phone, email, id_proof_url, photo_url, password_hash, is_approved, created_at, updated_at
		 FROM tenants WHERE phone = $1 AND is_approved = true AND password_hash IS NOT NULL`,
		req.Phone,
	).StructScan(&tenant)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, errorResponse("invalid phone or password"))
	}

	if !h.authService.CheckPassword(req.Password, tenant.PasswordHash) {
		return c.JSON(http.StatusUnauthorized, errorResponse("invalid phone or password"))
	}

	token, err := h.authService.GenerateTenantToken(tenant.ID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, errorResponse("failed to generate token"))
	}

	return c.JSON(http.StatusOK, tenantAuthResponse{Token: token, Tenant: tenant})
}

func (h *TenantAuthHandler) Me(c echo.Context) error {
	tenantID := appMiddleware.GetTenantID(c)

	var tenant models.Tenant
	err := h.db.QueryRowx(
		`SELECT id, owner_id, name, phone, email, id_proof_url, photo_url, is_approved, created_at, updated_at
		 FROM tenants WHERE id = $1`,
		tenantID,
	).StructScan(&tenant)
	if err != nil {
		return c.JSON(http.StatusNotFound, errorResponse("tenant not found"))
	}
	return c.JSON(http.StatusOK, tenant)
}
