package handlers

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
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
	PaymentType string `json:"payment_type"` // "cash"|"online" — how it arrived
	// "rent"|"deposit" — what it is for. Absent means rent, which is what every
	// payment was before the distinction existed, so an older client (or the
	// bulk importer) keeps recording exactly what it always did.
	Kind        string `json:"kind"`
	PaymentDate string `json:"payment_date"` // YYYY-MM-DD
	Notes       string `json:"notes"`
}

// validatePaymentDate refuses a payment dated more than a day ahead.
//
// Money that has not arrived is not a payment. The UX audit found two dated
// the 13th and 17th sitting in "Collected this month" on the 9th — almost
// certainly a mistyped day. One day of slack, not zero, because "today" on the
// server is UTC while the owner is in IST, five and a half hours ahead: just
// after midnight in Pune, their today is the server's tomorrow.
func validatePaymentDate(paymentDate, now time.Time) error {
	y, m, d := now.UTC().Date()
	latest := time.Date(y, m, d+1, 0, 0, 0, 0, time.UTC)
	py, pm, pd := paymentDate.Date()
	if time.Date(py, pm, pd, 0, 0, 0, 0, time.UTC).After(latest) {
		return errors.New("payment date is in the future — record a payment on the day the money arrives")
	}
	return nil
}

// paymentColumns is every column models.Payment scans, in one place so the
// four queries that read a payment cannot drift apart again.
const paymentColumns = `id, stay_id, amount, payment_type, kind, payment_date, proof_url, notes, is_approved, rejected_at, rejection_reason, created_at`

// qualified prefixes every column in a comma-separated list with a table
// alias, so a query that joins can return paymentColumns without ambiguity.
func qualified(alias, cols string) string {
	parts := strings.Split(cols, ", ")
	for i, c := range parts {
		parts[i] = alias + "." + c
	}
	return strings.Join(parts, ", ")
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
		`SELECT `+paymentColumns+`
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
	switch req.Kind {
	case "":
		req.Kind = string(models.PaymentKindRent)
	case string(models.PaymentKindRent), string(models.PaymentKindDeposit):
	default:
		return c.JSON(http.StatusBadRequest, errorResponse(`kind must be "rent" or "deposit"`))
	}

	paymentDate := time.Now().Truncate(24 * time.Hour)
	if req.PaymentDate != "" {
		paymentDate, err = time.Parse("2006-01-02", req.PaymentDate)
		if err != nil {
			return c.JSON(http.StatusBadRequest, errorResponse("invalid payment_date format, use YYYY-MM-DD"))
		}
	}
	if err := validatePaymentDate(paymentDate, time.Now()); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse(err.Error()))
	}

	var payment models.Payment
	err = h.db.QueryRowx(
		`INSERT INTO payments (stay_id, amount, payment_type, kind, payment_date, notes, is_approved, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, true, $7)
		 RETURNING `+paymentColumns,
		stayID, req.Amount, req.PaymentType, req.Kind, paymentDate, req.Notes, time.Now(),
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
		`SELECT p.id, p.stay_id, p.amount, p.payment_type, p.kind, p.payment_date,
		        p.proof_url, p.notes, p.is_approved, p.rejected_at, p.rejection_reason, p.created_at,
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
		 WHERE t.owner_id = $1 AND p.is_approved = false AND p.rejected_at IS NULL
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
		`UPDATE payments p SET is_approved = true, rejected_at = NULL, rejection_reason = NULL
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

// maxRejectionReason bounds the note a tenant reads on their ledger. It is a
// sentence ("Amount does not match the UPI screenshot"), not a letter.
const maxRejectionReason = 300

type rejectPaymentRequest struct {
	Reason string `json:"reason"`
}

// Reject marks a tenant's proof as not accepted, with an optional reason the
// tenant can read. It never deletes: the submission, the screenshot and the
// owner's answer all stay on both ledgers (UX audit M6).
//
// Only a proof still waiting can be rejected. An approved payment is money the
// owner has already counted, and quietly turning it into a rejection would
// change balances with nothing on the record to say why — that is a delete,
// and it has its own endpoint and its own confirm.
// POST /api/payments/:id/reject
func (h *PaymentHandler) Reject(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	paymentID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid payment id"))
	}

	var req rejectPaymentRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid request body"))
	}
	reason := strings.TrimSpace(req.Reason)
	if len([]rune(reason)) > maxRejectionReason {
		return c.JSON(http.StatusBadRequest, errorResponse(fmt.Sprintf("the reason must be %d characters or fewer", maxRejectionReason)))
	}
	var reasonArg *string
	if reason != "" {
		reasonArg = &reason
	}

	var payment models.Payment
	err = h.db.QueryRowx(
		`UPDATE payments p SET rejected_at = NOW(), rejection_reason = $3
		 FROM stays s, tenants t
		 WHERE p.id = $1 AND p.stay_id = s.id AND s.tenant_id = t.id AND t.owner_id = $2
		   AND p.is_approved = false AND p.rejected_at IS NULL
		 RETURNING `+qualified("p", paymentColumns),
		paymentID, ownerID, reasonArg,
	).StructScan(&payment)
	if errors.Is(err, sql.ErrNoRows) {
		// Either not this owner's, or no longer waiting. Tell them apart, so
		// a double tap reads as "already done" rather than "not found".
		var state struct {
			IsApproved bool       `db:"is_approved"`
			RejectedAt *time.Time `db:"rejected_at"`
		}
		lookupErr := h.db.Get(&state,
			`SELECT p.is_approved, p.rejected_at FROM payments p
			 JOIN stays s ON s.id = p.stay_id JOIN tenants t ON t.id = s.tenant_id
			 WHERE p.id = $1 AND t.owner_id = $2`, paymentID, ownerID)
		switch {
		case errors.Is(lookupErr, sql.ErrNoRows):
			return c.JSON(http.StatusNotFound, errorResponse("payment not found"))
		case lookupErr != nil:
			return serverError(c, lookupErr, "failed to reject payment")
		case state.IsApproved:
			return c.JSON(http.StatusConflict, errorResponse("this payment has already been approved"))
		default:
			return c.JSON(http.StatusConflict, errorResponse("this payment has already been rejected"))
		}
	}
	if err != nil {
		return serverError(c, err, "failed to reject payment")
	}
	return c.JSON(http.StatusOK, payment)
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
