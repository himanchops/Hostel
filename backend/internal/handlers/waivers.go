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
)

// Rent the owner waived (migration 017): "they owe ₹10,000, we're letting
// ₹2,000 go", in the owner's words. It is never a payment, so nothing that counts cash reads it.
// What someone owes counts it the way a rent payment would: it covers their
// oldest unpaid month first.
//
// A settlement is worked out from what was waived before it, like the
// payments before it. What is waived after a settlement comes off the
// leaver's shortfall instead (settledOwed).

// waivedBeforeSQL is the rent waived on stay s that its billing counts:
// everything while the stay has no settlement, and what came before the
// settlement when it has one.
const waivedBeforeSQL = `COALESCE((
	SELECT SUM(wv.amount) FROM rent_waivers wv
	WHERE wv.stay_id = s.id AND NOT EXISTS (
		SELECT 1 FROM settlements lst WHERE lst.stay_id = wv.stay_id AND lst.created_at < wv.created_at)
), 0)`

// waivedAfterSQL is what was waived off stay s's shortfall since its
// settlement st. Zero when st is NULL (no settlement, from a LEFT JOIN).
const waivedAfterSQL = `COALESCE((
	SELECT SUM(wv.amount) FROM rent_waivers wv
	WHERE wv.stay_id = s.id AND wv.created_at > st.created_at
), 0)`

// waiverCredit is how much of the rent waived counts against what was billed.
// It can bring what they owe down to zero, never below: if they later pay in
// full anyway, money waived must not turn into rent paid ahead, which a
// settlement would read as an advance and the due date as months covered.
func waiverCredit(billed, paid, waiver int64) int64 {
	gap := billed - paid
	if gap <= 0 || waiver <= 0 {
		return 0
	}
	if waiver > gap {
		return gap
	}
	return waiver
}

// Waiver is one entry, as the tenant page's ledger shows it.
type Waiver struct {
	ID        int64     `db:"id" json:"id"`
	StayID    int64     `db:"stay_id" json:"stay_id"`
	Amount    int64     `db:"amount" json:"amount"`
	ForMonth  time.Time `db:"for_month" json:"for_month"`
	Notes     *string   `db:"notes" json:"notes,omitempty"`
	CreatedAt time.Time `db:"created_at" json:"created_at"`
	// Settled means a settlement was worked out from it, so it can't be
	// taken back until that settlement is undone.
	Settled bool `db:"settled" json:"settled"`
}

const waiverColumns = `wv.id, wv.stay_id, wv.amount, wv.for_month, wv.notes, wv.created_at,
	EXISTS (SELECT 1 FROM settlements lst WHERE lst.stay_id = wv.stay_id AND lst.created_at > wv.created_at) AS settled`

type WaiverHandler struct {
	db *sqlx.DB
}

func NewWaiverHandler(db *sqlx.DB) *WaiverHandler {
	return &WaiverHandler{db: db}
}

// forMonth is the month an amount waived comes off: for a settled stay, the
// month they left; otherwise the oldest month not yet covered by rent paid
// and rent already waived.
func forMonth(s staySummaryRow, today time.Time) time.Time {
	start := dateOnly(s.StartDate)
	if s.SettlementRefund != nil && s.EndDate != nil {
		return monthStart(dateOnly(*s.EndDate))
	}
	sched := s.Schedule
	if len(sched) == 0 {
		sched = flatSchedule(start, s.RentAmount)
	}
	cycles := cyclesElapsed(start, dateOnly(today), s.RentCycle)
	if s.EndDate != nil {
		cycles = endedCycles(start, dateOnly(*s.EndDate), s.RentCycle, s.Booking)
	}
	covered := sched.paidThrough(start, s.RentCycle, s.TotalPaid+s.Waived, cycles)
	return monthStart(cycleStart(start, covered+1, s.RentCycle))
}

// owns reports whether the stay belongs to the owner. A failed query is an
// error, never "not yours".
func (h *WaiverHandler) owns(stayID, ownerID int64) (bool, error) {
	var n int
	err := h.db.Get(&n,
		`SELECT COUNT(*) FROM stays s JOIN tenants t ON t.id = s.tenant_id WHERE s.id = $1 AND t.owner_id = $2`,
		stayID, ownerID)
	return n > 0, err
}

type waiverRequest struct {
	Amount int64  `json:"amount"` // paise
	Notes  string `json:"notes"`
}

// maxWaiverNote bounds the note: a few words ("Diwali", "agreed with his
// father"), not a letter.
const maxWaiverNote = 200

