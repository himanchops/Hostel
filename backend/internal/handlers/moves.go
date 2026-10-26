package handlers

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/labstack/echo/v4"
	"github.com/lib/pq"

	appMiddleware "github.com/winnow/hostel/internal/middleware"
	"github.com/winnow/hostel/internal/models"
)

// Moving a tenant to another bed partway through a stay (migration 014).
//
// The stay carries on, so the deposit, payments, balance and rent day are
// untouched. Only stays.bed_id changes, and a stay_moves row records the move
// so history (the tenant's page, Insights' "By room") knows where they slept
// on a given night.
//
// A move can also change the rent, asked the same way as Change rent
// (rentplan.go), with the move day as "this month".
//
// A second move on the same day corrects the first rather than adding a line:
// it is almost always "wrong bed, try again" (owner, 26 Oct 2026). Moving back
// to where they started that day removes the move altogether.

type moveRequest struct {
	BedID   int64  `json:"bed_id"`
	MovedOn string `json:"moved_on"` // YYYY-MM-DD
	// Rent is the new rent, or nil to keep the rent as it is.
	Rent *rentPlanRequest `json:"rent"`
}

// Move puts an active stay in another bed.
//
// POST /api/stays/:id/move
func (h *StayHandler) Move(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	stayID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid stay id"))
	}
	var req moveRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid request body"))
	}
	if req.BedID == 0 {
		return c.JSON(http.StatusBadRequest, errorResponse("Pick the bed they're moving to."))
	}
	movedOn, err := time.Parse("2006-01-02", req.MovedOn)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("Pick the day they moved."))
	}
	if req.Rent != nil {
		if msg := req.Rent.validate(); msg != "" {
			return c.JSON(http.StatusBadRequest, errorResponse(msg))
		}
	}
	// The same day-ahead allowance as a payment date, for an owner in India
	// ahead of the server's UTC clock.
	y, m, d := time.Now().UTC().Date()
	if dateOnly(movedOn).After(time.Date(y, m, d+1, 0, 0, 0, 0, time.UTC)) {
		return c.JSON(http.StatusBadRequest, errorResponse("A move can't be in the future. Record it on the day they move."))
	}

	tx, err := h.db.Beginx()
	if err != nil {
		return serverError(c, err, "failed to move stay")
	}
	defer tx.Rollback()

	var stay struct {
		models.Stay
		Settled bool `db:"settled"`
	}
	err = tx.QueryRowx(
		`SELECT `+stayColsQualified+`, EXISTS(SELECT 1 FROM settlements st WHERE st.stay_id = s.id) AS settled
		 FROM stays s JOIN tenants t ON t.id = s.tenant_id
		 WHERE s.id = $1 AND t.owner_id = $2
		 FOR UPDATE OF s`,
		stayID, ownerID,
	).StructScan(&stay)
	if errors.Is(err, sql.ErrNoRows) {
		return c.JSON(http.StatusNotFound, errorResponse("stay not found"))
	}
	if err != nil {
		return serverError(c, err, "failed to move stay")
	}
	if stay.EndDate != nil || stay.Settled {
		return c.JSON(http.StatusConflict, errorResponse("This stay has ended. Start a new stay instead."))
	}
	if stay.BedID == nil {
		return c.JSON(http.StatusConflict, errorResponse("They don't have a bed yet. Assign one instead."))
	}
	if *stay.BedID == req.BedID {
		return c.JSON(http.StatusBadRequest, errorResponse("They're already in that bed."))
	}
	if dateOnly(movedOn).Before(dateOnly(stay.StartDate)) {
		return c.JSON(http.StatusBadRequest, errorResponse(
			"They moved in on "+stay.StartDate.Format("2 Jan 2006")+". Pick that day or later."))
	}
	var last struct {
		ID        int64     `db:"id"`
		MovedOn   time.Time `db:"moved_on"`
		FromBedID *int64    `db:"from_bed_id"`
	}
	hasLast := true
	err = tx.Get(&last,
		`SELECT id, moved_on, from_bed_id FROM stay_moves WHERE stay_id = $1
		 ORDER BY moved_on DESC, id DESC LIMIT 1`, stayID)
	if errors.Is(err, sql.ErrNoRows) {
		hasLast = false
	} else if err != nil {
		return serverError(c, err, "failed to move stay")
	}
	if hasLast && dateOnly(movedOn).Before(dateOnly(last.MovedOn)) {
		return c.JSON(http.StatusBadRequest, errorResponse(
			"Their last move was on "+last.MovedOn.Format("2 Jan 2006")+". Pick that day or later."))
	}
	sameDay := hasLast && dateOnly(movedOn).Equal(dateOnly(last.MovedOn))

	var bedCount int
	if err := tx.Get(&bedCount,
		`SELECT COUNT(*) FROM beds b
		 JOIN rooms r ON r.id = b.room_id
		 JOIN hostel_sites hs ON hs.id = r.site_id
		 WHERE b.id = $1 AND hs.owner_id = $2`,
		req.BedID, ownerID,
	); err != nil {
		return serverError(c, err, "failed to move stay")
	}
	if bedCount == 0 {
		return c.JSON(http.StatusNotFound, errorResponse("bed not found"))
	}
	var taken int
	if err := tx.Get(&taken, `SELECT COUNT(*) FROM stays WHERE bed_id = $1 AND end_date IS NULL`, req.BedID); err != nil {
		return serverError(c, err, "failed to move stay")
	}
	if taken > 0 {
		return c.JSON(http.StatusConflict, errorResponse("Someone is already in that bed."))
	}

	if req.Rent != nil {
		schedules, err := rentSchedulesTx(tx, []int64{stayID})
		if err != nil {
			return serverError(c, err, "failed to move stay")
		}
		sched := scheduleFor(schedules, stayID, stay.StartDate, stay.RentAmount)
		planned := planRent(sched, stay.StartDate, string(stay.RentCycle), movedOn, *req.Rent)
		if err := writeSchedule(tx, stayID, planned); err != nil {
			return serverError(c, err, "failed to move stay")
		}
	}

	switch {
	case sameDay && last.FromBedID != nil && *last.FromBedID == req.BedID:
		// Back where they started the day: no move happened.
		_, err = tx.Exec(`DELETE FROM stay_moves WHERE id = $1`, last.ID)
	case sameDay:
		_, err = tx.Exec(`UPDATE stay_moves SET to_bed_id = $1 WHERE id = $2`, req.BedID, last.ID)
	default:
		_, err = tx.Exec(
			`INSERT INTO stay_moves (stay_id, from_bed_id, to_bed_id, moved_on) VALUES ($1, $2, $3, $4)`,
			stayID, *stay.BedID, req.BedID, dateOnly(movedOn),
		)
	}
	if err != nil {
		return serverError(c, err, "failed to move stay")
	}
	var updated models.Stay
	if err := tx.QueryRowx(
		`UPDATE stays SET bed_id = $1, updated_at = NOW() WHERE id = $2 RETURNING `+stayCols,
		req.BedID, stayID,
	).StructScan(&updated); err != nil {
		return serverError(c, err, "failed to move stay")
	}
	changes, err := loadRentChanges(tx, []int64{stayID})
	if err != nil {
		return serverError(c, err, "failed to move stay")
	}
	moves, err := loadMoves(tx, []int64{stayID})
	if err != nil {
		return serverError(c, err, "failed to move stay")
	}
	if err := tx.Commit(); err != nil {
		return serverError(c, err, "failed to move stay")
	}
	updated.RentChanges = changes[stayID]
	updated.Moves = moves[stayID]
	return c.JSON(http.StatusOK, updated)
}

