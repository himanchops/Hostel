package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/labstack/echo/v4"
	"github.com/lib/pq"
	appMiddleware "github.com/winnow/hostel/internal/middleware"
	"github.com/winnow/hostel/internal/models"
)

type StayHandler struct {
	db *sqlx.DB
}

func NewStayHandler(db *sqlx.DB) *StayHandler {
	return &StayHandler{db: db}
}

const stayCols = `id, tenant_id, bed_id, rent_amount, deposit_amount, rent_cycle, start_date, end_date, notice_date, expected_end_date, created_at, updated_at`

// The same columns qualified, for the queries that join tenants to scope by
// owner. Unqualified, `id` is ambiguous across stays and tenants and Postgres
// refuses the query — which is what Get did for every stay it was ever asked
// for. Nothing in the app calls that endpoint, so it 404'd unnoticed until a
// settlement test read a stay back to check it had been ended.
const stayColsQualified = `s.id, s.tenant_id, s.bed_id, s.rent_amount, s.deposit_amount, s.rent_cycle, s.start_date, s.end_date, s.notice_date, s.expected_end_date, s.created_at, s.updated_at`

type createStayRequest struct {
	TenantID      int64  `json:"tenant_id"`
	BedID         *int64 `json:"bed_id"`         // optional: null = pending bed assignment
	RentAmount    int64  `json:"rent_amount"`    // in paise
	DepositAmount int64  `json:"deposit_amount"` // in paise
	RentCycle     string `json:"rent_cycle"`     // "daily"|"weekly"|"monthly"
	StartDate     string `json:"start_date"`     // YYYY-MM-DD
	// ExpectedEndDate is a leaving date known on arrival: a guest for five
	// nights, someone here for a month. Optional, YYYY-MM-DD, after start_date.
	ExpectedEndDate string `json:"expected_end_date"`
}

// stayPatch is a partial update. Every field is optional, and a field that is
// absent from the JSON body is left untouched — distinct from one sent as
// explicit null, which clears it. Binding into plain pointers cannot tell those
// apart (both arrive as nil), which is why the raw keys are tracked separately.
type stayPatch struct {
	keys map[string]bool

	StartDate       *time.Time
	EndDate         *time.Time
	NoticeDate      *time.Time
	ExpectedEndDate *time.Time
	RentAmount      *int64
	DepositAmount   *int64
	RentCycle       *string
}

func (p stayPatch) has(field string) bool { return p.keys[field] }

func parseStayPatch(c echo.Context) (stayPatch, error) {
	var raw map[string]json.RawMessage
	if err := json.NewDecoder(c.Request().Body).Decode(&raw); err != nil {
		return stayPatch{}, errors.New("invalid request body")
	}

	p := stayPatch{keys: make(map[string]bool, len(raw))}
	for k := range raw {
		p.keys[k] = true
	}

	dates := map[string]**time.Time{
		"start_date":        &p.StartDate,
		"end_date":          &p.EndDate,
		"notice_date":       &p.NoticeDate,
		"expected_end_date": &p.ExpectedEndDate,
	}
	for field, dst := range dates {
		msg, ok := raw[field]
		if !ok || string(msg) == "null" {
			continue
		}
		var s string
		if err := json.Unmarshal(msg, &s); err != nil {
			return stayPatch{}, fmt.Errorf("%s must be a YYYY-MM-DD string or null", field)
		}
		t, err := time.Parse("2006-01-02", s)
		if err != nil {
			return stayPatch{}, fmt.Errorf("invalid %s format, use YYYY-MM-DD", field)
		}
		*dst = &t
	}

	amounts := map[string]**int64{
		"rent_amount":    &p.RentAmount,
		"deposit_amount": &p.DepositAmount,
	}
	for field, dst := range amounts {
		msg, ok := raw[field]
		if !ok || string(msg) == "null" {
			continue
		}
		var n int64
		if err := json.Unmarshal(msg, &n); err != nil {
			return stayPatch{}, fmt.Errorf("%s must be a number in paise", field)
		}
		*dst = &n
	}

	if msg, ok := raw["rent_cycle"]; ok && string(msg) != "null" {
		var s string
		if err := json.Unmarshal(msg, &s); err != nil {
			return stayPatch{}, errors.New("rent_cycle must be a string")
		}
		p.RentCycle = &s
	}

	return p, nil
}

