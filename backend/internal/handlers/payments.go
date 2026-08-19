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

type PaymentHandler struct {
	db *sqlx.DB
}

func NewPaymentHandler(db *sqlx.DB) *PaymentHandler {
	return &PaymentHandler{db: db}
}

type createPaymentRequest struct {
	Amount      int64  `json:"amount"`       // in paise
	PaymentType string `json:"payment_type"` // "cash"|"online"
	PaymentDate string `json:"payment_date"` // YYYY-MM-DD
	Notes       string `json:"notes"`
}

// stayOwnerCheck reports whether a stay belongs to the calling owner.
//
// Returns an error rather than folding a failed query into `false`: a database
// problem is not the same answer as "this is not yours", and collapsing the
// two showed the caller a 404 while the real fault went unrecorded.
func (h *PaymentHandler) stayOwnerCheck(stayID, ownerID int64) (bool, error) {
	var count int
	if err := h.db.Get(&count,
		`SELECT COUNT(*) FROM stays s JOIN tenants t ON t.id = s.tenant_id WHERE s.id = $1 AND t.owner_id = $2`,
		stayID, ownerID,
	); err != nil {
		return false, err
	}
	return count > 0, nil
}

func (h *PaymentHandler) List(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	stayID, err := strconv.ParseInt(c.Param("stayId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid stay id"))
	}

	owned, err := h.stayOwnerCheck(stayID, ownerID)
	if err != nil {
		return serverError(c, err, "failed to verify the stay")
	}
	if !owned {
		return c.JSON(http.StatusNotFound, errorResponse("stay not found"))
	}

	var payments []models.Payment
	err = h.db.Select(&payments,
		`SELECT id, stay_id, amount, payment_type, payment_date, proof_url, notes, is_approved, created_at
		 FROM payments WHERE stay_id = $1 ORDER BY payment_date DESC`,
		stayID,
	)
	if err != nil {
		return serverError(c, err, "failed to fetch payments")
	}
	if payments == nil {
		payments = []models.Payment{}
	}
	return c.JSON(http.StatusOK, payments)
}

func (h *PaymentHandler) Create(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	stayID, err := strconv.ParseInt(c.Param("stayId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid stay id"))
	}

	owned, err := h.stayOwnerCheck(stayID, ownerID)
	if err != nil {
		return serverError(c, err, "failed to verify the stay")
	}
	if !owned {
		return c.JSON(http.StatusNotFound, errorResponse("stay not found"))
	}

	var req createPaymentRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid request body"))
	}
	if req.Amount <= 0 {
		return c.JSON(http.StatusBadRequest, errorResponse("amount must be positive"))
	}
	if req.PaymentType == "" {
		req.PaymentType = "cash"
	}

	paymentDate := time.Now().Truncate(24 * time.Hour)
	if req.PaymentDate != "" {
		paymentDate, err = time.Parse("2006-01-02", req.PaymentDate)
		if err != nil {
			return c.JSON(http.StatusBadRequest, errorResponse("invalid payment_date format, use YYYY-MM-DD"))
		}
	}

	var payment models.Payment
	err = h.db.QueryRowx(
		`INSERT INTO payments (stay_id, amount, payment_type, payment_date, notes, is_approved, created_at)
		 VALUES ($1, $2, $3, $4, $5, true, $6)
		 RETURNING id, stay_id, amount, payment_type, payment_date, proof_url, notes, is_approved, created_at`,
		stayID, req.Amount, req.PaymentType, paymentDate, req.Notes, time.Now(),
	).StructScan(&payment)
	if err != nil {
		return serverError(c, err, "failed to create payment")
	}
	return c.JSON(http.StatusCreated, payment)
}

type pendingPayment struct {
	models.Payment
	TenantName string `db:"tenant_name" json:"tenant_name"`
	BedName    string `db:"bed_name" json:"bed_name"`
	RoomName   string `db:"room_name" json:"room_name"`
	SiteName   string `db:"site_name" json:"site_name"`
}

func (h *PaymentHandler) ListPending(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)

	var payments []pendingPayment
	err := h.db.Select(&payments,
		`SELECT p.id, p.stay_id, p.amount, p.payment_type, p.payment_date,
		        p.proof_url, p.notes, p.is_approved, p.created_at,
		        t.name AS tenant_name,
		        COALESCE(b.name, 'Unassigned') AS bed_name,
		        COALESCE(r.name, '') AS room_name,
		        COALESCE(hs.name, '') AS site_name
		 FROM payments p
		 JOIN stays s ON s.id = p.stay_id
		 JOIN tenants t ON t.id = s.tenant_id
		 LEFT JOIN beds b ON b.id = s.bed_id
		 LEFT JOIN rooms r ON r.id = b.room_id
		 LEFT JOIN hostel_sites hs ON hs.id = r.site_id
		 WHERE t.owner_id = $1 AND p.is_approved = false
		 ORDER BY p.created_at DESC`,
		ownerID,
	)
	if err != nil {
		return serverError(c, err, "failed to fetch pending payments")
	}
	if payments == nil {
		payments = []pendingPayment{}
	}
	return c.JSON(http.StatusOK, payments)
}

func (h *PaymentHandler) Approve(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	paymentID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid payment id"))
	}

	result, err := h.db.Exec(
		`UPDATE payments p SET is_approved = true
		 FROM stays s, tenants t
		 WHERE p.id = $1 AND p.stay_id = s.id AND s.tenant_id = t.id AND t.owner_id = $2`,
		paymentID, ownerID,
	)
	if err != nil {
		return serverError(c, err, "failed to approve payment")
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return c.JSON(http.StatusNotFound, errorResponse("payment not found"))
	}
	return c.JSON(http.StatusOK, map[string]string{"message": "approved"})
}

func (h *PaymentHandler) Delete(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	paymentID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid payment id"))
	}

	// Verify ownership via stay → tenant
	result, err := h.db.Exec(
		`DELETE FROM payments p
		 USING stays s, tenants t
		 WHERE p.id = $1 AND p.stay_id = s.id AND s.tenant_id = t.id AND t.owner_id = $2`,
		paymentID, ownerID,
	)
	if err != nil {
		return serverError(c, err, "failed to delete payment")
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return c.JSON(http.StatusNotFound, errorResponse("payment not found"))
	}
	return c.JSON(http.StatusOK, map[string]string{"message": "payment deleted"})
}
