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

// tenantCols is the SELECT column list for all tenant queries.
const tenantCols = `id, owner_id, name, phone, email, id_proof_url, photo_url,
	address, emergency_contact_name, emergency_contact_phone,
	workplace, aadhaar_number, id_proof_front_url, id_proof_back_url,
	is_approved, created_at, updated_at`

type tenantRequest struct {
	Name                  string  `json:"name"`
	Phone                 string  `json:"phone"`
	Email                 string  `json:"email"`
	Address               *string `json:"address"`
	EmergencyContactName  *string `json:"emergency_contact_name"`
	EmergencyContactPhone *string `json:"emergency_contact_phone"`
	Workplace             *string `json:"workplace"`
	AadhaarNumber         *string `json:"aadhaar_number"`
	IDProofURL            *string `json:"id_proof_url"`
	IDProofFrontURL       *string `json:"id_proof_front_url"`
	IDProofBackURL        *string `json:"id_proof_back_url"`
	PhotoURL              *string `json:"photo_url"`
}

func (h *TenantHandler) List(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)

	query := `SELECT ` + tenantCols + ` FROM tenants WHERE owner_id = $1`
	if c.QueryParam("pending") == "true" {
		query += " AND is_approved = false ORDER BY created_at DESC"
	} else {
		query += " AND is_approved = true ORDER BY name"
	}

	var tenants []models.Tenant
	err := h.db.Select(&tenants, query, ownerID)
	if err != nil {
		return serverError(c, err, "failed to fetch tenants")
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
		`SELECT `+tenantCols+` FROM tenants WHERE id = $1 AND owner_id = $2`,
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
		`INSERT INTO tenants (owner_id, name, phone, email,
			address, emergency_contact_name, emergency_contact_phone,
			workplace, aadhaar_number, id_proof_url, id_proof_front_url, id_proof_back_url, photo_url,
			is_approved, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, true, $14, $14)
		 RETURNING `+tenantCols,
		ownerID, req.Name, req.Phone, req.Email,
		req.Address, req.EmergencyContactName, req.EmergencyContactPhone,
		req.Workplace, req.AadhaarNumber, req.IDProofURL, req.IDProofFrontURL, req.IDProofBackURL, req.PhotoURL,
		time.Now(),
	).StructScan(&tenant)
	if err != nil {
		return serverError(c, err, "failed to create tenant")
	}
	return c.JSON(http.StatusCreated, tenant)
}

type publicRegisterRequest struct {
	Name                  string `json:"name"`
	Phone                 string `json:"phone"`
	Email                 string `json:"email"`
	Password              string `json:"password"`
	IDProofURL            string `json:"id_proof_url"` // legacy
	IDProofFrontURL       string `json:"id_proof_front_url"`
	IDProofBackURL        string `json:"id_proof_back_url"`
	Address               string `json:"address"`
	EmergencyContactName  string `json:"emergency_contact_name"`
	EmergencyContactPhone string `json:"emergency_contact_phone"`
	Workplace             string `json:"workplace"`
	AadhaarNumber         string `json:"aadhaar_number"`
}

