package handlers

import (
	"net/http"
	"strconv"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/labstack/echo/v4"
	appMiddleware "github.com/winnow/hostel/internal/middleware"
)

type InsightsHandler struct {
	db *sqlx.DB
}

func NewInsightsHandler(db *sqlx.DB) *InsightsHandler {
	return &InsightsHandler{db: db}
}

// ── Response shapes ──────────────────────────────────────────────────────────

// RevenuePoint is one month on the collected-vs-expected chart.
type RevenuePoint struct {
	Month          string `json:"month"`           // "2026-09", sortable
	Label          string `json:"label"`           // "Sep 26", for the axis
	ExpectedPaise  int64  `json:"expected_paise"`
	CollectedPaise int64  `json:"collected_paise"`
}

// OccupancyPoint is one month on the occupancy chart, measured in bed-nights
// rather than a month-end headcount — see computeOccupancySeries.
type OccupancyPoint struct {
	Month           string  `json:"month"`
	Label           string  `json:"label"`
	OccupiedNights  int     `json:"occupied_nights"`
	AvailableNights int     `json:"available_nights"`
	Percentage      float64 `json:"percentage"`
}

// RoomInsight is one room's performance over the requested window.
type RoomInsight struct {
	RoomID          int64   `json:"room_id"`
	RoomName        string  `json:"room_name"`
	SiteID          int64   `json:"site_id"`
	SiteName        string  `json:"site_name"`
	TotalBeds       int     `json:"total_beds"`
	OccupiedNights  int     `json:"occupied_nights"`
	AvailableNights int     `json:"available_nights"`
	VacantNights    int     `json:"vacant_nights"`
	Percentage      float64 `json:"percentage"`
	CollectedPaise  int64   `json:"collected_paise"`
}

// ── Internal row shapes ──────────────────────────────────────────────────────

// insightStay is one stay's billing and occupancy inputs. RoomID is 0 for a
// bed-less stay: it still bills rent, so it counts toward revenue, but it
// occupies no bed and so contributes nothing to occupancy.
type insightStay struct {
	RoomID     int64      `db:"room_id"`
	RentAmount int64      `db:"rent_amount"`
	RentCycle  string     `db:"rent_cycle"`
	StartDate  time.Time  `db:"start_date"`
	EndDate    *time.Time `db:"end_date"`
}

type monthlyPaid struct {
	Month  string `db:"month"`
	Amount int64  `db:"amount"`
}

type roomPaid struct {
	RoomID int64 `db:"room_id"`
	Amount int64 `db:"amount"`
}

type insightRoom struct {
	RoomID    int64  `db:"room_id"`
	RoomName  string `db:"room_name"`
	SiteID    int64  `db:"site_id"`
	SiteName  string `db:"site_name"`
	TotalBeds int    `db:"total_beds"`
}

// ── Date helpers ─────────────────────────────────────────────────────────────

func monthStart(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC)
}

// monthWindows returns the n calendar months ending with the one containing
// `today`, oldest first, as half-open [start, end) pairs.
//
// The final window is clamped to tomorrow rather than running to month-end: the
// current month is still in progress, and charting a partial month against a
// full month's denominator would draw a cliff every 1st of the month that has
// nothing to do with the business.
func monthWindows(today time.Time, n int) [][2]time.Time {
	if n < 1 {
		n = 1
	}
	today = dateOnly(today)
	tomorrow := today.AddDate(0, 0, 1)
	first := monthStart(today).AddDate(0, -(n - 1), 0)

	windows := make([][2]time.Time, 0, n)
	for i := 0; i < n; i++ {
		start := first.AddDate(0, i, 0)
		end := start.AddDate(0, 1, 0)
		if end.After(tomorrow) {
			end = tomorrow
		}
		windows = append(windows, [2]time.Time{start, end})
	}
	return windows
}

// overlapDays counts whole days shared by two half-open date ranges.
func overlapDays(aStart, aEnd, bStart, bEnd time.Time) int {
	start := aStart
	if bStart.After(start) {
		start = bStart
	}
	end := aEnd
	if bEnd.Before(end) {
		end = bEnd
	}
	if !end.After(start) {
		return 0
	}
	return int(end.Sub(start).Hours() / 24)
}

// stayWindow returns the half-open [start, end) span a stay occupies. end_date
// is the tenant's last day, so the exclusive end is the day after it; an
// ongoing stay runs to `openEnd`.
func stayWindow(s insightStay, openEnd time.Time) (time.Time, time.Time) {
	start := dateOnly(s.StartDate)
	end := openEnd
	if s.EndDate != nil {
		end = dateOnly(*s.EndDate).AddDate(0, 0, 1)
	}
	return start, end
}

// billedCycles is how many rent cycles a stay had been charged by `asOf`,
// clamped to the stay's own end so a moved-out tenant stops accruing.
func billedCycles(s insightStay, asOf time.Time) int {
	if s.EndDate != nil {
		if end := dateOnly(*s.EndDate); asOf.After(end) {
			asOf = end
		}
	}
	if asOf.Before(dateOnly(s.StartDate)) {
		return 0
	}
	return cyclesElapsed(dateOnly(s.StartDate), asOf, s.RentCycle)
}

