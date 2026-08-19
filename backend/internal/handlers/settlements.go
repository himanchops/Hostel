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

type SettlementHandler struct {
	db *sqlx.DB
}

func NewSettlementHandler(db *sqlx.DB) *SettlementHandler {
	return &SettlementHandler{db: db}
}

// An owner adding more than this many lines to one settlement is a sign
// something has gone wrong (a runaway loop in the UI, a pasted payload), not a
// genuinely complicated move-out.
const maxAdjustments = 30
const maxAdjustmentLabel = 120

// settlementStayRow is everything the settlement math needs about a stay.
type settlementStayRow struct {
	StayID        int64      `db:"stay_id"`
	TenantID      int64      `db:"tenant_id"`
	TenantName    string     `db:"tenant_name"`
	RentAmount    int64      `db:"rent_amount"`
	DepositAmount int64      `db:"deposit_amount"`
	RentCycle     string     `db:"rent_cycle"`
	StartDate     time.Time  `db:"start_date"`
	EndDate       *time.Time `db:"end_date"`
	TotalPaid     int64      `db:"total_paid"`
}

// SettlementPreview is the calculator's opening position: what the owner owes
// the tenant before anyone types an adjustment.
//
// The workings (cycles billed, expected, paid) travel with the answer on
// purpose. The one number the owner will argue with is dues — this is the
// screen where they find out the tenant is being billed for a cycle they
// thought had been waived, and "₹7,500 outstanding" alone gives them nothing
// to check it against.
type SettlementPreview struct {
	StayID        int64  `json:"stay_id"`
	TenantName    string `json:"tenant_name"`
	DepositPaise  int64  `json:"deposit_paise"`
	DuesPaise     int64  `json:"dues_paise"`    // signed: negative = tenant paid ahead
	AdvancePaise  int64  `json:"advance_paise"` // rent paid beyond what was billed; 0 if they owe
	RefundPaise   int64  `json:"refund_paise"`  // the opening position, before adjustments
	EndDate       string `json:"end_date"`      // the date dues are billed up to
	AlreadyEnded  bool   `json:"already_ended"` // end_date came from the stay, not the request
	RentAmount    int64  `json:"rent_amount"`
	RentCycle     string `json:"rent_cycle"`
	StartDate     string `json:"start_date"`
	CyclesBilled  int    `json:"cycles_billed"`
	TotalExpected int64  `json:"total_expected"`
	TotalPaid     int64  `json:"total_paid"`
}

type createSettlementRequest struct {
	Adjustments []models.Adjustment `json:"adjustments"`
	Notes       string              `json:"notes"`
	RefundPaise int64               `json:"refund_paise"`
	EndDate     string              `json:"end_date"` // YYYY-MM-DD; ignored if the stay already ended
	// How much of a rent advance to hand back. Absent means all of it, which
	// keeps the generous reading as the default: it is the tenant's money
	// until the owner decides otherwise. Send 0 explicitly to keep it.
	AdvanceReturnedPaise *int64 `json:"advance_returned_paise"`
}

// duesFor returns rent outstanding at `until`, and the cycle count behind it.
//
// Signed deliberately: a tenant who paid three months up front and leaves after
// two is owed that month back, and clamping the number at zero would quietly
// pocket it. The refund line adds it back.
func duesFor(rent int64, cycle string, start, until time.Time, totalPaid int64) (dues int64, cycles int) {
	cycles = cyclesElapsed(dateOnly(start), dateOnly(until), cycle)
	return rent*int64(cycles) - totalPaid, cycles
}

// advanceHeld is how much rent the tenant has paid beyond what was billed.
// Zero when they owe money rather than the other way round.
func advanceHeld(dues int64) int64 {
	if dues < 0 {
		return -dues
	}
	return 0
}

// refundFor is the whole calculator: deposit back, outstanding rent withheld,
// whatever share of a rent advance the owner decided to return, adjustments
// applied. Negative means the tenant owes the owner.
//
// The advance is a separate term rather than falling out of a signed `dues`.
// Subtracting a negative would hand the whole advance back automatically, which
// silently makes a policy decision — return all of it, some, or none is the
// owner's call at the counter, and this app should not be quietly taking it.
// Callers pass 0 for advanceReturned whenever dues is positive; validated in
// validateAdvanceReturned rather than assumed here.
func refundFor(deposit, dues, advanceReturned int64, adjustments []models.Adjustment) int64 {
	refund := deposit + advanceReturned
	if dues > 0 {
		refund -= dues
	}
	for _, a := range adjustments {
		refund += a.AmountPaise
	}
	return refund
}

// validateAdvanceReturned keeps the decision inside what actually exists: an
// owner cannot return more advance than was paid, cannot return a negative
// amount, and cannot return an advance at all when the tenant owes rent.
func validateAdvanceReturned(dues, advanceReturned int64) error {
	held := advanceHeld(dues)
	if advanceReturned < 0 {
		return errors.New("advance_returned_paise cannot be negative")
	}
	if advanceReturned > held {
		if held == 0 {
			return errors.New("this tenant has no rent paid in advance to return")
		}
		return fmt.Errorf("cannot return more advance than was paid: %d paise held", held)
	}
	return nil
}