type assignBedRequest struct {
	BedID int64 `json:"bed_id"`
}

func (h *StayHandler) Create(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)

	var req createStayRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid request body"))
	}
	if req.TenantID == 0 || req.StartDate == "" {
		return c.JSON(http.StatusBadRequest, errorResponse("tenant_id and start_date are required"))
	}
	if req.RentAmount <= 0 {
		return c.JSON(http.StatusBadRequest, errorResponse("rent_amount must be positive"))
	}
	if req.RentCycle == "" {
		req.RentCycle = "monthly"
	}

	startDate, err := time.Parse("2006-01-02", req.StartDate)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid start_date format, use YYYY-MM-DD"))
	}

	// A leaving date given at the door was given with notice: they told you
	// the day they arrived. Without notice_date the move-out sheet would say
	// "no notice given" and keep their deposit by default.
	var expectedEnd, noticeDate *time.Time
	if req.ExpectedEndDate != "" {
		end, err := time.Parse("2006-01-02", req.ExpectedEndDate)
		if err != nil {
			return c.JSON(http.StatusBadRequest, errorResponse("invalid expected_end_date format, use YYYY-MM-DD"))
		}
		if !end.After(startDate) {
			return c.JSON(http.StatusBadRequest, errorResponse("expected_end_date must be after start_date"))
		}
		expectedEnd, noticeDate = &end, &startDate
	}

	// Verify tenant belongs to owner
	var tenantCount int
	if err := h.db.Get(&tenantCount, `SELECT COUNT(*) FROM tenants WHERE id = $1 AND owner_id = $2`, req.TenantID, ownerID); err != nil {
		return serverError(c, err, "failed to create stay")
	}
	if tenantCount == 0 {
		return c.JSON(http.StatusNotFound, errorResponse("tenant not found"))
	}

	// Check tenant doesn't already have an active stay
	var activeTenantStays int
	if err := h.db.Get(&activeTenantStays, `SELECT COUNT(*) FROM stays WHERE tenant_id = $1 AND end_date IS NULL`, req.TenantID); err != nil {
		return serverError(c, err, "failed to create stay")
	}
	if activeTenantStays > 0 {
		return c.JSON(http.StatusConflict, errorResponse("tenant already has an active stay"))
	}

	if req.BedID != nil {
		// Verify bed belongs to a site owned by the owner
		var bedCount int
		if err := h.db.Get(&bedCount,
			`SELECT COUNT(*) FROM beds b
			 JOIN rooms r ON r.id = b.room_id
			 JOIN hostel_sites s ON s.id = r.site_id
			 WHERE b.id = $1 AND s.owner_id = $2`,
			*req.BedID, ownerID,
		); err != nil {
			return serverError(c, err, "failed to create stay")
		}
		if bedCount == 0 {
			return c.JSON(http.StatusNotFound, errorResponse("bed not found"))
		}

		// Check bed is not already occupied
		var activeStays int
		if err := h.db.Get(&activeStays, `SELECT COUNT(*) FROM stays WHERE bed_id = $1 AND end_date IS NULL`, *req.BedID); err != nil {
			return serverError(c, err, "failed to create stay")
		}
		if activeStays > 0 {
			return c.JSON(http.StatusConflict, errorResponse("bed is already occupied"))
		}
	}

	var stay models.Stay
	err = h.db.QueryRowx(
		`INSERT INTO stays (tenant_id, bed_id, rent_amount, deposit_amount, rent_cycle, start_date,
		                    notice_date, expected_end_date, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
		 RETURNING `+stayCols,
		req.TenantID, req.BedID, req.RentAmount, req.DepositAmount,
		req.RentCycle, startDate, noticeDate, expectedEnd, time.Now(),
	).StructScan(&stay)
	if err != nil {
		return serverError(c, err, "failed to create stay")
	}
	return c.JSON(http.StatusCreated, stay)
}

