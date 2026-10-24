package handlers

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/labstack/echo/v4"
	appMiddleware "github.com/winnow/hostel/internal/middleware"
	"github.com/winnow/hostel/internal/models"
	"github.com/winnow/hostel/internal/storage"
)

type TenantPortalHandler struct {
	db      *sqlx.DB
	storage storage.Service
}

func NewTenantPortalHandler(db *sqlx.DB, s storage.Service) *TenantPortalHandler {
	return &TenantPortalHandler{db: db, storage: s}
}

type tenantStay struct {
	ID              int64            `db:"id" json:"id"`
	BedID           *int64           `db:"bed_id" json:"bed_id,omitempty"`
	BedName         string           `db:"bed_name" json:"bed_name"`
	RoomName        string           `db:"room_name" json:"room_name"`
	SiteName        string           `db:"site_name" json:"site_name"`
	RentAmount      int64            `db:"rent_amount" json:"rent_amount"`
	DepositAmount   int64            `db:"deposit_amount" json:"deposit_amount"`
	RentCycle       string           `db:"rent_cycle" json:"rent_cycle"`
	StartDate       time.Time        `db:"start_date" json:"start_date"`
	EndDate         *time.Time       `db:"end_date" json:"end_date,omitempty"`
	NoticeDate      *time.Time       `db:"notice_date" json:"notice_date,omitempty"`
	ExpectedEndDate *time.Time       `db:"expected_end_date" json:"expected_end_date,omitempty"`
	CreatedAt       time.Time        `db:"created_at" json:"created_at"`
	Payments        []models.Payment `json:"payments"`
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
		        s.start_date, s.end_date, s.notice_date, s.expected_end_date, s.created_at
		 FROM stays s
		 LEFT JOIN beds b        ON b.id = s.bed_id
		 LEFT JOIN rooms r       ON r.id = b.room_id
		 LEFT JOIN hostel_sites hs ON hs.id = r.site_id
		 WHERE s.tenant_id = $1
		 ORDER BY s.start_date DESC`,
		tenantID,
	)
	if err != nil {
		return serverError(c, err, "failed to fetch stays")
	}
	if stays == nil {
		stays = []tenantStay{}
	}

	// Load payments per stay
	for i := range stays {
		var payments []models.Payment
		if err := h.db.Select(&payments,
			`SELECT `+paymentColumns+`
			 FROM payments WHERE stay_id = $1 ORDER BY payment_date DESC`,
			stays[i].ID,
		); err != nil {
			return serverError(c, err, "failed to load payments")
		}
		if payments == nil {
			payments = []models.Payment{}
		}
		if err := signPayments(c, h.storage, payments); err != nil {
			return serverError(c, err, "failed to prepare payment proofs")
		}
		stays[i].Payments = payments
	}

	return c.JSON(http.StatusOK, stays)
}

// GetSummary is what this tenant owes and when, from the same figures the
// owner sees on their page (loadTenantSummary). The portal used to show only
// the payments, so someone two months behind saw a green "Active" and a list
// of confirmed payments, and nothing else.
func (h *TenantPortalHandler) GetSummary(c echo.Context) error {
	summary, err := loadTenantSummary(h.db, appMiddleware.GetTenantID(c))
	if err != nil {
		return serverError(c, err, "failed to load what you owe")
	}
	return c.JSON(http.StatusOK, summary)
}

type tenantSubmitPaymentRequest struct {
	Amount int64 `json:"amount"` // in paise
	// "cash" or "online" (shown as UPI). It was always "online" before Oct
	// 2026, whatever the tenant had actually done, so a cash payment handed
	// to someone at the desk came into the owner's queue labelled UPI.
	PaymentType string `json:"payment_type"`
	Notes       string `json:"notes"`
	ProofURL    string `json:"proof_url"`
}

func (h *TenantPortalHandler) SubmitPayment(c echo.Context) error {
	tenantID := appMiddleware.GetTenantID(c)
	stayID, err := strconv.ParseInt(c.Param("stayId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid stay id"))
	}

	// Verify stay belongs to this tenant
	var count int
	if err := h.db.Get(&count, `SELECT COUNT(*) FROM stays WHERE id = $1 AND tenant_id = $2`, stayID, tenantID); err != nil {
		return serverError(c, err, "failed to verify the stay")
	}
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
	if req.PaymentType != "cash" && req.PaymentType != "online" {
		return c.JSON(http.StatusBadRequest, errorResponse("Say whether you paid by cash or UPI."))
	}

	if !validFileRef(req.ProofURL) {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid proof_url"))
	}
	proofURL := optionalString(req.ProofURL)

	now := time.Now()
	var payment models.Payment
	err = h.db.QueryRowx(
		// $3 and $6 are the same instant but must be separate placeholders:
		// payment_date is DATE and created_at is TIMESTAMPTZ, and reusing one
		// parameter across both makes Postgres fail to deduce its type
		// (42P08, "inconsistent types deduced for parameter $3"). This is why
		// no tenant-submitted payment ever reached the database.
		`INSERT INTO payments (stay_id, amount, payment_type, payment_date, proof_url, notes, is_approved, created_at)
		 VALUES ($1, $2, $7, $3, $4, $5, false, $6)
		 RETURNING `+paymentColumns,
		stayID, req.Amount, now, proofURL, req.Notes, now, req.PaymentType,
	).StructScan(&payment)
	if err != nil {
		return serverError(c, err, "failed to submit payment")
	}
	if err := signPayment(c, h.storage, &payment); err != nil {
		return serverError(c, err, "failed to prepare payment proof")
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
	if err := h.db.Get(&count,
		`SELECT COUNT(*) FROM stays WHERE id = $1 AND tenant_id = $2 AND end_date IS NULL`,
		stayID, tenantID,
	); err != nil {
		return serverError(c, err, "failed to submit notice")
	}
	if count == 0 {
		return c.JSON(http.StatusNotFound, errorResponse("active stay not found"))
	}

	noticeDate := time.Now().Truncate(24 * time.Hour)

	// The date they intend to leave, if they know it. Optional: the portal used
	// to record only THAT a tenant was going, never WHEN, so the owner had to
	// chase them for it — the confirm dialog literally promised a phone call.
	// A missing or empty value leaves the field alone rather than erroring, so
	// an older client posting `{}` still works.
	var req struct {
		ExpectedEndDate string `json:"expected_end_date"`
	}
	_ = c.Bind(&req)

	var expectedEnd *time.Time
	if strings.TrimSpace(req.ExpectedEndDate) != "" {
		t, parseErr := time.Parse("2006-01-02", strings.TrimSpace(req.ExpectedEndDate))
		if parseErr != nil {
			return c.JSON(http.StatusBadRequest, errorResponse("expected_end_date must be YYYY-MM-DD"))
		}
		// A tenant gives notice about the future. Backdating a departure is a
		// claim about what already happened, and only the owner — who can see
		// the bed — gets to make that one.
		if t.Before(noticeDate) {
			return c.JSON(http.StatusBadRequest, errorResponse("the date you leave cannot be in the past"))
		}
		expectedEnd = &t
	}

	var stay models.Stay
	err = h.db.QueryRowx(
		// COALESCE on notice_date: changing the leaving date is not a new
		// notice. When they first told the owner decides whether the deposit
		// comes back (noticeBy), so moving the date must not move it.
		`UPDATE stays SET notice_date = COALESCE(notice_date, $1), expected_end_date = COALESCE($4, expected_end_date), updated_at = $2
		 WHERE id = $3
		 RETURNING id, tenant_id, bed_id, rent_amount, deposit_amount, rent_cycle, start_date, end_date, notice_date, expected_end_date, created_at, updated_at`,
		noticeDate, time.Now(), stayID, expectedEnd,
	).StructScan(&stay)
	if err != nil {
		return serverError(c, err, "failed to submit notice")
	}
	return c.JSON(http.StatusOK, stay)
}

// WithdrawNotice takes back a notice to vacate: both dates, as the owner's
// "They're staying" does. A tenant who pressed the button by mistake, or
// changed their mind, had no way back from the portal; only the owner could
// undo it. Notice given again later is dated that day.
func (h *TenantPortalHandler) WithdrawNotice(c echo.Context) error {
	tenantID := appMiddleware.GetTenantID(c)
	stayID, err := strconv.ParseInt(c.Param("stayId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid stay id"))
	}

	var stay models.Stay
	err = h.db.QueryRowx(
		`UPDATE stays SET notice_date = NULL, expected_end_date = NULL, updated_at = $1
		 WHERE id = $2 AND tenant_id = $3 AND end_date IS NULL
		 RETURNING id, tenant_id, bed_id, rent_amount, deposit_amount, rent_cycle, start_date, end_date, notice_date, expected_end_date, created_at, updated_at`,
		time.Now(), stayID, tenantID,
	).StructScan(&stay)
	if errors.Is(err, sql.ErrNoRows) {
		return c.JSON(http.StatusNotFound, errorResponse("active stay not found"))
	}
	if err != nil {
		return serverError(c, err, "failed to withdraw notice")
	}
	return c.JSON(http.StatusOK, stay)
}
