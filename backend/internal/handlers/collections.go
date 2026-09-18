package handlers

import (
	"database/sql"
	"net/http"
	"sort"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/labstack/echo/v4"
	appMiddleware "github.com/winnow/hostel/internal/middleware"
)

type CollectionsHandler struct {
	db *sqlx.DB
}

func NewCollectionsHandler(db *sqlx.DB) *CollectionsHandler {
	return &CollectionsHandler{db: db}
}

// CollectionRow is one tenant who owes money, as the collections page needs it.
//
// Sign convention: BalancePaise is what the tenant OWES, so it is positive here
// and rows with nothing outstanding are dropped entirely. Note this is the
// opposite sign from the grid's balance (paid − expected, negative = owes) and
// the same sign as the tenant summary's. The page never shows a negative.
type CollectionRow struct {
	StayID          int64   `json:"stay_id"`
	TenantID        int64   `json:"tenant_id"`
	TenantName      string  `json:"tenant_name"`
	Phone           string  `json:"phone"`
	SiteName        string  `json:"site_name"`
	RoomName        string  `json:"room_name"`
	BedName         *string `json:"bed_name"`
	RentAmount      int64   `json:"rent_amount"`
	RentCycle       string  `json:"rent_cycle"`
	BalancePaise    int64   `json:"balance_paise"`
	DaysSinceDue    int     `json:"days_since_due"`
	LastPaymentDate *string `json:"last_payment_date"`
	// MovedOut marks a stay that has ended and been settled with the tenant
	// still owing (UX audit M12). Settling used to drop them off this list and
	// out of the dashboard total — and a tenant who has already left is the
	// one most likely not to pay. For these rows DaysSinceDue counts from the
	// settlement, the day the shortfall was agreed, and EndDate is when they
	// left.
	MovedOut bool    `json:"moved_out"`
	EndDate  *string `json:"end_date,omitempty"`
}

// settledOwed is what a tenant still owes on a settled stay.
//
// A settlement's refund is negative when the tenant came up short at the
// counter; that shortfall is the debt. Anything paid on the stay AFTER the
// settlement was recorded goes against it. The settlement row itself is never
// rewritten — it is a record of what was agreed that day (migration 005) — so
// the balance is the record minus what has arrived since.
//
// Payments before the settlement are already inside its dues figure, and
// counting them again would forgive the debt twice. Hence "after", measured by
// when the payment was recorded, not the date typed on it: a missed March
// receipt entered next week is still money that arrived after the agreement.
func settledOwed(refundPaise, paidAfter int64) int64 {
	owed := -refundPaise - paidAfter
	if owed < 0 {
		return 0
	}
	return owed
}

// movedOutRow is one settled stay that ended short, as scanned from the DB.
type movedOutRow struct {
	StayID          int64          `db:"stay_id"`
	TenantID        int64          `db:"tenant_id"`
	TenantName      string         `db:"tenant_name"`
	Phone           string         `db:"phone"`
	SiteName        string         `db:"site_name"`
	RoomName        string         `db:"room_name"`
	BedName         sql.NullString `db:"bed_name"`
	RentAmount      int64          `db:"rent_amount"`
	RentCycle       string         `db:"rent_cycle"`
	EndDate         string         `db:"end_date"`
	RefundPaise     int64          `db:"refund_paise"`
	SettledAt       time.Time      `db:"settled_at"`
	PaidAfter       int64          `db:"paid_after"`
	LastPaymentDate sql.NullString `db:"last_payment_date"`
}

// loadMovedOut fetches every ended, settled stay whose settlement left the
// tenant owing. Only settled stays: a stay ended without settling has no
// agreed figure yet — its deposit may cover the rent, and saying "owes" before
// anyone has done that sum would be a guess. Its prompt is "Settle deposit" on
// the tenant page.
//
// Shared by Collections and the dashboard so the two totals cannot disagree.
func loadMovedOut(db *sqlx.DB, ownerID int64) ([]movedOutRow, error) {
	var rows []movedOutRow
	err := db.Select(&rows, `
		SELECT
			s.id           AS stay_id,
			s.rent_amount,
			s.rent_cycle,
			TO_CHAR(s.end_date, 'YYYY-MM-DD') AS end_date,
			t.id           AS tenant_id,
			t.name         AS tenant_name,
			t.phone,
			COALESCE(hs.name, '') AS site_name,
			COALESCE(r.name, '')  AS room_name,
			b.name         AS bed_name,
			st.refund_paise,
			st.created_at  AS settled_at,
			-- Any kind: after a settlement there is no rent or deposit left to
			-- tell apart, only money towards what they still owe.
			COALESCE((
				SELECT SUM(p.amount) FROM payments p
				WHERE p.stay_id = s.id AND p.is_approved = true AND p.created_at > st.created_at
			), 0) AS paid_after,
			(
				SELECT TO_CHAR(MAX(p.payment_date), 'YYYY-MM-DD') FROM payments p
				WHERE p.stay_id = s.id AND p.is_approved = true
			) AS last_payment_date
		FROM stays s
		JOIN tenants t            ON t.id = s.tenant_id
		JOIN settlements st       ON st.stay_id = s.id
		LEFT JOIN beds b          ON b.id = s.bed_id
		LEFT JOIN rooms r         ON r.id = b.room_id
		LEFT JOIN hostel_sites hs ON hs.id = r.site_id
		WHERE t.owner_id = $1
		  AND s.end_date IS NOT NULL
		  AND st.refund_paise < 0
	`, ownerID)
	return rows, err
}