func (h *StayHandler) Update(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	stayID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid stay id"))
	}

	// Verify ownership via tenant
	var count int
	if err := h.db.Get(&count,
		`SELECT COUNT(*) FROM stays s JOIN tenants t ON t.id = s.tenant_id WHERE s.id = $1 AND t.owner_id = $2`,
		stayID, ownerID,
	); err != nil {
		return serverError(c, err, "failed to load stay")
	}
	if count == 0 {
		return c.JSON(http.StatusNotFound, errorResponse("stay not found"))
	}

	// Load the current row so omitted fields keep their values and so the
	// resulting date range can be validated as a whole.
	var current models.Stay
	if err := h.db.QueryRowx(`SELECT `+stayCols+` FROM stays WHERE id = $1`, stayID).StructScan(&current); err != nil {
		return serverError(c, err, "failed to load stay")
	}

	patch, err := parseStayPatch(c)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse(err.Error()))
	}

	// Start from current values; only overwrite what the request actually sent.
	next := current
	if patch.has("start_date") {
		if patch.StartDate == nil {
			return c.JSON(http.StatusBadRequest, errorResponse("start_date cannot be null"))
		}
		next.StartDate = *patch.StartDate
	}
	if patch.has("end_date") {
		next.EndDate = patch.EndDate
	}
	if patch.has("notice_date") {
		next.NoticeDate = patch.NoticeDate
	}
	if patch.has("expected_end_date") {
		next.ExpectedEndDate = patch.ExpectedEndDate
	}
	if patch.has("rent_amount") {
		if patch.RentAmount == nil || *patch.RentAmount <= 0 {
			return c.JSON(http.StatusBadRequest, errorResponse("rent_amount must be positive"))
		}
		next.RentAmount = *patch.RentAmount
	}
	if patch.has("deposit_amount") {
		if patch.DepositAmount == nil || *patch.DepositAmount < 0 {
			return c.JSON(http.StatusBadRequest, errorResponse("deposit_amount cannot be negative"))
		}
		next.DepositAmount = *patch.DepositAmount
	}
	if patch.has("rent_cycle") {
		if patch.RentCycle == nil {
			return c.JSON(http.StatusBadRequest, errorResponse("rent_cycle cannot be null"))
		}
		switch *patch.RentCycle {
		case "daily", "weekly", "monthly":
			next.RentCycle = models.RentCycle(*patch.RentCycle)
		default:
			return c.JSON(http.StatusBadRequest, errorResponse(`rent_cycle must be "daily", "weekly", or "monthly"`))
		}
	}

	// A stay cannot end before it starts, and notice cannot predate the stay.
	if next.EndDate != nil && next.EndDate.Before(next.StartDate) {
		return c.JSON(http.StatusBadRequest, errorResponse("end_date cannot be before start_date"))
	}
	if next.NoticeDate != nil && next.NoticeDate.Before(next.StartDate) {
		return c.JSON(http.StatusBadRequest, errorResponse("notice_date cannot be before start_date"))
	}
	// An expected departure before the stay began is a typo, not a plan. It is
	// allowed to be in the past, though — that is precisely the overdue case the
	// grid needs to surface.
	if next.ExpectedEndDate != nil && next.ExpectedEndDate.Before(next.StartDate) {
		return c.JSON(http.StatusBadRequest, errorResponse("expected_end_date cannot be before start_date"))
	}

	// Reopening a stay (clearing end_date) must not collide with whoever is in
	// the bed now.
	if current.EndDate != nil && next.EndDate == nil && next.BedID != nil {
		var occupied int
		if err := h.db.Get(&occupied,
			`SELECT COUNT(*) FROM stays WHERE bed_id = $1 AND end_date IS NULL AND id <> $2`,
			*next.BedID, stayID,
		); err != nil {
			return serverError(c, err, "failed to update stay")
		}
		if occupied > 0 {
			return c.JSON(http.StatusConflict, errorResponse("bed is already occupied by another active stay"))
		}
	}

	// A stay with a rent schedule (migration 011) needs the schedule kept
	// consistent with whatever this update changes.
	var schedule []models.RentChange
	if err := h.db.Select(&schedule,
		`SELECT effective_date, rent_amount FROM stay_rent_changes WHERE stay_id = $1 ORDER BY effective_date`,
		stayID,
	); err != nil {
		return serverError(c, err, "failed to update stay")
	}
	// Only a rent that actually differs is a correction. An edit form that
	// re-sends the current rent alongside a new deposit must not quietly
	// discard the schedule.
	rentCorrected := patch.has("rent_amount") && next.RentAmount != current.RentAmount

	// Moving the start date moves the schedule's opening step with it — but
	// not past a later change, which would leave a cycle with no rent.
	if !rentCorrected && len(schedule) > 1 && patch.has("start_date") && !next.StartDate.Before(schedule[1].EffectiveDate) {
		return c.JSON(http.StatusBadRequest, errorResponse("The rent changes on a date before that. Correct the whole stay's rent first, or pick an earlier move-in date."))
	}

	tx, err := h.db.Beginx()
	if err != nil {
		return serverError(c, err, "failed to update stay")
	}
	defer tx.Rollback()

	// rent_amount sent here is the "correct the whole stay" path: one rent from
	// move-in to now, as if it had been typed right the first time. So it
	// discards the schedule. Changing rent from a date is ChangeRent.
	if rentCorrected && len(schedule) > 0 {
		if _, err := tx.Exec(`DELETE FROM stay_rent_changes WHERE stay_id = $1`, stayID); err != nil {
			return serverError(c, err, "failed to update stay")
		}
		schedule = nil
	}
	if len(schedule) > 0 && patch.has("start_date") {
		if _, err := tx.Exec(
			`UPDATE stay_rent_changes SET effective_date = $1 WHERE stay_id = $2 AND effective_date = $3`,
			next.StartDate, stayID, schedule[0].EffectiveDate,
		); err != nil {
			return serverError(c, err, "failed to update stay")
		}
	}

	var stay models.Stay
	err = tx.QueryRowx(
		`UPDATE stays
		 SET start_date = $1, end_date = $2, notice_date = $3, expected_end_date = $4,
		     rent_amount = $5, deposit_amount = $6, rent_cycle = $7, updated_at = $8
		 WHERE id = $9
		 RETURNING `+stayCols,
		next.StartDate, next.EndDate, next.NoticeDate, next.ExpectedEndDate,
		next.RentAmount, next.DepositAmount, next.RentCycle, time.Now(), stayID,
	).StructScan(&stay)
	if err != nil {
		return serverError(c, err, "failed to update stay")
	}
	changes, err := loadRentChanges(tx, []int64{stayID})
	if err != nil {
		return serverError(c, err, "failed to update stay")
	}
	if err := tx.Commit(); err != nil {
		return serverError(c, err, "failed to update stay")
	}
	stay.RentChanges = changes[stayID]
	return c.JSON(http.StatusOK, stay)
}

