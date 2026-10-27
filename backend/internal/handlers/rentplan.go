package handlers

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/labstack/echo/v4"

	appMiddleware "github.com/winnow/hostel/internal/middleware"
	"github.com/winnow/hostel/internal/models"
)

// A rent change, asked the way the owner says it (26 Oct 2026): "from next
// month rent is X, and this month they pay the old rent / the new rent / an
// amount we agreed". It replaced "the new rent starts from <date>", which made
// the owner work out the consequence herself.
//
// The three answers are all rent steps on the schedule (migration 011):
//   - old:    a step at the next cycle
//   - new:    a step at this cycle
//   - agreed: a step at this cycle for the agreed amount, then the next cycle
//
// "This month" is the cycle the reference day falls in: the move day for a
// move, today for Change rent. Billing never splits a cycle.

type rentPlanRequest struct {
	NextRent  int64  `json:"next_rent"`  // paise, from the next cycle on
	ThisCycle string `json:"this_cycle"` // "old", "new" or "agreed"
	Agreed    int64  `json:"agreed"`     // paise, with "agreed"
}

func (r rentPlanRequest) validate() string {
	if r.NextRent <= 0 {
		return "Enter the new rent."
	}
	switch r.ThisCycle {
	case "old", "new":
	case "agreed":
		if r.Agreed <= 0 {
			return "Enter the amount you agreed for this month."
		}
	default:
		return "Pick what they pay this month."
	}
	return ""
}

// planRent is the schedule after a rent change made on day `ref`. Every cycle
// before this one keeps its rent. Steps already scheduled after the next cycle
// are dropped: "from next month, rent is X" is the owner's word on the rent
// from then on. A step that repeats the rent before it is merged away, so
// "new" leaves one step, not two.
func planRent(old rentSchedule, start time.Time, cycle string, ref time.Time, req rentPlanRequest) rentSchedule {
	start = dateOnly(start)
	n := cyclesElapsed(start, dateOnly(ref), cycle)
	thisStart := cycleStart(start, n, cycle)
	nextStart := cycleStart(start, n+1, cycle)
	thisRent := old.at(thisStart)

	var out rentSchedule
	for _, step := range old {
		if step.From.Before(thisStart) {
			out = append(out, step)
		}
	}
	switch req.ThisCycle {
	case "new":
		thisRent = req.NextRent
	case "agreed":
		thisRent = req.Agreed
	}
	out = append(out, rentStep{From: thisStart, Rent: thisRent}, rentStep{From: nextStart, Rent: req.NextRent})
	return mergeSteps(out)
}

// mergeSteps drops every step whose rent equals the one before it.
func mergeSteps(s rentSchedule) rentSchedule {
	var out rentSchedule
	for _, step := range s {
		if len(out) > 0 && out[len(out)-1].Rent == step.Rent {
			continue
		}
		out = append(out, step)
	}
	return out
}

// writeSchedule replaces a stay's rent schedule. One step is a flat rent: no
// rows, just stays.rent_amount, exactly like a stay whose rent never changed.
// stays.rent_amount always ends as the latest step.
func writeSchedule(tx *sqlx.Tx, stayID int64, s rentSchedule) error {
	if len(s) == 0 {
		return errors.New("empty rent schedule")
	}
	if _, err := tx.Exec(`DELETE FROM stay_rent_changes WHERE stay_id = $1`, stayID); err != nil {
		return err
	}
	if len(s) > 1 {
		for _, step := range s {
			if _, err := tx.Exec(
				`INSERT INTO stay_rent_changes (stay_id, effective_date, rent_amount) VALUES ($1, $2, $3)`,
				stayID, step.From, step.Rent,
			); err != nil {
				return err
			}
		}
	}
	_, err := tx.Exec(`UPDATE stays SET rent_amount = $1, updated_at = NOW() WHERE id = $2`, s[len(s)-1].Rent, stayID)
	return err
}