// buildMovedOut turns settled shortfalls into chase-list rows, dropping any
// that have since been paid off. Biggest debt first, like the active list.
func buildMovedOut(stays []movedOutRow, today time.Time) []CollectionRow {
	rows := make([]CollectionRow, 0, len(stays))
	for _, s := range stays {
		owed := settledOwed(s.RefundPaise, s.PaidAfter)
		if owed == 0 {
			continue
		}
		days := int(dateOnly(today).Sub(dateOnly(s.SettledAt)).Hours() / 24)
		if days < 0 {
			days = 0
		}
		end := s.EndDate
		row := CollectionRow{
			StayID:       s.StayID,
			TenantID:     s.TenantID,
			TenantName:   s.TenantName,
			Phone:        s.Phone,
			SiteName:     s.SiteName,
			RoomName:     s.RoomName,
			RentAmount:   s.RentAmount,
			RentCycle:    s.RentCycle,
			BalancePaise: owed,
			DaysSinceDue: days,
			MovedOut:     true,
			EndDate:      &end,
		}
		if s.BedName.Valid {
			name := s.BedName.String
			row.BedName = &name
		}
		if s.LastPaymentDate.Valid {
			date := s.LastPaymentDate.String
			row.LastPaymentDate = &date
		}
		rows = append(rows, row)
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].BalancePaise != rows[j].BalancePaise {
			return rows[i].BalancePaise > rows[j].BalancePaise
		}
		return rows[i].DaysSinceDue > rows[j].DaysSinceDue
	})
	return rows
}

// movedOutTotal is what every settled-short tenant still owes, for the
// dashboard's Overdue figure.
func movedOutTotal(stays []movedOutRow) int64 {
	var total int64
	for _, s := range stays {
		total += settledOwed(s.RefundPaise, s.PaidAfter)
	}
	return total
}

// collectionStayRow is one active stay's billing inputs, as scanned from the DB.
type collectionStayRow struct {
	StayID          int64          `db:"stay_id"`
	TenantID        int64          `db:"tenant_id"`
	TenantName      string         `db:"tenant_name"`
	Phone           string         `db:"phone"`
	SiteName        string         `db:"site_name"`
	RoomName        string         `db:"room_name"`
	BedName         sql.NullString `db:"bed_name"`
	RentAmount      int64          `db:"rent_amount"`
	RentCycle       string         `db:"rent_cycle"`
	StartDate       time.Time      `db:"start_date"`
	TotalPaid       int64          `db:"total_paid"`
	LastPaymentDate sql.NullString `db:"last_payment_date"`
}

// cycleStart returns the date the nth billing cycle begins, counting the
// move-in day as cycle 1. It is the inverse of cyclesElapsed: for any n,
// cyclesElapsed(start, cycleStart(start, n, cycle), cycle) == n.
//
// Monthly cycles clamp to the last day of a short month, the same way
// cyclesElapsed clamps its anchor day — a stay starting the 31st begins its
// February cycle on the 28th (29th in a leap year).
func cycleStart(startDate time.Time, n int, cycle string) time.Time {
	if n < 1 {
		n = 1
	}
	switch cycle {
	case "weekly":
		return startDate.AddDate(0, 0, 7*(n-1))
	case "daily":
		return startDate.AddDate(0, 0, n-1)
	default: // monthly
		months := int(startDate.Month()) - 1 + (n - 1)
		year := startDate.Year() + months/12
		month := time.Month(months%12 + 1)

		day := startDate.Day()
		if last := daysInMonth(year, month); day > last {
			day = last
		}
		return time.Date(year, month, day, 0, 0, 0, 0, startDate.Location())
	}
}

