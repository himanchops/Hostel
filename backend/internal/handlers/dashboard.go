package handlers

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/labstack/echo/v4"
	appMiddleware "github.com/winnow/hostel/internal/middleware"
)

type DashboardHandler struct {
	db *sqlx.DB
}

func NewDashboardHandler(db *sqlx.DB) *DashboardHandler {
	return &DashboardHandler{db: db}
}

// ── Response shapes ──────────────────────────────────────────────────────────

type SiteOccupancy struct {
	SiteID       int64   `json:"site_id"       db:"site_id"`
	SiteName     string  `json:"site_name"     db:"site_name"`
	TotalBeds    int     `json:"total_beds"    db:"total_beds"`
	OccupiedBeds int     `json:"occupied_beds" db:"occupied_beds"`
	Percentage   float64 `json:"percentage"`
}

type OccupancySummary struct {
	Sites        []SiteOccupancy `json:"sites"`
	TotalBeds    int             `json:"total_beds"`
	OccupiedBeds int             `json:"occupied_beds"`
	Percentage   float64         `json:"percentage"`
}

type RevenueSummary struct {
	ExpectedThisMonth  int64 `json:"expected_this_month"`
	CollectedThisMonth int64 `json:"collected_this_month"`
	OverdueAmount      int64 `json:"overdue_amount"`
}

type AlertsSummary struct {
	PendingTenants  int `json:"pending_tenants"`
	PendingPayments int `json:"pending_payments"`
}

type VacatingTenant struct {
	TenantName  string  `json:"tenant_name"  db:"tenant_name"`
	TenantPhone string  `json:"tenant_phone" db:"tenant_phone"`
	BedName     string  `json:"bed_name"     db:"bed_name"`
	RoomName    string  `json:"room_name"    db:"room_name"`
	SiteName    string  `json:"site_name"    db:"site_name"`
	NoticeDate  *string `json:"notice_date"  db:"notice_date"`
	EndDate     *string `json:"end_date"     db:"end_date"`
}

type RecentPayment struct {
	ID          int64  `json:"id"           db:"id"`
	Amount      int64  `json:"amount"       db:"amount"`
	PaymentType string `json:"payment_type" db:"payment_type"`
	PaymentDate string `json:"payment_date" db:"payment_date"`
	TenantName  string `json:"tenant_name"  db:"tenant_name"`
	BedName     string `json:"bed_name"     db:"bed_name"`
	RoomName    string `json:"room_name"    db:"room_name"`
	SiteName    string `json:"site_name"    db:"site_name"`
}

type DashboardResponse struct {
	Occupancy      OccupancySummary `json:"occupancy"`
	Revenue        RevenueSummary   `json:"revenue"`
	Alerts         AlertsSummary    `json:"alerts"`
	VacatingSoon   []VacatingTenant `json:"vacating_soon"`
	RecentPayments []RecentPayment  `json:"recent_payments"`
}

// ── Handler ──────────────────────────────────────────────────────────────────