// PublicOwner returns just enough about an owner to make a registration link
// look legitimate to the stranger who scanned it.
//
// Deliberately name-only. The registration page is the one screen in the
// product shown to someone with no account, reached by pointing a phone at a
// sticker in a corridor — without the property's name on it, the form is
// indistinguishable from a phishing page, which is the whole problem Phase F
// exists to fix. Email, phone and everything else stay behind auth: owner ids
// are small integers and therefore enumerable, so this endpoint is a directory
// of hostel names and must never become a directory of contact details.
// GET /public/owners/:ownerId
func (h *TenantHandler) PublicOwner(c echo.Context) error {
	ownerID, err := strconv.ParseInt(c.Param("ownerId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid owner id"))
	}

	var name string
	if err := h.db.Get(&name, `SELECT name FROM owners WHERE id = $1`, ownerID); err != nil {
		return c.JSON(http.StatusNotFound, errorResponse("registration link not found"))
	}
	return c.JSON(http.StatusOK, map[string]string{"name": name})
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
		return serverError(c, err, "failed to process password")
	}

	// Validate upload URLs
	var idProofURL, idProofFrontURL, idProofBackURL *string
	if req.IDProofURL != "" {
		if !ValidateUploadedURL(req.IDProofURL) {
			return c.JSON(http.StatusBadRequest, errorResponse("invalid id_proof_url"))
		}
		idProofURL = &req.IDProofURL
	}
	if req.IDProofFrontURL != "" {
		if !ValidateUploadedURL(req.IDProofFrontURL) {
			return c.JSON(http.StatusBadRequest, errorResponse("invalid id_proof_front_url"))
		}
		idProofFrontURL = &req.IDProofFrontURL
	}
	if req.IDProofBackURL != "" {
		if !ValidateUploadedURL(req.IDProofBackURL) {
			return c.JSON(http.StatusBadRequest, errorResponse("invalid id_proof_back_url"))
		}
		idProofBackURL = &req.IDProofBackURL
	}

	var address, emergencyName, emergencyPhone, workplace, aadhaar *string
	if req.Address != "" {
		address = &req.Address
	}
	if req.EmergencyContactName != "" {
		emergencyName = &req.EmergencyContactName
	}
	if req.EmergencyContactPhone != "" {
		emergencyPhone = &req.EmergencyContactPhone
	}
	if req.Workplace != "" {
		workplace = &req.Workplace
	}
	if req.AadhaarNumber != "" {
		aadhaar = &req.AadhaarNumber
	}

	var tenant models.Tenant
	err = h.db.QueryRowx(
		`INSERT INTO tenants (owner_id, name, phone, email, password_hash,
			id_proof_url, id_proof_front_url, id_proof_back_url,
			address, emergency_contact_name, emergency_contact_phone,
			workplace, aadhaar_number,
			is_approved, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, false, $14, $14)
		 RETURNING `+tenantCols,
		ownerID, req.Name, req.Phone, req.Email, hash,
		idProofURL, idProofFrontURL, idProofBackURL,
		address, emergencyName, emergencyPhone, workplace, aadhaar,
		time.Now(),
	).StructScan(&tenant)
	if err != nil {
		return serverError(c, err, "failed to register")
	}
	return c.JSON(http.StatusCreated, tenant)
}