// RentPreview is what a rent change will mean, for the dialog's one-line
// summary. The arithmetic is the server's so it can never disagree with the
// tenant's page afterwards.
type RentPreview struct {
	ThisStart string `json:"this_start"`
	ThisEnd   string `json:"this_end"` // the cycle's last day
	NextStart string `json:"next_start"`
	ThisRent  int64  `json:"this_rent"`
	NextRent  int64  `json:"next_rent"`
	// PaidThis is how much of this cycle's rent is already paid, after every
	// earlier cycle has had its share.
	PaidThis int64 `json:"paid_this"`
	// Balance is everything billed so far less everything paid: positive is
	// owed now, negative is paid ahead.
	Balance int64 `json:"balance"`
}

func previewRent(s rentSchedule, start time.Time, cycle string, ref, today time.Time, paid int64) RentPreview {
	start = dateOnly(start)
	n := cyclesElapsed(start, dateOnly(ref), cycle)
	thisStart := cycleStart(start, n, cycle)
	nextStart := cycleStart(start, n+1, cycle)
	thisRent := s.at(thisStart)

	paidThis := paid - s.billed(start, cycle, 0, n-1)
	if paidThis < 0 {
		paidThis = 0
	}
	if paidThis > thisRent {
		paidThis = thisRent
	}
	// Billed through today, or through this cycle if the reference day is
	// later (a move recorded a day ahead of the server's clock).
	billedTo := cyclesElapsed(start, dateOnly(today), cycle)
	if billedTo < n {
		billedTo = n
	}
	return RentPreview{
		ThisStart: thisStart.Format("2006-01-02"),
		ThisEnd:   nextStart.AddDate(0, 0, -1).Format("2006-01-02"),
		NextStart: nextStart.Format("2006-01-02"),
		ThisRent:  thisRent,
		NextRent:  s.at(nextStart),
		PaidThis:  paidThis,
		Balance:   s.billed(start, cycle, 0, billedTo) - paid,
	}
}

// loadRentState is what planning and previewing a stay's rent need, inside
// the caller's transaction: the stay (locked), its schedule, and the rent
// paid. A settled or ended stay is refused.
func loadRentState(tx *sqlx.Tx, stayID, ownerID int64) (models.Stay, rentSchedule, int64, int, string, error) {
	var stay struct {
		models.Stay
		Settled bool `db:"settled"`
	}
	err := tx.QueryRowx(
		`SELECT `+stayColsQualified+`, EXISTS(SELECT 1 FROM settlements st WHERE st.stay_id = s.id) AS settled
		 FROM stays s JOIN tenants t ON t.id = s.tenant_id
		 WHERE s.id = $1 AND t.owner_id = $2
		 FOR UPDATE OF s`,
		stayID, ownerID,
	).StructScan(&stay)
	if errors.Is(err, sql.ErrNoRows) {
		return models.Stay{}, nil, 0, http.StatusNotFound, "stay not found", nil
	}
	if err != nil {
		return models.Stay{}, nil, 0, 0, "", err
	}
	if stay.EndDate != nil || stay.Settled {
		return models.Stay{}, nil, 0, http.StatusConflict, "This stay has ended, so its rent can no longer change.", nil
	}
	schedules, err := rentSchedulesTx(tx, []int64{stayID})
	if err != nil {
		return models.Stay{}, nil, 0, 0, "", err
	}
	sched := scheduleFor(schedules, stayID, stay.StartDate, stay.RentAmount)
	var paid int64
	if err := tx.Get(&paid,
		`SELECT COALESCE(SUM(amount), 0) FROM payments
		 WHERE stay_id = $1 AND kind = 'rent' AND is_approved = true`,
		stayID,
	); err != nil {
		return models.Stay{}, nil, 0, 0, "", err
	}
	// Rent waived counts as covered here too (waivers.go), so "this month
	// they pay" agrees with what the tenant page says they owe.
	var waiver int64
	if err := tx.Get(&waiver, `SELECT COALESCE(SUM(amount), 0) FROM rent_waivers WHERE stay_id = $1`, stayID); err != nil {
		return models.Stay{}, nil, 0, 0, "", err
	}
	cycle := string(stay.RentCycle)
	billed := sched.billed(stay.StartDate, cycle, 0, cyclesElapsed(dateOnly(stay.StartDate), dateOnly(time.Now()), cycle))
	paid += waiverCredit(billed, paid, waiver)
	return stay.Stay, sched, paid, 0, "", nil
}