// buildCollections turns active stays into the chase list: everyone with an
// outstanding balance, biggest debt first.
//
// DaysSinceDue is measured from the start of the FIRST UNPAID cycle, not from
// the current one — a tenant three cycles behind has been overdue since the
// oldest one, and that is the number worth putting in front of the owner (and
// in the nudge message). Whole cycles paid = totalPaid / rentAmount, so a
// part-payment does not clear the cycle it was made against.
func buildCollections(stays []collectionStayRow, today time.Time) []CollectionRow {
	rows := make([]CollectionRow, 0, len(stays))

	for _, s := range stays {
		cycles := cyclesElapsed(s.StartDate, today, s.RentCycle)
		balance := s.RentAmount*int64(cycles) - s.TotalPaid
		if balance <= 0 {
			continue // paid up, or in credit — not a collections problem
		}
		// balance > 0 implies rentAmount > 0, so the division below is safe.

		paidCycles := s.TotalPaid / s.RentAmount
		dueSince := cycleStart(s.StartDate, int(paidCycles)+1, s.RentCycle)
		daysSinceDue := int(today.Sub(dueSince).Hours() / 24)
		if daysSinceDue < 0 {
			daysSinceDue = 0
		}

		row := CollectionRow{
			StayID:       s.StayID,
			TenantID:     s.TenantID,
			TenantName:   s.TenantName,
			Phone:        s.Phone,
			SiteName:     s.SiteName,
			RoomName:     s.RoomName,
			RentAmount:   s.RentAmount,
			RentCycle:    s.RentCycle,
			BalancePaise: balance,
			DaysSinceDue: daysSinceDue,
		}
		if s.BedName.Valid {
			name := s.BedName.String
			row.BedName = &name
		}
		if s.LastPaymentDate.Valid {
			date := s.LastPaymentDate.String
			row.LastPaymentDate = &date
		}
		rows = append(rows, row)
	}

	// Biggest debt first; ties broken by who has been waiting longest, so the
	// order is stable regardless of what the database handed back.
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].BalancePaise != rows[j].BalancePaise {
			return rows[i].BalancePaise > rows[j].BalancePaise
		}
		return rows[i].DaysSinceDue > rows[j].DaysSinceDue
	})
	return rows
}

// GetCollections lists every active stay with money outstanding, then every
// tenant who moved out still owing — active rows first, each group biggest
// debt first. The page splits the two on MovedOut.
func (h *CollectionsHandler) GetCollections(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	today := time.Now().Truncate(24 * time.Hour)

	// Payment totals come from correlated subqueries, not a JOIN: joining
	// stays to payments yields one row per payment and multiplies the
	// per-stay figures by the payment count (the bug Phase 12a was written
	// after — see docs/PROGRESS.md).
	var stays []collectionStayRow
	err := h.db.Select(&stays, `
		SELECT
			s.id           AS stay_id,
			s.rent_amount,
			s.rent_cycle,
			s.start_date,
			t.id           AS tenant_id,
			t.name         AS tenant_name,
			t.phone,
			COALESCE(hs.name, '') AS site_name,
			COALESCE(r.name, '')  AS room_name,
			b.name         AS bed_name,
			-- Rent only, both of them: a deposit paid last week is not a rent
			-- payment last week, and must not make an arrears case look fresh.
			COALESCE((
				SELECT SUM(p.amount) FROM payments p
				WHERE p.stay_id = s.id AND p.is_approved = true AND p.kind = 'rent'
			), 0) AS total_paid,
			(
				SELECT TO_CHAR(MAX(p.payment_date), 'YYYY-MM-DD') FROM payments p
				WHERE p.stay_id = s.id AND p.is_approved = true AND p.kind = 'rent'
			) AS last_payment_date
		FROM stays s
		JOIN tenants t            ON t.id = s.tenant_id
		LEFT JOIN beds b          ON b.id = s.bed_id
		LEFT JOIN rooms r         ON r.id = b.room_id
		LEFT JOIN hostel_sites hs ON hs.id = r.site_id
		WHERE t.owner_id = $1
		  AND s.end_date IS NULL
	`, ownerID)
	if err != nil {
		return serverError(c, err, "failed to fetch collections")
	}

	movedOut, err := loadMovedOut(h.db, ownerID)
	if err != nil {
		return serverError(c, err, "failed to fetch moved-out balances")
	}

	return c.JSON(http.StatusOK, append(buildCollections(stays, today), buildMovedOut(movedOut, today)...))
}