type approveRequest struct {
	BedID         *int64 `json:"bed_id"`
	RentAmount    int64  `json:"rent_amount"`
	DepositAmount int64  `json:"deposit_amount"`
	RentCycle     string `json:"rent_cycle"`
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
		 RETURNING `+tenantCols,
		time.Now(), tenantID, ownerID,
	).StructScan(&tenant)
	if err != nil {
		return c.JSON(http.StatusNotFound, errorResponse("tenant not found"))
	}

	// Create stay if either a bed is provided (full assignment) or a deposit is being collected (pending assignment)
	if req.BedID != nil || req.RentAmount > 0 {
		if req.RentCycle != "daily" && req.RentCycle != "weekly" && req.RentCycle != "monthly" {
			req.RentCycle = "monthly"
		}

		startDate := time.Now()
		if req.StartDate != "" {
			startDate, err = time.Parse("2006-01-02", req.StartDate)
			if err != nil {
				return c.JSON(http.StatusBadRequest, errorResponse("invalid start date"))
			}
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

			// Check bed is not already occupied
			var activeStays int
			if err := h.db.Get(&activeStays, `SELECT COUNT(*) FROM stays WHERE bed_id = $1 AND end_date IS NULL`, *req.BedID); err != nil {
				return serverError(c, err, "failed to approve tenant")
			}
			if activeStays > 0 {
				return c.JSON(http.StatusConflict, errorResponse("bed is already occupied"))
			}
		}

		// Check tenant doesn't already have an active stay
		var activeTenantStays int
		if err := h.db.Get(&activeTenantStays, `SELECT COUNT(*) FROM stays WHERE tenant_id = $1 AND end_date IS NULL`, tenantID); err != nil {
			return serverError(c, err, "failed to approve tenant")
		}
		if activeTenantStays > 0 {
			return c.JSON(http.StatusConflict, errorResponse("tenant already has an active stay"))
		}

		_, err = h.db.Exec(
			`INSERT INTO stays (tenant_id, bed_id, rent_amount, deposit_amount, rent_cycle, start_date, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
			tenantID, req.BedID, req.RentAmount, req.DepositAmount, req.RentCycle, startDate, time.Now(),
		)
		if err != nil {
			// The message stays specific because a partial success is worth
			// telling the client about — the tenant IS approved. The raw
			// error does not go with it: it can carry query text and column
			// values, and it now goes to the log instead.
			return serverError(c, err, "tenant approved but failed to create stay")
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
		return serverError(c, err, "failed to reject")
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

	// Validate upload URLs if provided
	if req.IDProofURL != nil && *req.IDProofURL != "" && !ValidateUploadedURL(*req.IDProofURL) {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid id_proof_url"))
	}
	if req.IDProofFrontURL != nil && *req.IDProofFrontURL != "" && !ValidateUploadedURL(*req.IDProofFrontURL) {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid id_proof_front_url"))
	}
	if req.IDProofBackURL != nil && *req.IDProofBackURL != "" && !ValidateUploadedURL(*req.IDProofBackURL) {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid id_proof_back_url"))
	}
	if req.PhotoURL != nil && *req.PhotoURL != "" && !ValidateUploadedURL(*req.PhotoURL) {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid photo_url"))
	}

	var tenant models.Tenant
	err = h.db.QueryRowx(
		`UPDATE tenants
		 SET name = $1, phone = $2, email = $3,
		     address = $4, emergency_contact_name = $5, emergency_contact_phone = $6,
		     workplace = $7, aadhaar_number = $8,
		     id_proof_url = COALESCE($9, id_proof_url),
		     id_proof_front_url = COALESCE($10, id_proof_front_url),
		     id_proof_back_url = COALESCE($11, id_proof_back_url),
		     photo_url = COALESCE($12, photo_url),
		     updated_at = $13
		 WHERE id = $14 AND owner_id = $15
		 RETURNING `+tenantCols,
		req.Name, req.Phone, req.Email,
		req.Address, req.EmergencyContactName, req.EmergencyContactPhone,
		req.Workplace, req.AadhaarNumber,
		req.IDProofURL, req.IDProofFrontURL, req.IDProofBackURL, req.PhotoURL,
		time.Now(), tenantID, ownerID,
	).StructScan(&tenant)
	if err != nil {
		return c.JSON(http.StatusNotFound, errorResponse("tenant not found"))
	}
	return c.JSON(http.StatusOK, tenant)
}

// TenantSummary holds aggregate stats for a tenant's stays and payments.
type TenantSummary struct {
	TotalPaid     int64 `json:"total_paid"`
	TotalExpected int64 `json:"total_expected"`
	Balance       int64 `json:"balance"`
	DurationDays  int64 `json:"duration_days"`
}

// dateOnly strips the time component so day arithmetic isn't skewed by the
// timezone Postgres hands back for a DATE column.
func dateOnly(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

func (h *TenantHandler) Summary(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	tenantID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid tenant id"))
	}

	// Verify tenant belongs to owner
	var count int
	if err := h.db.Get(&count, `SELECT COUNT(*) FROM tenants WHERE id = $1 AND owner_id = $2`, tenantID, ownerID); err != nil {
		return serverError(c, err, "failed to compute summary")
	}
	if count == 0 {
		return c.JSON(http.StatusNotFound, errorResponse("tenant not found"))
	}

	// One row per stay. Payment totals come from a correlated subquery rather
	// than a JOIN: joining stays to payments yields one row per payment, and
	// summing per-stay values (expected rent, duration) across those rows
	// multiplied them by the payment count.
	type staySummaryRow struct {
		RentAmount int64      `db:"rent_amount"`
		RentCycle  string     `db:"rent_cycle"`
		StartDate  time.Time  `db:"start_date"`
		EndDate    *time.Time `db:"end_date"`
		TotalPaid  int64      `db:"total_paid"`
	}
	var stays []staySummaryRow
	err = h.db.Select(&stays, `
		SELECT
			s.rent_amount,
			s.rent_cycle,
			s.start_date,
			s.end_date,
			COALESCE((
				SELECT SUM(p.amount) FROM payments p
				WHERE p.stay_id = s.id AND p.is_approved = true
			), 0) AS total_paid
		FROM stays s
		WHERE s.tenant_id = $1`,
		tenantID,
	)
	if err != nil {
		return serverError(c, err, "failed to compute summary")
	}

	// Billing cycles use cyclesElapsed so this agrees with the grid and the
	// dashboard. Computing it separately in SQL previously made the tenant page
	// disagree with the grid about what the same tenant owed.
	var summary TenantSummary
	today := dateOnly(time.Now())
	for _, s := range stays {
		start := dateOnly(s.StartDate)
		until := today
		if s.EndDate != nil {
			until = dateOnly(*s.EndDate)
		}

		summary.TotalPaid += s.TotalPaid
		summary.TotalExpected += s.RentAmount * int64(cyclesElapsed(start, until, s.RentCycle))
		if days := int64(until.Sub(start).Hours() / 24); days > 0 {
			summary.DurationDays += days
		}
	}

	summary.Balance = summary.TotalExpected - summary.TotalPaid
	return c.JSON(http.StatusOK, summary)
}
