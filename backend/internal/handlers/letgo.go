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

// Money the owner let go (migration 017): "they owe ₹10,000, we're letting
// ₹2,000 go". It is never a payment, so nothing that counts cash reads it.
// What someone owes counts it the way a rent payment would: it covers their
// oldest unpaid month first.
//
// A settlement is worked out from what was let go before it, like the
// payments before it. What is let go after a settlement comes off the
// leaver's shortfall instead (settledOwed).

// letGoBeforeSQL is the rent let go on stay s that its billing counts:
// everything while the stay has no settlement, and what came before the
// settlement when it has one.
const letGoBeforeSQL = `COALESCE((
	SELECT SUM(lg.amount) FROM rent_let_go lg
	WHERE lg.stay_id = s.id AND NOT EXISTS (
		SELECT 1 FROM settlements lst WHERE lst.stay_id = lg.stay_id AND lst.created_at < lg.created_at)
), 0)`

// letGoAfterSQL is what was let go off stay s's shortfall since its
// settlement st. Zero when st is NULL (no settlement, from a LEFT JOIN).
const letGoAfterSQL = `COALESCE((
	SELECT SUM(lg.amount) FROM rent_let_go lg
	WHERE lg.stay_id = s.id AND lg.created_at > st.created_at
), 0)`

// letGoCredit is how much of the rent let go counts against what was billed.
// It can bring what they owe down to zero, never below: if they later pay in
// full anyway, money let go must not turn into rent paid ahead, which a
// settlement would read as an advance and the due date as months covered.
func letGoCredit(billed, paid, letGo int64) int64 {
	gap := billed - paid
	if gap <= 0 || letGo <= 0 {
		return 0
	}
	if letGo > gap {
		return gap
	}
	return letGo
}

// LetGo is one entry, as the tenant page's ledger shows it.
type LetGo struct {
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

const letGoColumns = `lg.id, lg.stay_id, lg.amount, lg.for_month, lg.notes, lg.created_at,
	EXISTS (SELECT 1 FROM settlements lst WHERE lst.stay_id = lg.stay_id AND lst.created_at > lg.created_at) AS settled`

type LetGoHandler struct {
	db *sqlx.DB
}

func NewLetGoHandler(db *sqlx.DB) *LetGoHandler {
	return &LetGoHandler{db: db}
}

// forMonth is the month an amount let go comes off: for a settled stay, the
// month they left; otherwise the oldest month not yet covered by rent paid
// and rent already let go.
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
	covered := sched.paidThrough(start, s.RentCycle, s.TotalPaid+s.LetGo, cycles)
	return monthStart(cycleStart(start, covered+1, s.RentCycle))
}

// owns reports whether the stay belongs to the owner. A failed query is an
// error, never "not yours".
func (h *LetGoHandler) owns(stayID, ownerID int64) (bool, error) {
	var n int
	err := h.db.Get(&n,
		`SELECT COUNT(*) FROM stays s JOIN tenants t ON t.id = s.tenant_id WHERE s.id = $1 AND t.owner_id = $2`,
		stayID, ownerID)
	return n > 0, err
}

type letGoRequest struct {
	Amount int64  `json:"amount"` // paise
	Notes  string `json:"notes"`
}

// maxLetGoNote bounds the note: a few words ("Diwali", "agreed with his
// father"), not a letter.
const maxLetGoNote = 200

// Create lets some of what a stay owes go. It can't be more than they owe:
// letting go of money nobody owes would leave them in credit, which is a
// refund, not this.
// POST /api/stays/:id/let-go
func (h *LetGoHandler) Create(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	stayID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid stay id"))
	}
	var req letGoRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid request body"))
	}
	if req.Amount <= 0 {
		return c.JSON(http.StatusBadRequest, errorResponse("Type how much to let go, like 1000."))
	}
	notes := strings.TrimSpace(req.Notes)
	if len([]rune(notes)) > maxLetGoNote {
		return c.JSON(http.StatusBadRequest, errorResponse(fmt.Sprintf("Keep the note to %d characters.", maxLetGoNote)))
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
			"They owe %s on this stay, so that's the most you can let go.", rupees(owed))))
	}

	var notesArg *string
	if notes != "" {
		notesArg = &notes
	}
	var out LetGo
	err = h.db.QueryRowx(
		`INSERT INTO rent_let_go AS lg (stay_id, amount, for_month, notes)
		 VALUES ($1, $2, $3, $4)
		 RETURNING `+letGoColumns,
		stayID, req.Amount, forMonth(rows[0], today), notesArg,
	).StructScan(&out)
	if err != nil {
		return serverError(c, err, "failed to record money let go")
	}
	return c.JSON(http.StatusCreated, out)
}

// List is every amount let go on one stay, newest first.
// GET /api/stays/:id/let-go
func (h *LetGoHandler) List(c echo.Context) error {
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
	out := []LetGo{}
	if err := h.db.Select(&out,
		`SELECT `+letGoColumns+` FROM rent_let_go lg WHERE lg.stay_id = $1 ORDER BY lg.created_at DESC`,
		stayID); err != nil {
		return serverError(c, err, "failed to fetch money let go")
	}
	return c.JSON(http.StatusOK, out)
}

// Delete takes an amount back: they owe it again. One a settlement was
// worked out from waits until that settlement is undone.
// DELETE /api/let-go/:id
func (h *LetGoHandler) Delete(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid id"))
	}
	result, err := h.db.Exec(
		`DELETE FROM rent_let_go lg
		 USING stays s, tenants t
		 WHERE lg.id = $1 AND s.id = lg.stay_id AND t.id = s.tenant_id AND t.owner_id = $2
		   AND NOT EXISTS (SELECT 1 FROM settlements lst WHERE lst.stay_id = lg.stay_id AND lst.created_at > lg.created_at)`,
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
		`SELECT EXISTS (SELECT 1 FROM settlements lst WHERE lst.stay_id = lg.stay_id AND lst.created_at > lg.created_at)
		 FROM rent_let_go lg JOIN stays s ON s.id = lg.stay_id JOIN tenants t ON t.id = s.tenant_id
		 WHERE lg.id = $1 AND t.owner_id = $2`, id, ownerID)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return c.JSON(http.StatusNotFound, errorResponse("not found"))
	case err != nil:
		return serverError(c, err, "failed to take it back")
	}
	return c.JSON(http.StatusConflict, errorResponse("The settlement was worked out from this. Undo the settlement on the tenant's page to take it back."))
}

// loadLetGoByMonth is the rent let go per month in [from, to), keyed
// "2006-01" by the month it comes off. Insights and the dashboard take it off
// that month's expected rent.
func loadLetGoByMonth(db *sqlx.DB, ownerID int64, from, to time.Time) (map[string]int64, error) {
	var rows []struct {
		Month  string `db:"month"`
		Amount int64  `db:"amount"`
	}
	if err := db.Select(&rows,
		`SELECT TO_CHAR(lg.for_month, 'YYYY-MM') AS month, SUM(lg.amount) AS amount
		 FROM rent_let_go lg JOIN stays s ON s.id = lg.stay_id JOIN tenants t ON t.id = s.tenant_id
		 WHERE t.owner_id = $1 AND lg.for_month >= $2 AND lg.for_month < $3
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
