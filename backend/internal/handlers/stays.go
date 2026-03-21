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

type StayHandler struct {
	db *sqlx.DB
}

func NewStayHandler(db *sqlx.DB) *StayHandler {
	return &StayHandler{db: db}
}

type createStayRequest struct {
	TenantID      int64  `json:"tenant_id"`
	BedID         int64  `json:"bed_id"`
	RentAmount    int64  `json:"rent_amount"`    // in paise
	DepositAmount int64  `json:"deposit_amount"` // in paise
	RentCycle     string `json:"rent_cycle"`     // "daily"|"weekly"|"monthly"
	RentDueDay    int    `json:"rent_due_day"`
	StartDate     string `json:"start_date"` // YYYY-MM-DD
}

type updateStayRequest struct {
	EndDate    *string `json:"end_date"`    // YYYY-MM-DD or null
	NoticeDate *string `json:"notice_date"` // YYYY-MM-DD or null
}

func (h *StayHandler) Create(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)

	var req createStayRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid request body"))
	}
	if req.TenantID == 0 || req.BedID == 0 || req.StartDate == "" {
		return c.JSON(http.StatusBadRequest, errorResponse("tenant_id, bed_id, and start_date are required"))
	}
	if req.RentAmount <= 0 {
		return c.JSON(http.StatusBadRequest, errorResponse("rent_amount must be positive"))
	}
	if req.RentCycle == "" {
		req.RentCycle = "monthly"
	}
	if req.RentDueDay == 0 {
		req.RentDueDay = 1
	}

	startDate, err := time.Parse("2006-01-02", req.StartDate)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid start_date format, use YYYY-MM-DD"))
	}

	// Verify tenant belongs to owner
	var tenantCount int
	h.db.Get(&tenantCount, `SELECT COUNT(*) FROM tenants WHERE id = $1 AND owner_id = $2`, req.TenantID, ownerID)
	if tenantCount == 0 {
		return c.JSON(http.StatusNotFound, errorResponse("tenant not found"))
	}

	// Verify bed belongs to a site owned by the owner
	var bedCount int
	h.db.Get(&bedCount,
		`SELECT COUNT(*) FROM beds b
		 JOIN rooms r ON r.id = b.room_id
		 JOIN hostel_sites s ON s.id = r.site_id
		 WHERE b.id = $1 AND s.owner_id = $2`,
		req.BedID, ownerID,
	)
	if bedCount == 0 {
		return c.JSON(http.StatusNotFound, errorResponse("bed not found"))
	}

	// Check bed is not already occupied
	var activeStays int
	h.db.Get(&activeStays, `SELECT COUNT(*) FROM stays WHERE bed_id = $1 AND end_date IS NULL`, req.BedID)
	if activeStays > 0 {
		return c.JSON(http.StatusConflict, errorResponse("bed is already occupied"))
	}

	var stay models.Stay
	err = h.db.QueryRowx(
		`INSERT INTO stays (tenant_id, bed_id, rent_amount, deposit_amount, rent_cycle, rent_due_day, start_date, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
		 RETURNING id, tenant_id, bed_id, rent_amount, deposit_amount, rent_cycle, rent_due_day, start_date, end_date, notice_date, created_at, updated_at`,
		req.TenantID, req.BedID, req.RentAmount, req.DepositAmount,
		req.RentCycle, req.RentDueDay, startDate, time.Now(),
	).StructScan(&stay)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, errorResponse("failed to create stay"))
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
	h.db.Get(&count,
		`SELECT COUNT(*) FROM stays s JOIN tenants t ON t.id = s.tenant_id WHERE s.id = $1 AND t.owner_id = $2`,
		stayID, ownerID,
	)
	if count == 0 {
		return c.JSON(http.StatusNotFound, errorResponse("stay not found"))
	}

	var req updateStayRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid request body"))
	}

	var endDate, noticeDate *time.Time
	if req.EndDate != nil {
		t, err := time.Parse("2006-01-02", *req.EndDate)
		if err != nil {
			return c.JSON(http.StatusBadRequest, errorResponse("invalid end_date format"))
		}
		endDate = &t
	}
	if req.NoticeDate != nil {
		t, err := time.Parse("2006-01-02", *req.NoticeDate)
		if err != nil {
			return c.JSON(http.StatusBadRequest, errorResponse("invalid notice_date format"))
		}
		noticeDate = &t
	}

	var stay models.Stay
	err = h.db.QueryRowx(
		`UPDATE stays SET end_date = $1, notice_date = $2, updated_at = $3
		 WHERE id = $4
		 RETURNING id, tenant_id, bed_id, rent_amount, deposit_amount, rent_cycle, rent_due_day, start_date, end_date, notice_date, created_at, updated_at`,
		endDate, noticeDate, time.Now(), stayID,
	).StructScan(&stay)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, errorResponse("failed to update stay"))
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
		`SELECT s.id, s.tenant_id, s.bed_id, s.rent_amount, s.deposit_amount, s.rent_cycle, s.rent_due_day,
		        s.start_date, s.end_date, s.notice_date, s.created_at, s.updated_at
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
	h.db.Get(&count, `SELECT COUNT(*) FROM tenants WHERE id = $1 AND owner_id = $2`, tenantID, ownerID)
	if count == 0 {
		return c.JSON(http.StatusNotFound, errorResponse("tenant not found"))
	}

	var stays []models.Stay
	err = h.db.Select(&stays,
		`SELECT id, tenant_id, bed_id, rent_amount, deposit_amount, rent_cycle, rent_due_day,
		        start_date, end_date, notice_date, created_at, updated_at
		 FROM stays WHERE tenant_id = $1 ORDER BY start_date DESC`,
		tenantID,
	)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, errorResponse("failed to fetch stays"))
	}
	if stays == nil {
		stays = []models.Stay{}
	}
	return c.JSON(http.StatusOK, stays)
}