// ── Pure computations ────────────────────────────────────────────────────────

// computeRevenueSeries builds the collected-vs-expected series.
//
// Expected is derived the same way the dashboard's single figure is — by
// differencing billing cycles across the month boundary rather than by
// pro-rating — so the last point on this chart equals the dashboard's
// "expected this month" card. Two screens disagreeing about the same month is
// worse than either number being debatable on its own.
//
// Collected comes from the payments table keyed by calendar month, so a tenant
// paying three months of arrears in one go shows the whole payment in the month
// they actually paid. That is deliberate: this chart answers "what came in",
// and the gap against expected is the point of drawing them together.
func computeRevenueSeries(stays []insightStay, collected map[string]int64, today time.Time, months int) []RevenuePoint {
	windows := monthWindows(today, months)
	points := make([]RevenuePoint, 0, len(windows))

	for _, w := range windows {
		start, end := w[0], w[1]
		key := start.Format("2006-01")

		// Cycles billed by the last day of this window, minus those billed by
		// the day before it opened.
		asOf := end.AddDate(0, 0, -1)
		before := start.AddDate(0, 0, -1)

		var expected int64
		for _, s := range stays {
			added := billedCycles(s, asOf) - billedCycles(s, before)
			if added > 0 {
				expected += s.RentAmount * int64(added)
			}
		}

		points = append(points, RevenuePoint{
			Month:          key,
			Label:          start.Format("Jan 06"),
			ExpectedPaise:  expected,
			CollectedPaise: collected[key],
		})
	}
	return points
}

// computeOccupancySeries measures each month in bed-nights, not in a headcount
// taken on some particular day.
//
// A month-end snapshot would score a bed that turned over on the 2nd exactly
// the same as one that sat empty until the 30th, which is the opposite of what
// an owner wants to know. Bed-nights make a mid-month move-in worth its actual
// fraction of the month.
//
// The denominator is the bed count as it stands TODAY, applied to every month
// in the range — not the beds' created_at. This app is explicitly built for
// backfilled data, so a bed row entered this morning may describe a bed that
// has existed for years; created_at records when someone typed it in, which is
// not a fact about the building. The cost of this choice is that adding a room
// today rewrites history, making past months look emptier than they were.
func computeOccupancySeries(stays []insightStay, totalBeds int, today time.Time, months int) []OccupancyPoint {
	windows := monthWindows(today, months)
	tomorrow := dateOnly(today).AddDate(0, 0, 1)
	points := make([]OccupancyPoint, 0, len(windows))

	for _, w := range windows {
		start, end := w[0], w[1]

		occupied := 0
		for _, s := range stays {
			if s.RoomID == 0 {
				continue // bed-less: bills rent, occupies nothing
			}
			sStart, sEnd := stayWindow(s, tomorrow)
			occupied += overlapDays(sStart, sEnd, start, end)
		}

		available := totalBeds * overlapDays(start, end, start, end)
		pct := 0.0
		if available > 0 {
			pct = float64(occupied) / float64(available) * 100
		}

		points = append(points, OccupancyPoint{
			Month:           start.Format("2006-01"),
			Label:           start.Format("Jan 06"),
			OccupiedNights:  occupied,
			AvailableNights: available,
			Percentage:      pct,
		})
	}
	return points
}

// computeRoomInsights scores each room over one window: how much of its
// capacity was slept in, and how much money came in against it.
//
// Rooms with no beds are kept rather than dropped. A room someone set up and
// never put beds in is worth seeing on this list — it is earning nothing, and
// silently omitting it hides the reason.
func computeRoomInsights(
	rooms []insightRoom,
	stays []insightStay,
	collected map[int64]int64,
	from, to time.Time,
) []RoomInsight {
	days := overlapDays(from, to, from, to)

	occupiedByRoom := map[int64]int{}
	for _, s := range stays {
		if s.RoomID == 0 {
			continue
		}
		sStart, sEnd := stayWindow(s, to)
		if n := overlapDays(sStart, sEnd, from, to); n > 0 {
			occupiedByRoom[s.RoomID] += n
		}
	}

	out := make([]RoomInsight, 0, len(rooms))
	for _, r := range rooms {
		available := r.TotalBeds * days
		occupied := occupiedByRoom[r.RoomID]
		pct := 0.0
		if available > 0 {
			pct = float64(occupied) / float64(available) * 100
		}
		vacant := available - occupied
		if vacant < 0 {
			vacant = 0
		}
		out = append(out, RoomInsight{
			RoomID:          r.RoomID,
			RoomName:        r.RoomName,
			SiteID:          r.SiteID,
			SiteName:        r.SiteName,
			TotalBeds:       r.TotalBeds,
			OccupiedNights:  occupied,
			AvailableNights: available,
			VacantNights:    vacant,
			Percentage:      pct,
			CollectedPaise:  collected[r.RoomID],
		})
	}
	return out
}

// ── Handler ──────────────────────────────────────────────────────────────────

