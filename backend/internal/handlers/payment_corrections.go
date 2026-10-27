package handlers

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	appMiddleware "github.com/winnow/hostel/internal/middleware"
	"github.com/winnow/hostel/internal/models"
)

// notSettledSQL is true when no settlement was saved after payment p was
// recorded. A settlement stores dues and a refund worked out from the
// payments it saw, so changing one of those afterwards would leave its
// figures quietly wrong. The owner undoes the settlement, corrects the
// payment, and settles again. A payment recorded after the settlement, such
// as a leaver paying what they still owed, stays correctable.
const notSettledSQL = `NOT EXISTS (
	SELECT 1 FROM settlements st WHERE st.stay_id = p.stay_id AND st.created_at > p.created_at)`

const settledMessage = "This payment is part of the settlement. Undo the settlement on the tenant's page to change it."

// whyNot explains why a correction matched no row: not this owner's, part of
// a settlement, or in a state the action doesn't apply to. A double tap reads
// as "already done" rather than "not found".
func (h *PaymentHandler) whyNot(c echo.Context, paymentID, ownerID int64, action string) error {
	var state struct {
		IsApproved bool       `db:"is_approved"`
		RejectedAt *time.Time `db:"rejected_at"`
		FromTenant bool       `db:"from_tenant"`
		Settled    bool       `db:"settled"`
	}
	err := h.db.Get(&state,
		`SELECT p.is_approved, p.rejected_at, p.from_tenant, NOT `+notSettledSQL+` AS settled
		 FROM payments p
		 JOIN stays s ON s.id = p.stay_id JOIN tenants t ON t.id = s.tenant_id
		 WHERE p.id = $1 AND t.owner_id = $2`, paymentID, ownerID)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return c.JSON(http.StatusNotFound, errorResponse("payment not found"))
	case err != nil:
		return serverError(c, err, "failed to "+action+" payment")
	}

	switch action {
	case "reject":
		switch {
		case state.RejectedAt != nil:
			return c.JSON(http.StatusConflict, errorResponse("this payment has already been rejected"))
		case state.IsApproved && !state.FromTenant:
			return c.JSON(http.StatusConflict, errorResponse("You recorded this payment yourself. Delete it instead."))
		}
	case "delete":
		if state.FromTenant && !state.Settled {
			return c.JSON(http.StatusConflict, errorResponse("The tenant sent this payment, so it is kept. Mark it not accepted instead."))
		}
	case "change":
		if !state.IsApproved && !state.Settled {
			return c.JSON(http.StatusConflict, errorResponse("Accept this payment before changing it."))
		}
	}
	if state.Settled {
		return c.JSON(http.StatusConflict, errorResponse(settledMessage))
	}
	return c.JSON(http.StatusConflict, errorResponse("this payment can't be changed"))
}