// validateAdjustments rejects rows that would make the stored settlement
// unreadable later. A zero amount is allowed — "Cleaning charge — waived" is a
// line an owner may well want on the record.
func validateAdjustments(adjustments []models.Adjustment) error {
	if len(adjustments) > maxAdjustments {
		return fmt.Errorf("a settlement cannot have more than %d adjustments", maxAdjustments)
	}
	for _, a := range adjustments {
		if strings.TrimSpace(a.Label) == "" {
			return errors.New("every adjustment needs a label saying what it is for")
		}
		if len([]rune(a.Label)) > maxAdjustmentLabel {
			return fmt.Errorf("adjustment labels must be %d characters or fewer", maxAdjustmentLabel)
		}
	}
	return nil
}

// loadSettlementStay fetches one stay scoped to the owner. Payment totals come
// from a correlated subquery, not a JOIN — joining to payments returns one row
// per payment and multiplies the per-stay figures (see docs/PROGRESS.md).
func (h *SettlementHandler) loadSettlementStay(stayID, ownerID int64) (settlementStayRow, error) {
	var row settlementStayRow
	err := h.db.Get(&row, `
		SELECT
			s.id             AS stay_id,
			s.tenant_id,
			t.name           AS tenant_name,
			s.rent_amount,
			s.deposit_amount,
			s.rent_cycle,
			s.start_date,
			s.end_date,
			COALESCE((
				SELECT SUM(p.amount) FROM payments p
				WHERE p.stay_id = s.id AND p.is_approved = true
			), 0) AS total_paid
		FROM stays s
		JOIN tenants t ON t.id = s.tenant_id
		WHERE s.id = $1 AND t.owner_id = $2`,
		stayID, ownerID,
	)
	return row, err
}

// settlementDate decides which date rent is billed up to.
//
// A stay that already ended has the answer written on it, and the settlement
// must agree with the stay rather than quietly bill a different period — so a
// request that disagrees is refused rather than ignored. Only an open stay
// takes the date from the request.
func settlementDate(stay settlementStayRow, requested string, today time.Time) (time.Time, error) {
	if stay.EndDate != nil {
		end := dateOnly(*stay.EndDate)
		if requested != "" {
			asked, err := time.Parse("2006-01-02", requested)
			if err != nil {
				return time.Time{}, errors.New("invalid end_date format, use YYYY-MM-DD")
			}
			if !dateOnly(asked).Equal(end) {
				return time.Time{}, fmt.Errorf(
					"this stay already ended on %s — change the stay's end date first, then settle",
					end.Format("2006-01-02"))
			}
		}
		return end, nil
	}

	if requested == "" {
		return today, nil
	}
	asked, err := time.Parse("2006-01-02", requested)
	if err != nil {
		return time.Time{}, errors.New("invalid end_date format, use YYYY-MM-DD")
	}
	asked = dateOnly(asked)
	if asked.Before(dateOnly(stay.StartDate)) {
		return time.Time{}, errors.New("end_date cannot be before the stay's start date")
	}
	return asked, nil
}

func (h *SettlementHandler) previewFor(stay settlementStayRow, endDate time.Time) SettlementPreview {
	dues, cycles := duesFor(stay.RentAmount, stay.RentCycle, stay.StartDate, endDate, stay.TotalPaid)
	advance := advanceHeld(dues)
	return SettlementPreview{
		StayID:       stay.StayID,
		TenantName:   stay.TenantName,
		DepositPaise: stay.DepositAmount,
		DuesPaise:    dues,
		AdvancePaise: advance,
		// The opening position returns the advance in full — the same figure
		// this endpoint gave before the choice existed, and the safer default
		// to show an owner who never touches the control.
		RefundPaise:   refundFor(stay.DepositAmount, dues, advance, nil),
		EndDate:       endDate.Format("2006-01-02"),
		AlreadyEnded:  stay.EndDate != nil,
		RentAmount:    stay.RentAmount,
		RentCycle:     stay.RentCycle,
		StartDate:     dateOnly(stay.StartDate).Format("2006-01-02"),
		CyclesBilled:  cycles,
		TotalExpected: stay.RentAmount * int64(cycles),
		TotalPaid:     stay.TotalPaid,
	}
}

// Preview computes the settlement for a stay without recording anything.
// GET /api/stays/:id/settlement-preview?end_date=YYYY-MM-DD
func (h *SettlementHandler) Preview(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	stayID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid stay id"))
	}

	stay, err := h.loadSettlementStay(stayID, ownerID)
	if err != nil {
		return c.JSON(http.StatusNotFound, errorResponse("stay not found"))
	}

	endDate, err := settlementDate(stay, c.QueryParam("end_date"), dateOnly(time.Now()))
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse(err.Error()))
	}

	return c.JSON(http.StatusOK, h.previewFor(stay, endDate))
}

