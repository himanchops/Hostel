package handlers

import (
	"testing"
	"time"
)

// Every fixture is read on the same day, mid-month: 11 August 2026. Mid-month
// matters for the same reason it does in dashboard_revenue_test.go — it puts
// the current month's window in a partial state, which is where the bed-night
// arithmetic is easiest to get wrong.
var insightsToday = date(2026, time.August, 11)

// ── monthWindows ─────────────────────────────────────────────────────────────

func TestMonthWindows_CurrentMonthStopsAtTomorrowNotMonthEnd(t *testing.T) {
	w := monthWindows(insightsToday, 3)
	if len(w) != 3 {
		t.Fatalf("got %d windows, want 3", len(w))
	}

	// Oldest first: June, July, August.
	if got, want := w[0][0], date(2026, time.June, 1); !got.Equal(want) {
		t.Errorf("first window starts %s, want %s", got, want)
	}
	// A whole month is a whole month.
	if got, want := w[1][1], date(2026, time.August, 1); !got.Equal(want) {
		t.Errorf("July window ends %s, want %s", got, want)
	}
	// The current month is clamped to tomorrow — 11 days of August, not 31.
	if got, want := w[2][1], date(2026, time.August, 12); !got.Equal(want) {
		t.Errorf("August window ends %s, want %s (tomorrow)", got, want)
	}
}

// ── Revenue series ───────────────────────────────────────────────────────────

// The last point of the series must equal the dashboard's ExpectedThisMonth for
// the same stay. Two screens quoting different numbers for the same month is a
// bug report waiting to happen, so it is pinned here rather than assumed.
func TestComputeRevenueSeries_LastMonthAgreesWithDashboard(t *testing.T) {
	const rent = 850000 // ₹8,500

	// Anchor on the 1st: August's cycle has rolled over.
	stay := insightStay{RoomID: 1, RentAmount: rent, RentCycle: "monthly",
		StartDate: date(2026, time.May, 1)}

	series := computeRevenueSeries([]insightStay{stay}, nil, insightsToday, 6)
	last := series[len(series)-1]

	dash := computeRevenue([]stayRevenueRow{{
		RentAmount: rent, RentCycle: "monthly",
		StartDate: date(2026, time.May, 1), TotalPaid: 0,
	}}, 0, insightsToday)

	if last.ExpectedPaise != dash.ExpectedThisMonth {
		t.Errorf("series expected %d, dashboard expected %d — they must agree",
			last.ExpectedPaise, dash.ExpectedThisMonth)
	}
	if last.ExpectedPaise != rent {
		t.Errorf("ExpectedPaise = %d, want %d (one cycle)", last.ExpectedPaise, rent)
	}
}

// A stay that ended in the middle of the range stops contributing to expected
// revenue after it ends — the tenant is gone, and billing a departed tenant
// would quietly inflate every month that follows.
func TestComputeRevenueSeries_EndedStayStopsBilling(t *testing.T) {
	const rent = 700000 // ₹7,000

	stay := insightStay{
		RoomID: 1, RentAmount: rent, RentCycle: "monthly",
		StartDate: date(2026, time.March, 10),
		EndDate:   ptr(date(2026, time.May, 20)),
	}

	// Mar, Apr, May, Jun, Jul, Aug.
	series := computeRevenueSeries([]insightStay{stay}, nil, insightsToday, 6)

	want := []int64{rent, rent, rent, 0, 0, 0}
	for i, w := range want {
		if series[i].ExpectedPaise != w {
			t.Errorf("%s expected = %d, want %d",
				series[i].Month, series[i].ExpectedPaise, w)
		}
	}
}

// Collected is keyed by the month the money actually arrived, so three months
// of arrears cleared in one payment show up as one tall bar — not smeared back
// over the months they were owed for.
func TestComputeRevenueSeries_ArrearsLandInThePayingMonth(t *testing.T) {
	const rent = 600000 // ₹6,000

	stay := insightStay{RoomID: 1, RentAmount: rent, RentCycle: "monthly",
		StartDate: date(2026, time.June, 1)}
	collected := map[string]int64{"2026-08": 3 * rent}

	series := computeRevenueSeries([]insightStay{stay}, collected, insightsToday, 3)

	if series[0].CollectedPaise != 0 || series[1].CollectedPaise != 0 {
		t.Errorf("June/July collected = %d/%d, want 0/0",
			series[0].CollectedPaise, series[1].CollectedPaise)
	}
	if series[2].CollectedPaise != 3*rent {
		t.Errorf("August collected = %d, want %d", series[2].CollectedPaise, 3*rent)
	}
	// Expected for August is still a single cycle — paying early or late does
	// not change what was billed.
	if series[2].ExpectedPaise != rent {
		t.Errorf("August expected = %d, want %d", series[2].ExpectedPaise, rent)
	}
}

// ── Occupancy series ─────────────────────────────────────────────────────────