// Update corrects a payment the owner has counted: its amount, date, Cash or
// UPI, rent or deposit, and note. What it said before is kept in
// payment_edits, so the ledger can show "changed, was …".
// PUT /api/payments/:id
func (h *PaymentHandler) Update(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	paymentID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid payment id"))
	}

	var req createPaymentRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid request body"))
	}
	if req.Amount <= 0 {
		return c.JSON(http.StatusBadRequest, errorResponse("amount must be positive"))
	}
	if req.PaymentType != string(models.PaymentTypeCash) && req.PaymentType != string(models.PaymentTypeOnline) {
		return c.JSON(http.StatusBadRequest, errorResponse("Say whether it was cash or UPI."))
	}
	if req.Kind != string(models.PaymentKindRent) && req.Kind != string(models.PaymentKindDeposit) {
		return c.JSON(http.StatusBadRequest, errorResponse(`kind must be "rent" or "deposit"`))
	}
	paymentDate, err := time.Parse("2006-01-02", req.PaymentDate)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid payment_date format, use YYYY-MM-DD"))
	}
	if err := validatePaymentDate(paymentDate, time.Now()); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse(err.Error()))
	}
	notes := strings.TrimSpace(req.Notes)

	tx, err := h.db.Beginx()
	if err != nil {
		return serverError(c, err, "failed to change payment")
	}
	defer tx.Rollback()

	var before models.Payment
	err = tx.QueryRowx(
		`SELECT `+qualified("p", paymentColumns)+`
		 FROM payments p
		 JOIN stays s ON s.id = p.stay_id JOIN tenants t ON t.id = s.tenant_id
		 WHERE p.id = $1 AND t.owner_id = $2 AND p.is_approved AND `+notSettledSQL+`
		 FOR UPDATE OF p`,
		paymentID, ownerID,
	).StructScan(&before)
	if errors.Is(err, sql.ErrNoRows) {
		return h.whyNot(c, paymentID, ownerID, "change")
	}
	if err != nil {
		return serverError(c, err, "failed to change payment")
	}

	oldNotes := ""
	if before.Notes != nil {
		oldNotes = *before.Notes
	}
	unchanged := before.Amount == req.Amount &&
		string(before.PaymentType) == req.PaymentType &&
		string(before.Kind) == req.Kind &&
		before.PaymentDate.Format("2006-01-02") == paymentDate.Format("2006-01-02") &&
		oldNotes == notes

	after := before
	if !unchanged {
		if _, err := tx.Exec(
			`INSERT INTO payment_edits (payment_id, amount, payment_type, kind, payment_date, notes)
			 VALUES ($1, $2, $3, $4, $5, $6)`,
			paymentID, before.Amount, before.PaymentType, before.Kind, before.PaymentDate, before.Notes,
		); err != nil {
			return serverError(c, err, "failed to keep the payment's old figures")
		}
		if err := tx.QueryRowx(
			`UPDATE payments SET amount = $2, payment_type = $3, kind = $4, payment_date = $5, notes = $6
			 WHERE id = $1
			 RETURNING `+paymentColumns,
			paymentID, req.Amount, req.PaymentType, req.Kind, paymentDate, notes,
		).StructScan(&after); err != nil {
			return serverError(c, err, "failed to change payment")
		}
	}
	if err := tx.Commit(); err != nil {
		return serverError(c, err, "failed to change payment")
	}

	one := []models.Payment{after}
	if err := h.annotate(after.StayID, one); err != nil {
		return serverError(c, err, "failed to fetch payment changes")
	}
	if err := signPayment(c, h.storage, &one[0]); err != nil {
		return serverError(c, err, "failed to prepare payment proof")
	}
	return c.JSON(http.StatusOK, one[0])
}

// annotate fills in what the owner's ledger shows beside each payment of one
// stay: what it said before its latest change, and whether a settlement
// holds it.
func (h *PaymentHandler) annotate(stayID int64, payments []models.Payment) error {
	if len(payments) == 0 {
		return nil
	}
	var edits []models.PaymentEdit
	if err := h.db.Select(&edits,
		`SELECT DISTINCT ON (e.payment_id)
		        e.payment_id, e.amount, e.payment_type, e.kind, e.payment_date, e.notes, e.edited_at
		 FROM payment_edits e JOIN payments p ON p.id = e.payment_id
		 WHERE p.stay_id = $1
		 ORDER BY e.payment_id, e.edited_at DESC, e.id DESC`,
		stayID,
	); err != nil {
		return err
	}
	var settledAt *time.Time
	if err := h.db.Get(&settledAt, `SELECT MAX(created_at) FROM settlements WHERE stay_id = $1`, stayID); err != nil {
		return err
	}

	latest := make(map[int64]*models.PaymentEdit, len(edits))
	for i := range edits {
		latest[edits[i].PaymentID] = &edits[i]
	}
	for i := range payments {
		payments[i].LastEdit = latest[payments[i].ID]
		payments[i].Settled = settledAt != nil && payments[i].CreatedAt.Before(*settledAt)
	}
	return nil
}
