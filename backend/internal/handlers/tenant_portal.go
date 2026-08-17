package handlers

import (
	"net/http"
	"strconv"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/labstack/echo/v4"
	appMiddleware "github.com/winnow/hostel/internal/middleware"
	"github.com/winnow/hostel/internal/models"
)

type TenantPortalHandler struct {
	db *sqlx.DB
}

func NewTenantPortalHandler(db *sqlx.DB) *TenantPortalHandler {
	return &TenantPortalHandler{db: db}
}

type tenantStay struct {
	ID            int64      `db:"id" json:"id"`
	BedID         *int64     `db:"bed_id" json:"bed_id,omitempty"`
	BedName       string     `db:"bed_name" json:"bed_name"`
	RoomName      string     `db:"room_name" json:"room_name"`
	SiteName      string     `db:"site_name" json:"site_name"`
	RentAmount    int64      `db:"rent_amount" json:"rent_amount"`
	DepositAmount int64      `db:"deposit_amount" json:"deposit_amount"`
	RentCycle     string     `db:"rent_cycle" json:"rent_cycle"`
	StartDate     time.Time  `db:"start_date" json:"start_date"`
	EndDate       *time.Time `db:"end_date" json:"end_date,omitempty"`
	NoticeDate    *time.Time `db:"notice_date" json:"notice_date,omitempty"`
	CreatedAt     time.Time  `db:"created_at" json:"created_at"`
	Payments      []models.Payment `json:"payments"`
}

func (h *TenantPortalHandler) GetStays(c echo.Context) error {
	tenantID := appMiddleware.GetTenantID(c)

	var stays []tenantStay
	err := h.db.Select(&stays,
		`SELECT s.id, s.bed_id,
		        COALESCE(b.name, 'Unassigned') AS bed_name,
		        COALESCE(r.name, '') AS room_name,
		        COALESCE(hs.name, '') AS site_name,
		        s.rent_amount, s.deposit_amount, s.rent_cycle,
		        s.start_date, s.end_date, s.notice_date, s.created_at
		 FROM stays s
		 LEFT JOIN beds b        ON b.id = s.bed_id
		 LEFT JOIN rooms r       ON r.id = b.room_id
		 LEFT JOIN hostel_sites hs ON hs.id = r.site_id
		 WHERE s.tenant_id = $1
		 ORDER BY s.start_date DESC`,
		tenantID,
	)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, errorResponse("failed to fetch stays"))
	}
	if stays == nil {
		stays = []tenantStay{}
	}

	// Load payments per stay
	for i := range stays {
		var payments []models.Payment
		h.db.Select(&payments,
			`SELECT id, stay_id, amount, payment_type, payment_date, proof_url, notes, is_approved, created_at
			 FROM payments WHERE stay_id = $1 ORDER BY payment_date DESC`,
			stays[i].ID,
		)
		if payments == nil {
			payments = []models.Payment{}
		}
		stays[i].Payments = payments
	}

	return c.JSON(http.StatusOK, stays)
}

type tenantSubmitPaymentRequest struct {
	Amount   int64  `json:"amount"` // in paise
	Notes    string `json:"notes"`
	ProofURL string `json:"proof_url"`
}

func (h *TenantPortalHandler) SubmitPayment(c echo.Context) error {
	tenantID := appMiddleware.GetTenantID(c)
	stayID, err := strconv.ParseInt(c.Param("stayId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid stay id"))
	}

	// Verify stay belongs to this tenant
	var count int
	h.db.Get(&count, `SELECT COUNT(*) FROM stays WHERE id = $1 AND tenant_id = $2`, stayID, tenantID)
	if count == 0 {
		return c.JSON(http.StatusNotFound, errorResponse("stay not found"))
	}

	var req tenantSubmitPaymentRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid request body"))
	}
	if req.Amount <= 0 {
		return c.JSON(http.StatusBadRequest, errorResponse("amount must be positive"))
	}

	var proofURL *string
	if req.ProofURL != "" {
		if !ValidateUploadedURL(req.ProofURL) {
			return c.JSON(http.StatusBadRequest, errorResponse("invalid proof_url"))
		}
		proofURL = &req.ProofURL
	}

	var payment models.Payment
	err = h.db.QueryRowx(
		`INSERT INTO payments (stay_id, amount, payment_type, payment_date, proof_url, notes, is_approved, created_at)
		 VALUES ($1, $2, 'online', $3, $4, $5, false, $3)
		 RETURNING id, stay_id, amount, payment_type, payment_date, proof_url, notes, is_approved, created_at`,
		stayID, req.Amount, time.Now(), proofURL, req.Notes,
	).StructScan(&payment)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, errorResponse("failed to submit payment"))
	}
	return c.JSON(http.StatusCreated, payment)
}

func (h *TenantPortalHandler) SubmitNotice(c echo.Context) error {
	tenantID := appMiddleware.GetTenantID(c)
	stayID, err := strconv.ParseInt(c.Param("stayId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid stay id"))
	}

	// Verify stay belongs to this tenant and is active
	var count int
	h.db.Get(&count,
		`SELECT COUNT(*) FROM stays WHERE id = $1 AND tenant_id = $2 AND end_date IS NULL`,
		stayID, tenantID,
	)
	if count == 0 {
		return c.JSON(http.StatusNotFound, errorResponse("active stay not found"))
	}

	noticeDate := time.Now().Truncate(24 * time.Hour)

	var stay models.Stay
	err = h.db.QueryRowx(
		`UPDATE stays SET notice_date = $1, updated_at = $2
		 WHERE id = $3
		 RETURNING id, tenant_id, bed_id, rent_amount, deposit_amount, rent_cycle, start_date, end_date, notice_date, created_at, updated_at`,
		noticeDate, time.Now(), stayID,
	).StructScan(&stay)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, errorResponse("failed to submit notice"))
	}
	return c.JSON(http.StatusOK, stay)
}