// Create waives some of what a stay owes. It can't be more than they owe:
// waiving money nobody owes would leave them in credit, which is a refund,
// not this.
// POST /api/stays/:id/waivers
func (h *WaiverHandler) Create(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	stayID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid stay id"))
	}
	var req waiverRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid request body"))
	}
	if req.Amount <= 0 {
		return c.JSON(http.StatusBadRequest, errorResponse("Type how much to waive, like 1000."))
	}
	notes := strings.TrimSpace(req.Notes)
	if len([]rune(notes)) > maxWaiverNote {
		return c.JSON(http.StatusBadRequest, errorResponse(fmt.Sprintf("Keep the note to %d characters.", maxWaiverNote)))
	}

	if owned, err := h.owns(stayID, ownerID); err != nil {
		return serverError(c, err, "failed to verify the stay")
	} else if !owned {
		return c.JSON(http.StatusNotFound, errorResponse("stay not found"))
	}
	rows, err := loadStaySummaryRows(h.db, "s.id = $1", stayID)
	if err != nil {
		return serverError(c, err, "failed to work out what is owed")
	}
	if len(rows) == 0 {
		return c.JSON(http.StatusNotFound, errorResponse("stay not found"))
	}
	today := dateOnly(time.Now())
	owed := computeTenantSummary(rows, today).Balance
	if owed <= 0 {
		return c.JSON(http.StatusConflict, errorResponse("They don't owe anything on this stay."))
	}
	if req.Amount > owed {
		return c.JSON(http.StatusBadRequest, errorResponse(fmt.Sprintf(
			"They owe %s on this stay, so that's the most you can waive.", rupees(owed))))
	}

	var notesArg *string
	if notes != "" {
		notesArg = &notes
	}
	var out Waiver
	err = h.db.QueryRowx(
		`INSERT INTO rent_waivers AS wv (stay_id, amount, for_month, notes)
		 VALUES ($1, $2, $3, $4)
		 RETURNING `+waiverColumns,
		stayID, req.Amount, forMonth(rows[0], today), notesArg,
	).StructScan(&out)
	if err != nil {
		return serverError(c, err, "failed to record the waiver")
	}
	return c.JSON(http.StatusCreated, out)
}

// List is every amount waived on one stay, newest first.
// GET /api/stays/:id/waivers
func (h *WaiverHandler) List(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	stayID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid stay id"))
	}
	if owned, err := h.owns(stayID, ownerID); err != nil {
		return serverError(c, err, "failed to verify the stay")
	} else if !owned {
		return c.JSON(http.StatusNotFound, errorResponse("stay not found"))
	}
	out := []Waiver{}
	if err := h.db.Select(&out,
		`SELECT `+waiverColumns+` FROM rent_waivers wv WHERE wv.stay_id = $1 ORDER BY wv.created_at DESC`,
		stayID); err != nil {
		return serverError(c, err, "failed to fetch waivers")
	}
	return c.JSON(http.StatusOK, out)
}

// Delete takes an amount back: they owe it again. One a settlement was
// worked out from waits until that settlement is undone.
// DELETE /api/waivers/:id
func (h *WaiverHandler) Delete(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid id"))
	}
	result, err := h.db.Exec(
		`DELETE FROM rent_waivers wv
		 USING stays s, tenants t
		 WHERE wv.id = $1 AND s.id = wv.stay_id AND t.id = s.tenant_id AND t.owner_id = $2
		   AND NOT EXISTS (SELECT 1 FROM settlements lst WHERE lst.stay_id = wv.stay_id AND lst.created_at > wv.created_at)`,
		id, ownerID,
	)
	if err != nil {
		return serverError(c, err, "failed to take it back")
	}
	if rows, _ := result.RowsAffected(); rows > 0 {
		return c.NoContent(http.StatusNoContent)
	}
	var settled bool
	err = h.db.Get(&settled,
		`SELECT EXISTS (SELECT 1 FROM settlements lst WHERE lst.stay_id = wv.stay_id AND lst.created_at > wv.created_at)
		 FROM rent_waivers wv JOIN stays s ON s.id = wv.stay_id JOIN tenants t ON t.id = s.tenant_id
		 WHERE wv.id = $1 AND t.owner_id = $2`, id, ownerID)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return c.JSON(http.StatusNotFound, errorResponse("not found"))
	case err != nil:
		return serverError(c, err, "failed to take it back")
	}
	return c.JSON(http.StatusConflict, errorResponse("The settlement was worked out from this. Undo the settlement on the tenant's page to take it back."))
}

// loadWaivedByMonth is the rent waived per month in [from, to), keyed
// "2006-01" by the month it comes off. Insights and the dashboard take it off
// that month's expected rent.
func loadWaivedByMonth(db *sqlx.DB, ownerID int64, from, to time.Time) (map[string]int64, error) {
	var rows []struct {
		Month  string `db:"month"`
		Amount int64  `db:"amount"`
	}
	if err := db.Select(&rows,
		`SELECT TO_CHAR(wv.for_month, 'YYYY-MM') AS month, SUM(wv.amount) AS amount
		 FROM rent_waivers wv JOIN stays s ON s.id = wv.stay_id JOIN tenants t ON t.id = s.tenant_id
		 WHERE t.owner_id = $1 AND wv.for_month >= $2 AND wv.for_month < $3
		 GROUP BY 1`,
		ownerID, from, to); err != nil {
		return nil, err
	}
	out := make(map[string]int64, len(rows))
	for _, r := range rows {
		out[r.Month] = r.Amount
	}
	return out, nil
}

// rupees is "₹1,23,456", the Indian grouping the screens use, for a message.
func rupees(paise int64) string {
	n := paise / 100
	s := strconv.FormatInt(n, 10)
	if len(s) <= 3 {
		return "₹" + s
	}
	head, tail := s[:len(s)-3], s[len(s)-3:]
	var groups []string
	for len(head) > 2 {
		groups = append([]string{head[len(head)-2:]}, groups...)
		head = head[:len(head)-2]
	}
	if head != "" {
		groups = append([]string{head}, groups...)
	}
	return "₹" + strings.Join(groups, ",") + "," + tail
}
