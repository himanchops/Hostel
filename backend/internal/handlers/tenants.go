package handlers

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/labstack/echo/v4"
	"github.com/winnow/hostel/internal/auth"
	appMiddleware "github.com/winnow/hostel/internal/middleware"
	"github.com/winnow/hostel/internal/models"
)

type TenantHandler struct {
	db          *sqlx.DB
	authService *auth.Service
}

func NewTenantHandler(db *sqlx.DB, authService *auth.Service) *TenantHandler {
	return &TenantHandler{db: db, authService: authService}
}

type tenantRequest struct {
	Name  string `json:"name"`
	Phone string `json:"phone"`
	Email string `json:"email"`
}

func (h *TenantHandler) List(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)

	query := `SELECT id, owner_id, name, phone, email, id_proof_url, photo_url, is_approved, created_at, updated_at
		 FROM tenants WHERE owner_id = $1`
	if c.QueryParam("pending") == "true" {
		query += " AND is_approved = false ORDER BY created_at DESC"
	} else {
		query += " AND is_approved = true ORDER BY name"
	}

	var tenants []models.Tenant
	err := h.db.Select(&tenants, query, ownerID)
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

type publicRegisterRequest struct {
	Name        string `json:"name"`
	Phone       string `json:"phone"`
	Email       string `json:"email"`
	Password    string `json:"password"`
	IDProofURL  string `json:"id_proof_url"`
}

func (h *TenantHandler) PublicRegister(c echo.Context) error {
	ownerID, err := strconv.ParseInt(c.Param("ownerId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid owner id"))
	}

	var exists bool
	err = h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM owners WHERE id = $1)", ownerID).Scan(&exists)
	if err != nil || !exists {
		return c.JSON(http.StatusNotFound, errorResponse("registration link not found"))
	}

	var req publicRegisterRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid request body"))
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Phone = strings.TrimSpace(req.Phone)
	if req.Name == "" || req.Phone == "" {
		return c.JSON(http.StatusBadRequest, errorResponse("name and phone are required"))
	}
	if len(req.Password) < 6 {
		return c.JSON(http.StatusBadRequest, errorResponse("password must be at least 6 characters"))
	}

	hash, err := h.authService.HashPassword(req.Password)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, errorResponse("failed to process password"))
	}

	var idProofURL *string
	if req.IDProofURL != "" {
		if !ValidateUploadedURL(req.IDProofURL) {
			return c.JSON(http.StatusBadRequest, errorResponse("invalid id_proof_url"))
		}
		idProofURL = &req.IDProofURL
	}

	var tenant models.Tenant
	err = h.db.QueryRowx(
		`INSERT INTO tenants (owner_id, name, phone, email, password_hash, id_proof_url, is_approved, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, false, $7, $7)
		 RETURNING id, owner_id, name, phone, email, id_proof_url, photo_url, is_approved, created_at, updated_at`,
		ownerID, req.Name, req.Phone, req.Email, hash, idProofURL, time.Now(),
	).StructScan(&tenant)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, errorResponse("failed to register"))
	}
	return c.JSON(http.StatusCreated, tenant)
}

type approveRequest struct {
	BedID         *int64 `json:"bed_id"`
	RentAmount    int64  `json:"rent_amount"`
	DepositAmount int64  `json:"deposit_amount"`
	RentCycle     string `json:"rent_cycle"`
	RentDueDay    int    `json:"rent_due_day"`
	StartDate     string `json:"start_date"`
}

func (h *TenantHandler) Approve(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	tenantID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid tenant id"))
	}

	var req approveRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid request body"))
	}

	var tenant models.Tenant
	err = h.db.QueryRowx(
		`UPDATE tenants SET is_approved = true, updated_at = $1
		 WHERE id = $2 AND owner_id = $3
		 RETURNING id, owner_id, name, phone, email, id_proof_url, photo_url, is_approved, created_at, updated_at`,
		time.Now(), tenantID, ownerID,
	).StructScan(&tenant)
	if err != nil {
		return c.JSON(http.StatusNotFound, errorResponse("tenant not found"))
	}

	if req.BedID != nil {
		// Validate bed belongs to this owner
		var ownerCheck int64
		err = h.db.QueryRow(
			`SELECT hs.owner_id FROM beds b
			 JOIN rooms r ON r.id = b.room_id
			 JOIN hostel_sites hs ON hs.id = r.site_id
			 WHERE b.id = $1`,
			*req.BedID,
		).Scan(&ownerCheck)
		if err != nil || ownerCheck != ownerID {
			return c.JSON(http.StatusForbidden, errorResponse("bed not found"))
		}

		if req.RentCycle != "daily" && req.RentCycle != "weekly" && req.RentCycle != "monthly" {
			return c.JSON(http.StatusBadRequest, errorResponse("invalid rent cycle"))
		}
		startDate, err := time.Parse("2006-01-02", req.StartDate)
		if err != nil {
			return c.JSON(http.StatusBadRequest, errorResponse("invalid start date"))
		}

		_, err = h.db.Exec(
			`INSERT INTO stays (tenant_id, bed_id, rent_amount, deposit_amount, rent_cycle, rent_due_day, start_date, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
			tenantID, *req.BedID, req.RentAmount, req.DepositAmount, req.RentCycle, req.RentDueDay, startDate, time.Now(),
		)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, errorResponse("tenant approved but failed to create stay: "+err.Error()))
		}
	}

	return c.JSON(http.StatusOK, tenant)
}

func (h *TenantHandler) Reject(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	tenantID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid tenant id"))
	}

	res, err := h.db.Exec(
		`DELETE FROM tenants WHERE id = $1 AND owner_id = $2 AND is_approved = false`,
		tenantID, ownerID,
	)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, errorResponse("failed to reject"))
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return c.JSON(http.StatusNotFound, errorResponse("pending tenant not found"))
	}
	return c.JSON(http.StatusNoContent, nil)
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