// AssignBed assigns a bed to a pending stay that has no bed yet.
func (h *StayHandler) AssignBed(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	stayID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid stay id"))
	}

	var req assignBedRequest
	if err := c.Bind(&req); err != nil || req.BedID == 0 {
		return c.JSON(http.StatusBadRequest, errorResponse("bed_id is required"))
	}

	// Verify stay belongs to owner and currently has no bed
	var currentBedID *int64
	err = h.db.QueryRow(
		`SELECT s.bed_id FROM stays s
		 JOIN tenants t ON t.id = s.tenant_id
		 WHERE s.id = $1 AND t.owner_id = $2`,
		stayID, ownerID,
	).Scan(&currentBedID)
	if err != nil {
		return c.JSON(http.StatusNotFound, errorResponse("stay not found"))
	}
	if currentBedID != nil {
		return c.JSON(http.StatusConflict, errorResponse("stay already has a bed assigned"))
	}

	// Verify bed belongs to owner
	var bedCount int
	if err := h.db.Get(&bedCount,
		`SELECT COUNT(*) FROM beds b
		 JOIN rooms r ON r.id = b.room_id
		 JOIN hostel_sites s ON s.id = r.site_id
		 WHERE b.id = $1 AND s.owner_id = $2`,
		req.BedID, ownerID,
	); err != nil {
		return serverError(c, err, "failed to assign bed")
	}
	if bedCount == 0 {
		return c.JSON(http.StatusNotFound, errorResponse("bed not found"))
	}

	// Verify bed is not already occupied
	var activeStays int
	if err := h.db.Get(&activeStays, `SELECT COUNT(*) FROM stays WHERE bed_id = $1 AND end_date IS NULL`, req.BedID); err != nil {
		return serverError(c, err, "failed to assign bed")
	}
	if activeStays > 0 {
		return c.JSON(http.StatusConflict, errorResponse("bed is already occupied"))
	}

	var stay models.Stay
	err = h.db.QueryRowx(
		`UPDATE stays SET bed_id = $1, updated_at = $2 WHERE id = $3
		 RETURNING `+stayCols,
		req.BedID, time.Now(), stayID,
	).StructScan(&stay)
	if err != nil {
		return serverError(c, err, "failed to assign bed")
	}
	return c.JSON(http.StatusOK, stay)
}

