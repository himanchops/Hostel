package handlers

import (
	"testing"
	"time"
)

// Billing cycles are anchored to the stay's start date, not to a calendar
// month boundary: a tenant who moves in on the 20th rolls over on the 20th.
func TestCyclesElapsed_AnchoredToJoinDate(t *testing.T) {
	start := date(2026, time.January, 20)

	tests := []struct {
		name  string
		today time.Time
		want  int
	}{
		{"move-in day counts as cycle 1", date(2026, time.January, 20), 1},
		{"mid-cycle stays at 1", date(2026, time.February, 5), 1},
		{"day before rollover", date(2026, time.February, 19), 1},
		{"rollover on the 20th", date(2026, time.February, 20), 2},
		{"third cycle", date(2026, time.March, 20), 3},
		{"before the stay started", date(2026, time.January, 19), 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := cyclesElapsed(start, tt.today, "monthly"); got != tt.want {
				t.Errorf("cyclesElapsed(%s) = %d, want %d", tt.today.Format("2006-01-02"), got, tt.want)
			}
		})
	}
}

// Documents current behaviour for month-end move-ins. A stay starting on the
// 31st never sees a day >= 31 in a short month, so the cycle does not roll over
// within that month — the tenant is not charged for it.
//
// NOTE: this encodes a known rough edge rather than endorsing it. If the rule
// changes to "clamp to the last day of a short month", update this test.
func TestCyclesElapsed_MonthEndMoveIn(t *testing.T) {
	start := date(2026, time.January, 31)

	tests := []struct {
		name  string
		today time.Time
		want  int
	}{
		{"move-in day", date(2026, time.January, 31), 1},
		{"end of February — no 31st exists, so no rollover", date(2026, time.February, 28), 1},
		{"March 30 — still no rollover", date(2026, time.March, 30), 2},
		{"March 31 — rolls over", date(2026, time.March, 31), 3},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := cyclesElapsed(start, tt.today, "monthly"); got != tt.want {
				t.Errorf("cyclesElapsed(%s) = %d, want %d", tt.today.Format("2006-01-02"), got, tt.want)
			}
		})
	}
}

func TestCyclesElapsed_WeeklyAndDaily(t *testing.T) {
	start := date(2026, time.January, 1)

	weekly := []struct {
		today time.Time
		want  int
	}{
		{date(2026, time.January, 1), 1},
		{date(2026, time.January, 7), 1},
		{date(2026, time.January, 8), 2},
		{date(2026, time.January, 15), 3},
	}
	for _, tt := range weekly {
		if got := cyclesElapsed(start, tt.today, "weekly"); got != tt.want {
			t.Errorf("weekly cyclesElapsed(%s) = %d, want %d", tt.today.Format("2006-01-02"), got, tt.want)
		}
	}

	daily := []struct {
		today time.Time
		want  int
	}{
		{date(2026, time.January, 1), 1},
		{date(2026, time.January, 2), 2},
		{date(2026, time.January, 10), 10},
	}
	for _, tt := range daily {
		if got := cyclesElapsed(start, tt.today, "daily"); got != tt.want {
			t.Errorf("daily cyclesElapsed(%s) = %d, want %d", tt.today.Format("2006-01-02"), got, tt.want)
		}
	}
}

// A backfilled vacate date (owner records the departure a few days late) must
// bill only up to the actual end date, not to today.
func TestSummary_BackfilledEndDateStopsBilling(t *testing.T) {
	today := date(2026, time.August, 11)
	start := date(2026, time.February, 20)
	vacatedSixDaysAgo := date(2026, time.August, 5)

	backfilled := summarize([]staySummaryInput{
		{RentAmount: 600000, RentCycle: "monthly", StartDate: start,
			EndDate: &vacatedSixDaysAgo, TotalPaid: 0},
	}, today)

	// 2026-02-20 → 2026-08-05: rollovers on the 20th of Mar–Jul, so 6 cycles.
	if want := int64(600000 * 6); backfilled.TotalExpected != want {
		t.Errorf("TotalExpected = %d, want %d", backfilled.TotalExpected, want)
	}
	// Feb 20 → Aug 5 is 166 days; billing must not run to today (Aug 11).
	if backfilled.DurationDays != 166 {
		t.Errorf("DurationDays = %d, want 166", backfilled.DurationDays)
	}

	stillActive := summarize([]staySummaryInput{
		{RentAmount: 600000, RentCycle: "monthly", StartDate: start, TotalPaid: 0},
	}, today)
	if stillActive.DurationDays <= backfilled.DurationDays {
		t.Error("an open stay should accrue more days than one backfilled to an earlier end date")
	}
}