// A bed occupied for the whole month is 100%; a mid-month move-in is worth its
// actual fraction. This is the case a month-end snapshot gets wrong.
func TestComputeOccupancySeries_MidMonthMoveInIsPartial(t *testing.T) {
	stays := []insightStay{
		// Occupies all of July (31 nights).
		{RoomID: 1, RentAmount: 1, RentCycle: "monthly",
			StartDate: date(2026, time.January, 1)},
		// Moves in 21 July — 11 nights of July's 31.
		{RoomID: 1, RentAmount: 1, RentCycle: "monthly",
			StartDate: date(2026, time.July, 21)},
	}

	series := computeOccupancySeries(stays, 2, insightsToday, 2) // July, August
	july := series[0]

	if july.AvailableNights != 62 { // 2 beds × 31 nights
		t.Fatalf("July available = %d, want 62", july.AvailableNights)
	}
	if july.OccupiedNights != 42 { // 31 + 11
		t.Errorf("July occupied = %d, want 42", july.OccupiedNights)
	}
	if got := july.Percentage; got < 67.7 || got > 67.8 {
		t.Errorf("July percentage = %.2f, want ~67.74", got)
	}
}

// The current month is measured against the days elapsed so far, so a full
// house reads 100% on the 11th rather than 35%.
func TestComputeOccupancySeries_PartialMonthUsesElapsedDays(t *testing.T) {
	stays := []insightStay{
		{RoomID: 1, RentAmount: 1, RentCycle: "monthly",
			StartDate: date(2026, time.January, 1)},
	}

	series := computeOccupancySeries(stays, 1, insightsToday, 1)
	aug := series[0]

	if aug.AvailableNights != 11 {
		t.Errorf("August available = %d, want 11 (1st–11th)", aug.AvailableNights)
	}
	if aug.OccupiedNights != 11 {
		t.Errorf("August occupied = %d, want 11", aug.OccupiedNights)
	}
	if aug.Percentage != 100 {
		t.Errorf("August percentage = %.2f, want 100", aug.Percentage)
	}
}

// A bed-less stay bills rent but sleeps nobody, so it must not inflate
// occupancy — otherwise approving a tenant before assigning them a room would
// make the building look fuller than it is.
func TestComputeOccupancySeries_BedlessStayOccupiesNothing(t *testing.T) {
	stays := []insightStay{
		{RoomID: 0, RentAmount: 500000, RentCycle: "monthly",
			StartDate: date(2026, time.January, 1)},
	}

	series := computeOccupancySeries(stays, 4, insightsToday, 1)
	if series[0].OccupiedNights != 0 {
		t.Errorf("occupied = %d, want 0 (stay has no bed)", series[0].OccupiedNights)
	}

	// It still bills, though.
	rev := computeRevenueSeries(stays, nil, insightsToday, 1)
	if rev[0].ExpectedPaise != 500000 {
		t.Errorf("expected = %d, want 500000 — a bed-less stay still bills",
			rev[0].ExpectedPaise)
	}
}

// ── Room insights ────────────────────────────────────────────────────────────

// The end_date is the tenant's last night, so a stay ending on the 10th
// occupies ten nights of that month, not nine.
func TestComputeRoomInsights_EndDateIsInclusive(t *testing.T) {
	rooms := []insightRoom{
		{RoomID: 1, RoomName: "Room 1", SiteID: 1, SiteName: "Site", TotalBeds: 2},
	}
	stays := []insightStay{
		{RoomID: 1, RentAmount: 1, RentCycle: "monthly",
			StartDate: date(2026, time.July, 1),
			EndDate:   ptr(date(2026, time.July, 10))},
	}

	from, to := date(2026, time.July, 1), date(2026, time.August, 1)
	got := computeRoomInsights(rooms, stays, map[int64]int64{1: 250000}, from, to)

	if len(got) != 1 {
		t.Fatalf("got %d rooms, want 1", len(got))
	}
	r := got[0]
	if r.AvailableNights != 62 { // 2 beds × 31 nights
		t.Fatalf("available = %d, want 62", r.AvailableNights)
	}
	if r.OccupiedNights != 10 {
		t.Errorf("occupied = %d, want 10 (1st–10th inclusive)", r.OccupiedNights)
	}
	if r.VacantNights != 52 {
		t.Errorf("vacant = %d, want 52", r.VacantNights)
	}
	if r.CollectedPaise != 250000 {
		t.Errorf("collected = %d, want 250000", r.CollectedPaise)
	}
}

// A room with no beds is reported, not dropped. It earns nothing, and hiding it
// hides the reason.
func TestComputeRoomInsights_BedlessRoomIsReportedAtZero(t *testing.T) {
	rooms := []insightRoom{
		{RoomID: 9, RoomName: "Room 9", SiteID: 1, SiteName: "Site", TotalBeds: 0},
	}

	from, to := date(2026, time.July, 1), date(2026, time.August, 1)
	got := computeRoomInsights(rooms, nil, nil, from, to)

	if len(got) != 1 {
		t.Fatalf("got %d rooms, want 1 — an empty room must still be listed", len(got))
	}
	if got[0].AvailableNights != 0 || got[0].Percentage != 0 {
		t.Errorf("available = %d, percentage = %.2f, want 0 and 0 (no divide by zero)",
			got[0].AvailableNights, got[0].Percentage)
	}
}