func (h *StayHandler) Get(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	stayID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid stay id"))
	}

	var stay models.Stay
	err = h.db.QueryRowx(
		`SELECT `+stayColsQualified+`
		 FROM stays s JOIN tenants t ON t.id = s.tenant_id
		 WHERE s.id = $1 AND t.owner_id = $2`,
		stayID, ownerID,
	).StructScan(&stay)
	if err != nil {
		return c.JSON(http.StatusNotFound, errorResponse("stay not found"))
	}
	return c.JSON(http.StatusOK, stay)
}

func (h *StayHandler) ListByTenant(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	tenantID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid tenant id"))
	}

	// Verify tenant ownership
	var count int
	if err := h.db.Get(&count, `SELECT COUNT(*) FROM tenants WHERE id = $1 AND owner_id = $2`, tenantID, ownerID); err != nil {
		return serverError(c, err, "failed to fetch stays")
	}
	if count == 0 {
		return c.JSON(http.StatusNotFound, errorResponse("tenant not found"))
	}

	// The stay plus where it is. The tenant profile printed "Bed #31" — a
	// database id — because this was the one stay list without the names every
	// other surface shows (UX audit M7). LEFT JOINs because a stay can still be
	// waiting for a bed, in which case all three are null.
	type tenantStayRow struct {
		models.Stay
		SiteName *string `db:"site_name" json:"site_name"`
		RoomName *string `db:"room_name" json:"room_name"`
		BedName  *string `db:"bed_name" json:"bed_name"`
	}
	var stays []tenantStayRow
	err = h.db.Select(&stays,
		`SELECT `+stayColsQualified+`, hs.name AS site_name, r.name AS room_name, b.name AS bed_name
		 FROM stays s
		 LEFT JOIN beds b          ON b.id = s.bed_id
		 LEFT JOIN rooms r         ON r.id = b.room_id
		 LEFT JOIN hostel_sites hs ON hs.id = r.site_id
		 WHERE s.tenant_id = $1
		 ORDER BY s.start_date DESC`,
		tenantID,
	)
	if err != nil {
		return serverError(c, err, "failed to fetch stays")
	}
	if stays == nil {
		stays = []tenantStayRow{}
	}
	ids := make([]int64, len(stays))
	for i := range stays {
		ids[i] = stays[i].ID
	}
	changes, err := loadRentChanges(h.db, ids)
	if err != nil {
		return serverError(c, err, "failed to fetch rent changes")
	}
	moves, err := loadMoves(h.db, ids)
	if err != nil {
		return serverError(c, err, "failed to fetch moves")
	}
	for i := range stays {
		stays[i].RentChanges = changes[stays[i].ID]
		stays[i].Moves = moves[stays[i].ID]
	}
	return c.JSON(http.StatusOK, stays)
}

// loadRentChanges returns the recorded schedule of each stay in ids, for
// display. Stays whose rent never changed are absent.
func loadRentChanges(db sqlx.Queryer, ids []int64) (map[int64][]models.RentChange, error) {
	out := map[int64][]models.RentChange{}
	if len(ids) == 0 {
		return out, nil
	}
	var rows []struct {
		StayID int64 `db:"stay_id"`
		models.RentChange
	}
	if err := sqlx.Select(db, &rows,
		`SELECT stay_id, effective_date, rent_amount FROM stay_rent_changes
		 WHERE stay_id = ANY($1) ORDER BY stay_id, effective_date`, pq.Array(ids)); err != nil {
		return nil, err
	}
	for _, r := range rows {
		out[r.StayID] = append(out[r.StayID], r.RentChange)
	}
	return out, nil
}