// rentSchedulesTx is rentSchedules inside a transaction.
func rentSchedulesTx(tx *sqlx.Tx, ids []int64) (map[int64]rentSchedule, error) {
	out := map[int64]rentSchedule{}
	var rows []struct {
		StayID int64     `db:"stay_id"`
		From   time.Time `db:"effective_date"`
		Rent   int64     `db:"rent_amount"`
	}
	if err := tx.Select(&rows,
		`SELECT stay_id, effective_date, rent_amount FROM stay_rent_changes
		 WHERE stay_id = ANY($1) ORDER BY stay_id, effective_date`,
		pq.Array(ids),
	); err != nil {
		return nil, err
	}
	for _, r := range rows {
		out[r.StayID] = append(out[r.StayID], rentStep{From: dateOnly(r.From), Rent: r.Rent})
	}
	return out, nil
}

// loadMoves returns each stay's moves, oldest first, with the beds named.
// Stays that never moved are absent.
func loadMoves(db sqlx.Queryer, ids []int64) (map[int64][]models.StayMove, error) {
	out := map[int64][]models.StayMove{}
	if len(ids) == 0 {
		return out, nil
	}
	var rows []struct {
		StayID int64 `db:"stay_id"`
		models.StayMove
	}
	if err := sqlx.Select(db, &rows,
		`SELECT m.stay_id, m.moved_on,
		        m.from_bed_id, fr.name AS from_room_name, fb.name AS from_bed_name,
		        m.to_bed_id,   tr.name AS to_room_name,   tb.name AS to_bed_name
		 FROM stay_moves m
		 LEFT JOIN beds fb  ON fb.id = m.from_bed_id
		 LEFT JOIN rooms fr ON fr.id = fb.room_id
		 LEFT JOIN beds tb  ON tb.id = m.to_bed_id
		 LEFT JOIN rooms tr ON tr.id = tb.room_id
		 WHERE m.stay_id = ANY($1)
		 ORDER BY m.stay_id, m.moved_on, m.id`,
		pq.Array(ids),
	); err != nil {
		return nil, err
	}
	for _, r := range rows {
		out[r.StayID] = append(out[r.StayID], r.StayMove)
	}
	return out, nil
}

// roomSpan is part of a stay spent in one room: [From, To).
type roomSpan struct {
	RoomID   int64
	From, To time.Time
}

// roomMove is what roomSpans needs of a move: the day, and the room left.
type roomMove struct {
	On       time.Time
	FromRoom int64
}

// roomSpans splits a stay's nights [start, end) by room. Before each move
// they were in the room that move left; from the last move on, in the room
// they are in now. A stay that never moved is one span. A room of 0 is a bed
// deleted since, and Insights skips it like a booking.
func roomSpans(start, end time.Time, currentRoom int64, moves []roomMove) []roomSpan {
	spans := make([]roomSpan, 0, len(moves)+1)
	from := start
	for _, m := range moves {
		on := dateOnly(m.On)
		if on.After(from) {
			spans = append(spans, roomSpan{RoomID: m.FromRoom, From: from, To: on})
			from = on
		}
	}
	if end.After(from) {
		spans = append(spans, roomSpan{RoomID: currentRoom, From: from, To: end})
	}
	return spans
}