func (h *DashboardHandler) GetDashboard(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	today := time.Now().Truncate(24 * time.Hour)

	// 1. Occupancy per site
	type siteOccRow struct {
		SiteID       int64  `db:"site_id"`
		SiteName     string `db:"site_name"`
		TotalBeds    int    `db:"total_beds"`
		OccupiedBeds int    `db:"occupied_beds"`
	}
	var siteRows []siteOccRow
	err := h.db.Select(&siteRows, `
		SELECT
			hs.id         AS site_id,
			hs.name       AS site_name,
			COUNT(b.id)   AS total_beds,
			COUNT(s.id)   AS occupied_beds
		FROM hostel_sites hs
		JOIN rooms r       ON r.site_id = hs.id
		JOIN beds b        ON b.room_id = r.id
		LEFT JOIN stays s  ON s.bed_id = b.id AND s.end_date IS NULL
		WHERE hs.owner_id = $1
		GROUP BY hs.id, hs.name
		ORDER BY hs.name
	`, ownerID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, errorResponse("failed to fetch occupancy"))
	}

	occupancy := OccupancySummary{Sites: []SiteOccupancy{}}
	for _, r := range siteRows {
		pct := 0.0
		if r.TotalBeds > 0 {
			pct = float64(r.OccupiedBeds) / float64(r.TotalBeds) * 100
		}
		occupancy.Sites = append(occupancy.Sites, SiteOccupancy{
			SiteID:       r.SiteID,
			SiteName:     r.SiteName,
			TotalBeds:    r.TotalBeds,
			OccupiedBeds: r.OccupiedBeds,
			Percentage:   pct,
		})
		occupancy.TotalBeds += r.TotalBeds
		occupancy.OccupiedBeds += r.OccupiedBeds
	}
	if occupancy.TotalBeds > 0 {
		occupancy.Percentage = float64(occupancy.OccupiedBeds) / float64(occupancy.TotalBeds) * 100
	}

	// 2. Collected this month
	var collectedThisMonth int64
	firstOfMonth := time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, today.Location())
	nextMonth := firstOfMonth.AddDate(0, 1, 0)
	err = h.db.Get(&collectedThisMonth, `
		SELECT COALESCE(SUM(p.amount), 0)
		FROM payments p
		JOIN stays s   ON s.id = p.stay_id
		JOIN tenants t ON t.id = s.tenant_id
		WHERE t.owner_id = $1
		  AND p.is_approved = true
		  AND p.payment_date >= $2
		  AND p.payment_date <  $3
	`, ownerID, firstOfMonth.Format("2006-01-02"), nextMonth.Format("2006-01-02"))
	if err != nil {
		return c.JSON(http.StatusInternalServerError, errorResponse("failed to fetch revenue"))
	}

	// 3. Active stays for expected/overdue calculation
	type stayCalcRow struct {
		RentAmount int64          `db:"rent_amount"`
		RentCycle  string         `db:"rent_cycle"`
		StartDate  time.Time      `db:"start_date"`
		TotalPaid  int64          `db:"total_paid"`
	}
	var stayRows []stayCalcRow
	err = h.db.Select(&stayRows, `
		SELECT
			s.rent_amount,
			s.rent_cycle,
			s.start_date,
			COALESCE(SUM(p.amount) FILTER (WHERE p.is_approved = true), 0) AS total_paid
		FROM stays s
		JOIN tenants t ON t.id = s.tenant_id
		LEFT JOIN payments p ON p.stay_id = s.id
		WHERE t.owner_id = $1
		  AND s.end_date IS NULL
		GROUP BY s.id, s.rent_amount, s.rent_cycle, s.start_date
	`, ownerID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, errorResponse("failed to fetch stay data"))
	}

	endOfLastMonth := firstOfMonth.Add(-24 * time.Hour)
	var expectedThisMonth, overdueAmount int64
	for _, row := range stayRows {
		cyclesTotal := cyclesElapsed(row.StartDate, today, row.RentCycle)
		totalExpected := row.RentAmount * int64(cyclesTotal)

		// Overdue: amount owed across all time
		if totalExpected > row.TotalPaid {
			overdueAmount += totalExpected - row.TotalPaid
		}

		// Expected this month: cycles added during current calendar month
		cyclesBeforeMonth := cyclesElapsed(row.StartDate, endOfLastMonth, row.RentCycle)
		cyclesThisMonth := cyclesTotal - cyclesBeforeMonth
		if cyclesThisMonth < 0 {
			cyclesThisMonth = 0
		}
		expectedThisMonth += row.RentAmount * int64(cyclesThisMonth)
	}

	// 4. Pending counts
	var pendingTenants, pendingPayments int
	err = h.db.QueryRowx(`
		SELECT
			(SELECT COUNT(*) FROM tenants WHERE owner_id = $1 AND is_approved = false) AS pending_tenants,
			(SELECT COUNT(*) FROM payments p
			 JOIN stays s  ON s.id = p.stay_id
			 JOIN tenants t ON t.id = s.tenant_id
			 WHERE t.owner_id = $1 AND p.is_approved = false) AS pending_payments
	`, ownerID).Scan(&pendingTenants, &pendingPayments)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, errorResponse("failed to fetch alerts"))
	}

	// 5. Vacating soon
	type vacatingRow struct {
		TenantName  string         `db:"tenant_name"`
		TenantPhone string         `db:"tenant_phone"`
		BedName     string         `db:"bed_name"`
		RoomName    string         `db:"room_name"`
		SiteName    string         `db:"site_name"`
		NoticeDate  sql.NullString `db:"notice_date"`
		EndDate     sql.NullString `db:"end_date"`
	}
	var vacRows []vacatingRow
	err = h.db.Select(&vacRows, `
		SELECT
			t.name        AS tenant_name,
			t.phone       AS tenant_phone,
			b.name        AS bed_name,
			r.name        AS room_name,
			hs.name       AS site_name,
			TO_CHAR(s.notice_date, 'YYYY-MM-DD') AS notice_date,
			TO_CHAR(s.end_date,   'YYYY-MM-DD') AS end_date
		FROM stays s
		JOIN tenants t       ON t.id = s.tenant_id
		JOIN beds b          ON b.id = s.bed_id
		JOIN rooms r         ON r.id = b.room_id
		JOIN hostel_sites hs ON hs.id = r.site_id
		WHERE t.owner_id = $1
		  AND s.end_date IS NULL
		  AND (
		      s.notice_date IS NOT NULL
		      OR s.end_date <= CURRENT_DATE + INTERVAL '30 days'
		  )
		ORDER BY s.notice_date ASC NULLS LAST
		LIMIT 10
	`, ownerID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, errorResponse("failed to fetch vacating tenants"))
	}

	vacating := make([]VacatingTenant, 0, len(vacRows))
	for _, r := range vacRows {
		v := VacatingTenant{
			TenantName:  r.TenantName,
			TenantPhone: r.TenantPhone,
			BedName:     r.BedName,
			RoomName:    r.RoomName,
			SiteName:    r.SiteName,
		}
		if r.NoticeDate.Valid {
			v.NoticeDate = &r.NoticeDate.String
		}
		if r.EndDate.Valid {
			v.EndDate = &r.EndDate.String
		}
		vacating = append(vacating, v)
	}

	// 6. Recent payments
	type recentRow struct {
		ID          int64  `db:"id"`
		Amount      int64  `db:"amount"`
		PaymentType string `db:"payment_type"`
		PaymentDate string `db:"payment_date"`
		TenantName  string `db:"tenant_name"`
		BedName     string `db:"bed_name"`
		RoomName    string `db:"room_name"`
		SiteName    string `db:"site_name"`
	}
	var recentRows []recentRow
	err = h.db.Select(&recentRows, `
		SELECT
			p.id,
			p.amount,
			p.payment_type::text AS payment_type,
			TO_CHAR(p.payment_date, 'YYYY-MM-DD') AS payment_date,
			t.name        AS tenant_name,
			b.name        AS bed_name,
			r.name        AS room_name,
			hs.name       AS site_name
		FROM payments p
		JOIN stays s        ON s.id = p.stay_id
		JOIN tenants t      ON t.id = s.tenant_id
		JOIN beds b         ON b.id = s.bed_id
		JOIN rooms r        ON r.id = b.room_id
		JOIN hostel_sites hs ON hs.id = r.site_id
		WHERE t.owner_id = $1
		  AND p.is_approved = true
		ORDER BY p.payment_date DESC, p.created_at DESC
		LIMIT 10
	`, ownerID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, errorResponse("failed to fetch recent payments"))
	}

	recent := make([]RecentPayment, 0, len(recentRows))
	for _, r := range recentRows {
		recent = append(recent, RecentPayment{
			ID:          r.ID,
			Amount:      r.Amount,
			PaymentType: r.PaymentType,
			PaymentDate: r.PaymentDate,
			TenantName:  r.TenantName,
			BedName:     r.BedName,
			RoomName:    r.RoomName,
			SiteName:    r.SiteName,
		})
	}

	return c.JSON(http.StatusOK, DashboardResponse{
		Occupancy: occupancy,
		Revenue: RevenueSummary{
			ExpectedThisMonth:  expectedThisMonth,
			CollectedThisMonth: collectedThisMonth,
			OverdueAmount:      overdueAmount,
		},
		Alerts: AlertsSummary{
			PendingTenants:  pendingTenants,
			PendingPayments: pendingPayments,
		},
		VacatingSoon:   vacating,
		RecentPayments: recent,
	})
}
