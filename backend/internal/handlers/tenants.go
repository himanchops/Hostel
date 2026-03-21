package handlers

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/labstack/echo/v4"
	appMiddleware "github.com/winnow/hostel/internal/middleware"
	"github.com/winnow/hostel/internal/models"
)

type TenantHandler struct {
	db *sqlx.DB
}

func NewTenantHandler(db *sqlx.DB) *TenantHandler {
	return &TenantHandler{db: db}
}

type tenantRequest struct {
	Name  string `json:"name"`
	Phone string `json:"phone"`
	Email string `json:"email"`
}

func (h *TenantHandler) List(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)

	var tenants []models.Tenant
	err := h.db.Select(&tenants,
		`SELECT id, owner_id, name, phone, email, id_proof_url, photo_url, is_approved, created_at, updated_at
		 FROM tenants WHERE owner_id = $1 ORDER BY name`,
		ownerID,
	)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, errorResponse("failed to fetch tenants"))
	}
	if tenants == nil {
		tenants = []models.Tenant{}
	}
	return c.JSON(http.StatusOK, tenants)
}

func (h *TenantHandler) Get(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	tenantID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid tenant id"))
	}

	var tenant models.Tenant
	err = h.db.QueryRowx(
		`SELECT id, owner_id, name, phone, email, id_proof_url, photo_url, is_approved, created_at, updated_at
		 FROM tenants WHERE id = $1 AND owner_id = $2`,
		tenantID, ownerID,
	).StructScan(&tenant)
	if err != nil {
		return c.JSON(http.StatusNotFound, errorResponse("tenant not found"))
	}
	return c.JSON(http.StatusOK, tenant)
}

func (h *TenantHandler) Create(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)

	var req tenantRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid request body"))
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Phone = strings.TrimSpace(req.Phone)
	if req.Name == "" || req.Phone == "" {
		return c.JSON(http.StatusBadRequest, errorResponse("name and phone are required"))
	}

	var tenant models.Tenant
	err := h.db.QueryRowx(
		`INSERT INTO tenants (owner_id, name, phone, email, is_approved, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, true, $5, $5)
		 RETURNING id, owner_id, name, phone, email, id_proof_url, photo_url, is_approved, created_at, updated_at`,
		ownerID, req.Name, req.Phone, req.Email, time.Now(),
	).StructScan(&tenant)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, errorResponse("failed to create tenant"))
	}
	return c.JSON(http.StatusCreated, tenant)
}

func (h *TenantHandler) Update(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	tenantID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid tenant id"))
	}

	var req tenantRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid request body"))
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Phone = strings.TrimSpace(req.Phone)
	if req.Name == "" || req.Phone == "" {
		return c.JSON(http.StatusBadRequest, errorResponse("name and phone are required"))
	}

	var tenant models.Tenant
	err = h.db.QueryRowx(
		`UPDATE tenants SET name = $1, phone = $2, email = $3, updated_at = $4
		 WHERE id = $5 AND owner_id = $6
		 RETURNING id, owner_id, name, phone, email, id_proof_url, photo_url, is_approved, created_at, updated_at`,
		req.Name, req.Phone, req.Email, time.Now(), tenantID, ownerID,
	).StructScan(&tenant)
	if err != nil {
		return c.JSON(http.StatusNotFound, errorResponse("tenant not found"))
	}
	return c.JSON(http.StatusOK, tenant)
}