type rentChangeRequest struct {
	RentAmount    int64  `json:"rent_amount"`    // paise
	EffectiveDate string `json:"effective_date"` // YYYY-MM-DD
}

// ChangeRent sets a new rent from a date, leaving every cycle that began
// before it at the rent it was billed at.
//
// This is the default way to change rent. The other way — PUT /stays/:id with
// rent_amount — corrects the rent for the whole stay, for a figure typed wrong
// at move-in, and wipes any schedule. The owner asked for exactly this split:
// a rent bump on a long stay must not touch the months already lived, with a
// whole-stay correction still available but not in the way.
//
// The change applies from the first cycle that begins on or after the date, so
// a mid-cycle date never splits a cycle. A settled stay is closed: changing its
// rent would change a figure someone has already been paid or charged.
//
// POST /api/stays/:id/rent-changes
func (h *StayHandler) ChangeRent(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	stayID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid stay id"))
	}
	var req rentChangeRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid request body"))
	}
	if req.RentAmount <= 0 {
		return c.JSON(http.StatusBadRequest, errorResponse("Enter the new rent."))
	}
	from, err := time.Parse("2006-01-02", req.EffectiveDate)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("Pick the date the new rent starts from."))
	}

	tx, err := h.db.Beginx()
	if err != nil {
		return serverError(c, err, "failed to change rent")
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
		return serverError(c, err, "failed to change rent")
	}
	if stay.Settled {
		return c.JSON(http.StatusConflict, errorResponse("This stay is settled, so its rent can no longer change."))
	}
	start := dateOnly(stay.StartDate)
	if !dateOnly(from).After(start) {
		return c.JSON(http.StatusBadRequest, errorResponse("Pick a date after move-in. To fix the rent from the very start, correct the whole stay instead."))
	}
	if stay.EndDate != nil && dateOnly(from).After(dateOnly(*stay.EndDate)) {
		return c.JSON(http.StatusBadRequest, errorResponse("That date is after the stay ended."))
	}

	if err := setRentFrom(tx, stay.Stay, from, req.RentAmount); err != nil {
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

// setRentFrom bills rent at `rent` from `from` onward, in the caller's
// transaction. Every cycle that began before `from` keeps the rent it was
// billed at. ChangeRent and a move to another bed both use it.
//
// A date on the stay's own start reprices the stay from its first cycle,
// which only a move in the first month asks for: a stay with no schedule just
// takes the new rent, and one with a schedule has its opening step changed.
func setRentFrom(tx *sqlx.Tx, stay models.Stay, from time.Time, rent int64) error {
	start := dateOnly(stay.StartDate)
	from = dateOnly(from)
	if from.Equal(start) {
		var steps int
		if err := tx.Get(&steps, `SELECT COUNT(*) FROM stay_rent_changes WHERE stay_id = $1`, stay.ID); err != nil {
			return err
		}
		if steps == 0 {
			_, err := tx.Exec(`UPDATE stays SET rent_amount = $1, updated_at = NOW() WHERE id = $2`, rent, stay.ID)
			return err
		}
	} else {
		// The first change writes the original rent as the schedule's opening
		// step, so the months before the change keep it.
		if _, err := tx.Exec(
			`INSERT INTO stay_rent_changes (stay_id, effective_date, rent_amount)
			 SELECT $1, $2, $3
			 WHERE NOT EXISTS (SELECT 1 FROM stay_rent_changes WHERE stay_id = $1)`,
			stay.ID, start, stay.RentAmount,
		); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(
		`INSERT INTO stay_rent_changes (stay_id, effective_date, rent_amount)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (stay_id, effective_date) DO UPDATE SET rent_amount = EXCLUDED.rent_amount`,
		stay.ID, from, rent,
	); err != nil {
		return err
	}
	// stays.rent_amount follows the latest scheduled rent, so every screen
	// that only shows "the rent" shows the new one.
	_, err := tx.Exec(
		`UPDATE stays SET rent_amount = (
		     SELECT rent_amount FROM stay_rent_changes WHERE stay_id = $1
		     ORDER BY effective_date DESC LIMIT 1),
		   updated_at = NOW()
		 WHERE id = $1`,
		stay.ID,
	)
	return err
}