type rentPreviewRequest struct {
	rentPlanRequest
	// RefDate is the day the change is made: the move day, or empty for today.
	RefDate string `json:"ref_date"`
}

// PreviewRent says what a rent change would mean, changing nothing. With no
// next_rent it previews the rent as it stands.
//
// POST /api/stays/:id/rent-preview
func (h *StayHandler) PreviewRent(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	stayID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid stay id"))
	}
	var req rentPreviewRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid request body"))
	}
	today := dateOnly(time.Now())
	ref := today
	if req.RefDate != "" {
		if ref, err = time.Parse("2006-01-02", req.RefDate); err != nil {
			return c.JSON(http.StatusBadRequest, errorResponse("invalid ref_date"))
		}
	}

	tx, err := h.db.Beginx()
	if err != nil {
		return serverError(c, err, "failed to preview rent")
	}
	defer tx.Rollback()
	stay, sched, paid, status, msg, err := loadRentState(tx, stayID, ownerID)
	if err != nil {
		return serverError(c, err, "failed to preview rent")
	}
	if status != 0 {
		return c.JSON(status, errorResponse(msg))
	}
	if dateOnly(ref).Before(dateOnly(stay.StartDate)) {
		return c.JSON(http.StatusBadRequest, errorResponse("That's before they moved in."))
	}
	cycle := string(stay.RentCycle)
	if req.NextRent > 0 {
		if msg := req.validate(); msg != "" {
			return c.JSON(http.StatusBadRequest, errorResponse(msg))
		}
		sched = planRent(sched, stay.StartDate, cycle, ref, req.rentPlanRequest)
	}
	return c.JSON(http.StatusOK, previewRent(sched, stay.StartDate, cycle, ref, today, paid))
}

// SetRent changes rent the way the owner says it, from today.
//
// POST /api/stays/:id/rent
func (h *StayHandler) SetRent(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	stayID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid stay id"))
	}
	var req rentPlanRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid request body"))
	}
	if msg := req.validate(); msg != "" {
		return c.JSON(http.StatusBadRequest, errorResponse(msg))
	}

	tx, err := h.db.Beginx()
	if err != nil {
		return serverError(c, err, "failed to change rent")
	}
	defer tx.Rollback()
	stay, sched, _, status, msg, err := loadRentState(tx, stayID, ownerID)
	if err != nil {
		return serverError(c, err, "failed to change rent")
	}
	if status != 0 {
		return c.JSON(status, errorResponse(msg))
	}
	planned := planRent(sched, stay.StartDate, string(stay.RentCycle), time.Now(), req)
	if err := writeSchedule(tx, stayID, planned); err != nil {
		return serverError(c, err, "failed to change rent")
	}
	var updated models.Stay
	if err := tx.QueryRowx(`SELECT `+stayCols+` FROM stays WHERE id = $1`, stayID).StructScan(&updated); err != nil {
		return serverError(c, err, "failed to change rent")
	}
	changes, err := loadRentChanges(tx, []int64{stayID})
	if err != nil {
		return serverError(c, err, "failed to change rent")
	}
	if err := tx.Commit(); err != nil {
		return serverError(c, err, "failed to change rent")
	}
	updated.RentChanges = changes[stayID]
	return c.JSON(http.StatusOK, updated)
}
