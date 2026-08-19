package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/labstack/echo/v4"
	appMiddleware "github.com/winnow/hostel/internal/middleware"
	"github.com/winnow/hostel/internal/models"
)

type StayHandler struct {
	db *sqlx.DB
}

func NewStayHandler(db *sqlx.DB) *StayHandler {
	return &StayHandler{db: db}
}

const stayCols = `id, tenant_id, bed_id, rent_amount, deposit_amount, rent_cycle, start_date, end_date, notice_date, created_at, updated_at`

// The same columns qualified, for the queries that join tenants to scope by
// owner. Unqualified, `id` is ambiguous across stays and tenants and Postgres
// refuses the query — which is what Get did for every stay it was ever asked
// for. Nothing in the app calls that endpoint, so it 404'd unnoticed until a
// settlement test read a stay back to check it had been ended.
const stayColsQualified = `s.id, s.tenant_id, s.bed_id, s.rent_amount, s.deposit_amount, s.rent_cycle, s.start_date, s.end_date, s.notice_date, s.created_at, s.updated_at`

type createStayRequest struct {
	TenantID      int64  `json:"tenant_id"`
	BedID         *int64 `json:"bed_id"`         // optional: null = pending bed assignment
	RentAmount    int64  `json:"rent_amount"`    // in paise
	DepositAmount int64  `json:"deposit_amount"` // in paise
	RentCycle     string `json:"rent_cycle"`     // "daily"|"weekly"|"monthly"
	StartDate     string `json:"start_date"`     // YYYY-MM-DD
}

// stayPatch is a partial update. Every field is optional, and a field that is
// absent from the JSON body is left untouched — distinct from one sent as
// explicit null, which clears it. Binding into plain pointers cannot tell those
// apart (both arrive as nil), which is why the raw keys are tracked separately.
type stayPatch struct {
	keys map[string]bool

	StartDate     *time.Time
	EndDate       *time.Time
	NoticeDate    *time.Time
	RentAmount    *int64
	DepositAmount *int64
	RentCycle     *string
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
		"start_date":  &p.StartDate,
		"end_date":    &p.EndDate,
		"notice_date": &p.NoticeDate,
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
		`INSERT INTO stays (tenant_id, bed_id, rent_amount, deposit_amount, rent_cycle, start_date, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
		 RETURNING `+stayCols,
		req.TenantID, req.BedID, req.RentAmount, req.DepositAmount,
		req.RentCycle, startDate, time.Now(),
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

	var stay models.Stay
	err = h.db.QueryRowx(
		`UPDATE stays
		 SET start_date = $1, end_date = $2, notice_date = $3,
		     rent_amount = $4, deposit_amount = $5, rent_cycle = $6, updated_at = $7
		 WHERE id = $8
		 RETURNING `+stayCols,
		next.StartDate, next.EndDate, next.NoticeDate,
		next.RentAmount, next.DepositAmount, next.RentCycle, time.Now(), stayID,
	).StructScan(&stay)
	if err != nil {
		return serverError(c, err, "failed to update stay")
	}
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

	var stays []models.Stay
	err = h.db.Select(&stays,
		`SELECT `+stayCols+` FROM stays WHERE tenant_id = $1 ORDER BY start_date DESC`,
		tenantID,
	)
	if err != nil {
		return serverError(c, err, "failed to fetch stays")
	}
	if stays == nil {
		stays = []models.Stay{}
	}
	return c.JSON(http.StatusOK, stays)
}
