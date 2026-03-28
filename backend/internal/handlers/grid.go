package handlers

import (
	"database/sql"
	"net/http"
	"strconv"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/labstack/echo/v4"
	appMiddleware "github.com/winnow/hostel/internal/middleware"
)

type GridHandler struct {
	db *sqlx.DB
}

func NewGridHandler(db *sqlx.DB) *GridHandler {
	return &GridHandler{db: db}
}

type BedStatus string

const (
	StatusVacant       BedStatus = "vacant"
	StatusPaid         BedStatus = "paid"
	StatusPartial      BedStatus = "partial"
	StatusOverdue      BedStatus = "overdue"
	StatusVacatingSoon BedStatus = "vacating_soon"
)

type GridTenant struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Phone string `json:"phone"`
}

type GridBed struct {
	ID            int64       `json:"id"`
	Name          string      `json:"name"`
	Status        BedStatus   `json:"status"`
	StayID        *int64      `json:"stay_id,omitempty"`
	Tenant        *GridTenant `json:"tenant,omitempty"`
	RentAmount    *int64      `json:"rent_amount,omitempty"`    // paise
	DepositAmount *int64      `json:"deposit_amount,omitempty"` // paise
	TotalPaid     *int64      `json:"total_paid,omitempty"`
	TotalExpected *int64      `json:"total_expected,omitempty"`
	Balance       *int64      `json:"balance,omitempty"` // total_paid - total_expected (negative = owes)
	StartDate     *time.Time  `json:"start_date,omitempty"`
	EndDate       *time.Time  `json:"end_date,omitempty"`
	NoticeDate    *time.Time  `json:"notice_date,omitempty"`
}

type GridRoom struct {
	ID    int64     `json:"id"`
	Name  string    `json:"name"`
	Floor int       `json:"floor"`
	Beds  []GridBed `json:"beds"`
}

// gridRow is the flat DB scan result before grouping.
type gridRow struct {
	RoomID        int64          `db:"room_id"`
	RoomName      string         `db:"room_name"`
	Floor         int            `db:"floor"`
	BedID         sql.NullInt64  `db:"bed_id"`
	BedName       sql.NullString `db:"bed_name"`
	StayID        sql.NullInt64  `db:"stay_id"`
	RentAmount    sql.NullInt64  `db:"rent_amount"`
	DepositAmount sql.NullInt64  `db:"deposit_amount"`
	RentCycle     sql.NullString `db:"rent_cycle"`
	StartDate     sql.NullTime   `db:"start_date"`
	EndDate       sql.NullTime   `db:"end_date"`
	NoticeDate    sql.NullTime   `db:"notice_date"`
	TenantID      sql.NullInt64  `db:"tenant_id"`
	TenantName    sql.NullString `db:"tenant_name"`
	TenantPhone   sql.NullString `db:"tenant_phone"`
	TotalPaid     int64          `db:"total_paid"`
}

func (h *GridHandler) GetGrid(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	siteID, err := strconv.ParseInt(c.Param("siteId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid site id"))
	}

	// Verify site ownership
	var count int
	h.db.Get(&count, `SELECT COUNT(*) FROM hostel_sites WHERE id = $1 AND owner_id = $2`, siteID, ownerID)
	if count == 0 {
		return c.JSON(http.StatusNotFound, errorResponse("site not found"))
	}

	var rows []gridRow
	err = h.db.Select(&rows, `
		SELECT
			r.id        AS room_id,
			r.name      AS room_name,
			r.floor,
			b.id        AS bed_id,
			b.name      AS bed_name,
			s.id        AS stay_id,
			s.rent_amount,
			s.deposit_amount,
			s.rent_cycle,
			s.start_date,
			s.end_date,
			s.notice_date,
			t.id        AS tenant_id,
			t.name      AS tenant_name,
			t.phone     AS tenant_phone,
			COALESCE(SUM(p.amount) FILTER (WHERE p.is_approved = true), 0) AS total_paid
		FROM rooms r
		LEFT JOIN beds b ON b.room_id = r.id
		LEFT JOIN stays s ON s.bed_id = b.id AND s.end_date IS NULL
		LEFT JOIN tenants t ON t.id = s.tenant_id
		LEFT JOIN payments p ON p.stay_id = s.id
		WHERE r.site_id = $1
		GROUP BY r.id, r.name, r.floor,
		         b.id, b.name,
		         s.id, s.rent_amount, s.deposit_amount, s.rent_cycle, s.start_date, s.end_date, s.notice_date,
		         t.id, t.name, t.phone
		ORDER BY r.floor, r.name, b.name
	`, siteID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, errorResponse("failed to fetch grid"))
	}

	grid := buildGrid(rows)
	return c.JSON(http.StatusOK, grid)
}