// InsightsResponse is all three views in one payload.
//
// One endpoint rather than three because they share a window: fetching them
// separately invites a frontend that renders a 12-month revenue chart above a
// 6-month room table and calls it a dashboard.
type InsightsResponse struct {
	Months    int              `json:"months"`
	FromDate  string           `json:"from_date"`
	ToDate    string           `json:"to_date"`
	Revenue   []RevenuePoint   `json:"revenue"`
	Occupancy []OccupancyPoint `json:"occupancy"`
	Rooms     []RoomInsight    `json:"rooms"`
}

const (
	defaultInsightMonths = 12
	maxInsightMonths     = 24
)

func (h *InsightsHandler) GetInsights(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	today := dateOnly(time.Now())

	months := defaultInsightMonths
	if raw := c.QueryParam("months"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > maxInsightMonths {
			return c.JSON(http.StatusBadRequest,
				errorResponse("months must be a whole number between 1 and 24"))
		}
		months = n
	}

	windows := monthWindows(today, months)
	from, to := windows[0][0], windows[len(windows)-1][1]

	// Every stay the owner has ever had, ended ones included — this is history,
	// not a current-state view. LEFT JOIN because a bed-less stay still bills.
	var stays []insightStay
	err := h.db.Select(&stays, `
		SELECT COALESCE(r.id, 0) AS room_id,
		       s.rent_amount, s.rent_cycle, s.start_date, s.end_date
		FROM stays s
		JOIN tenants t   ON t.id = s.tenant_id
		LEFT JOIN beds b ON b.id = s.bed_id
		LEFT JOIN rooms r ON r.id = b.room_id
		WHERE t.owner_id = $1
	`, ownerID)
	if err != nil {
		return serverError(c, err, "failed to load stays for insights")
	}

	var monthly []monthlyPaid
	err = h.db.Select(&monthly, `
		SELECT to_char(p.payment_date, 'YYYY-MM') AS month,
		       COALESCE(SUM(p.amount), 0) AS amount
		FROM payments p
		JOIN stays s   ON s.id = p.stay_id
		JOIN tenants t ON t.id = s.tenant_id
		WHERE t.owner_id = $1
		  AND p.is_approved = true
		  AND p.payment_date >= $2
		  AND p.payment_date <  $3
		GROUP BY 1
	`, ownerID, from.Format("2006-01-02"), to.Format("2006-01-02"))
	if err != nil {
		return serverError(c, err, "failed to load monthly payments")
	}
	collectedByMonth := make(map[string]int64, len(monthly))
	for _, m := range monthly {
		collectedByMonth[m.Month] = m.Amount
	}

	var totalBeds int
	err = h.db.Get(&totalBeds, `
		SELECT COUNT(*)
		FROM beds b
		JOIN rooms r        ON r.id = b.room_id
		JOIN hostel_sites hs ON hs.id = r.site_id
		WHERE hs.owner_id = $1
	`, ownerID)
	if err != nil {
		return serverError(c, err, "failed to count beds")
	}

	var rooms []insightRoom
	err = h.db.Select(&rooms, `
		SELECT r.id AS room_id, r.name AS room_name,
		       hs.id AS site_id, hs.name AS site_name,
		       COUNT(b.id) AS total_beds
		FROM rooms r
		JOIN hostel_sites hs ON hs.id = r.site_id
		LEFT JOIN beds b     ON b.room_id = r.id
		WHERE hs.owner_id = $1
		GROUP BY r.id, r.name, hs.id, hs.name
		ORDER BY hs.name, r.name
	`, ownerID)
	if err != nil {
		return serverError(c, err, "failed to load rooms for insights")
	}

	var perRoom []roomPaid
	err = h.db.Select(&perRoom, `
		SELECT COALESCE(r.id, 0) AS room_id,
		       COALESCE(SUM(p.amount), 0) AS amount
		FROM payments p
		JOIN stays s     ON s.id = p.stay_id
		JOIN tenants t   ON t.id = s.tenant_id
		LEFT JOIN beds b ON b.id = s.bed_id
		LEFT JOIN rooms r ON r.id = b.room_id
		WHERE t.owner_id = $1
		  AND p.is_approved = true
		  AND p.payment_date >= $2
		  AND p.payment_date <  $3
		GROUP BY 1
	`, ownerID, from.Format("2006-01-02"), to.Format("2006-01-02"))
	if err != nil {
		return serverError(c, err, "failed to load per-room payments")
	}
	collectedByRoom := make(map[int64]int64, len(perRoom))
	for _, r := range perRoom {
		collectedByRoom[r.RoomID] = r.Amount
	}

	return c.JSON(http.StatusOK, InsightsResponse{
		Months:    months,
		FromDate:  from.Format("2006-01-02"),
		ToDate:    to.AddDate(0, 0, -1).Format("2006-01-02"),
		Revenue:   computeRevenueSeries(stays, collectedByMonth, today, months),
		Occupancy: computeOccupancySeries(stays, totalBeds, today, months),
		Rooms:     computeRoomInsights(rooms, stays, collectedByRoom, from, to),
	})
}