// Create records a settlement and ends the stay in one transaction.
// POST /api/stays/:id/settlement
func (h *SettlementHandler) Create(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	stayID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid stay id"))
	}

	var req createSettlementRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid request body"))
	}
	if err := validateAdjustments(req.Adjustments); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse(err.Error()))
	}

	stay, err := h.loadSettlementStay(stayID, ownerID)
	if err != nil {
		return c.JSON(http.StatusNotFound, errorResponse("stay not found"))
	}

	var existing int
	if err := h.db.Get(&existing, `SELECT COUNT(*) FROM settlements WHERE stay_id = $1`, stayID); err != nil {
		return serverError(c, err, "failed to check for an existing settlement")
	}
	if existing > 0 {
		return c.JSON(http.StatusConflict, errorResponse("this stay has already been settled"))
	}

	endDate, err := settlementDate(stay, req.EndDate, dateOnly(time.Now()))
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse(err.Error()))
	}

	dues, _ := duesFor(stay.RentAmount, stay.RentCycle, stay.StartDate, endDate, stay.TotalPaid)

	// Omitting the field returns the whole advance, so a client written before
	// the choice existed keeps behaving the way it always did.
	advanceReturned := advanceHeld(dues)
	if req.AdvanceReturnedPaise != nil {
		advanceReturned = *req.AdvanceReturnedPaise
	}
	if err := validateAdvanceReturned(dues, advanceReturned); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse(err.Error()))
	}

	// The client's arithmetic is checked, never trusted. The realistic failure
	// is not a malicious payload but a stale drawer: a payment recorded in
	// another tab between opening the calculator and confirming it moves dues,
	// and the owner would otherwise hand over a refund computed from numbers
	// that are no longer true.
	refund := refundFor(stay.DepositAmount, dues, advanceReturned, req.Adjustments)
	if refund != req.RefundPaise {
		return c.JSON(http.StatusBadRequest, errorResponse(fmt.Sprintf(
			"refund does not match: you sent %d paise, the figures give %d. Reopen the settlement to pick up the latest payments.",
			req.RefundPaise, refund)))
	}

	adjustments := models.Adjustments(req.Adjustments)
	if adjustments == nil {
		adjustments = models.Adjustments{}
	}
	var notes *string
	if trimmed := strings.TrimSpace(req.Notes); trimmed != "" {
		notes = &trimmed
	}

	// One transaction: a settlement that records a refund without ending the
	// stay would leave the bed occupied by someone who has been paid out.
	tx, err := h.db.Beginx()
	if err != nil {
		return serverError(c, err, "failed to settle stay")
	}
	defer tx.Rollback()

	var settlement models.Settlement
	err = tx.QueryRowx(
		`INSERT INTO settlements (stay_id, deposit_paise, dues_paise, advance_returned_paise, adjustments, refund_paise, notes)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 RETURNING id, stay_id, deposit_paise, dues_paise, advance_returned_paise, adjustments, refund_paise, notes, created_at`,
		stayID, stay.DepositAmount, dues, advanceReturned, adjustments, refund, notes,
	).StructScan(&settlement)
	if err != nil {
		return serverError(c, err, "failed to record the settlement")
	}

	if stay.EndDate == nil {
		if _, err := tx.Exec(
			`UPDATE stays SET end_date = $1, updated_at = NOW() WHERE id = $2`,
			endDate, stayID,
		); err != nil {
			return serverError(c, err, "failed to end the stay")
		}
	}

	if err := tx.Commit(); err != nil {
		return serverError(c, err, "failed to settle stay")
	}
	return c.JSON(http.StatusCreated, settlement)
}

// ListByTenant returns every settlement across a tenant's stays, keyed by stay
// on the client.
//
// One request rather than one per stay: the tenant page needs to badge each
// ended stay as settled, and a tenant with a five-stay history would otherwise
// fire five requests to render a badge.
// GET /api/tenants/:id/settlements
func (h *SettlementHandler) ListByTenant(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	tenantID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid tenant id"))
	}

	var count int
	if err := h.db.Get(&count, `SELECT COUNT(*) FROM tenants WHERE id = $1 AND owner_id = $2`, tenantID, ownerID); err != nil {
		return serverError(c, err, "failed to fetch settlements")
	}
	if count == 0 {
		return c.JSON(http.StatusNotFound, errorResponse("tenant not found"))
	}

	var settlements []models.Settlement
	err = h.db.Select(&settlements, `
		SELECT st.id, st.stay_id, st.deposit_paise, st.dues_paise, st.advance_returned_paise,
		       st.adjustments, st.refund_paise, st.notes, st.created_at
		FROM settlements st
		JOIN stays s ON s.id = st.stay_id
		WHERE s.tenant_id = $1
		ORDER BY st.created_at DESC`,
		tenantID,
	)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return serverError(c, err, "failed to fetch settlements")
	}
	if settlements == nil {
		settlements = []models.Settlement{}
	}
	return c.JSON(http.StatusOK, settlements)
}