func buildGrid(rows []gridRow) []GridRoom {
	roomMap := make(map[int64]*GridRoom)
	roomOrder := make([]int64, 0)

	today := time.Now().Truncate(24 * time.Hour)

	for _, row := range rows {
		if _, exists := roomMap[row.RoomID]; !exists {
			roomMap[row.RoomID] = &GridRoom{
				ID:    row.RoomID,
				Name:  row.RoomName,
				Floor: row.Floor,
				Beds:  []GridBed{},
			}
			roomOrder = append(roomOrder, row.RoomID)
		}

		// Room with no beds — skip adding a bed entry
		if !row.BedID.Valid {
			continue
		}

		bed := buildBed(row, today)
		roomMap[row.RoomID].Beds = append(roomMap[row.RoomID].Beds, bed)
	}

	result := make([]GridRoom, 0, len(roomOrder))
	for _, id := range roomOrder {
		result = append(result, *roomMap[id])
	}
	return result
}

func buildBed(row gridRow, today time.Time) GridBed {
	bed := GridBed{
		ID:   row.BedID.Int64,
		Name: row.BedName.String,
	}

	if !row.StayID.Valid {
		bed.Status = StatusVacant
		return bed
	}

	stayID := row.StayID.Int64
	rentAmount := row.RentAmount.Int64
	depositAmount := row.DepositAmount.Int64
	startDate := row.StartDate.Time

	var endDate, noticeDate *time.Time
	if row.EndDate.Valid {
		t := row.EndDate.Time
		endDate = &t
	}
	if row.NoticeDate.Valid {
		t := row.NoticeDate.Time
		noticeDate = &t
	}

	cycles := cyclesElapsed(startDate, today, row.RentCycle.String)
	totalExpected := rentAmount * int64(cycles)
	balance := row.TotalPaid - totalExpected

	bed.StayID = &stayID
	bed.RentAmount = &rentAmount
	bed.DepositAmount = &depositAmount
	bed.TotalPaid = &row.TotalPaid
	bed.TotalExpected = &totalExpected
	bed.Balance = &balance
	bed.StartDate = &startDate
	bed.EndDate = endDate
	bed.NoticeDate = noticeDate

	if row.TenantID.Valid {
		bed.Tenant = &GridTenant{
			ID:    row.TenantID.Int64,
			Name:  row.TenantName.String,
			Phone: row.TenantPhone.String,
		}
	}

	bed.Status = computeBedStatus(balance, rentAmount, noticeDate, endDate, today)
	return bed
}

func computeBedStatus(balance, rentAmount int64, noticeDate, endDate *time.Time, today time.Time) BedStatus {
	// Vacating soon: notice given, or end_date within 30 days
	if noticeDate != nil {
		return StatusVacatingSoon
	}
	if endDate != nil && endDate.Sub(today) <= 30*24*time.Hour {
		return StatusVacatingSoon
	}

	if rentAmount == 0 || balance >= 0 {
		return StatusPaid
	}
	if balance > -rentAmount {
		return StatusPartial // partially paid current cycle
	}
	return StatusOverdue // >= 1 full cycle behind
}

