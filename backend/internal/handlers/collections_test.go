package handlers

import (
	"database/sql"
	"testing"
	"time"
)

// Mid-month, so anchor days fall on both sides of today.
var collectionsToday = date(2026, time.August, 11)

// stay builds one active stay's billing inputs. Callers override what matters.
func stay(rent int64, cycle string, start time.Time, paid int64) collectionStayRow {
	return collectionStayRow{
		StayID:     1,
		TenantID:   1,
		TenantName: "Asha Rao",
		Phone:      "9812345601",
		SiteName:   "Sunrise PG",
		RoomName:   "101",
		BedName:    nullStr("A"),
		RentAmount: rent,
		RentCycle:  cycle,
		StartDate:  start,
		TotalPaid:  paid,
	}
}

// cycleStart and cyclesElapsed have to agree, or "days overdue" drifts from the
// balance that sits next to it on the page. Walking one against the other is
// the cheapest way to keep them honest — including for a month-end move-in,
// where both have to clamp the anchor day the same way.
func TestCycleStart_IsInverseOfCyclesElapsed(t *testing.T) {
	starts := map[string]time.Time{
		"mid-month": date(2026, time.February, 20),
		"month-end": date(2026, time.January, 31),
		"the 30th":  date(2026, time.April, 30),
		"leap year": date(2028, time.January, 31),
		"first-of":  date(2026, time.May, 1),
	}

	for name, start := range starts {
		for _, cycle := range []string{"monthly", "weekly", "daily"} {
			for n := 1; n <= 14; n++ {
				begins := cycleStart(start, n, cycle)
				if got := cyclesElapsed(start, begins, cycle); got != n {
					t.Errorf("%s %s: cycle %d begins %s, but cyclesElapsed reads that as cycle %d",
						name, cycle, n, begins.Format("2006-01-02"), got)
				}
			}
		}
	}
}

// A stay starting the 31st bills February on the 28th — there is no 31st to
// roll over on, and skipping the month would be a free month's rent.
func TestCycleStart_MonthEndClamping(t *testing.T) {
	start := date(2026, time.January, 31)

	tests := []struct {
		cycle int
		want  time.Time
	}{
		{1, date(2026, time.January, 31)},
		{2, date(2026, time.February, 28)},
		{3, date(2026, time.March, 31)},
		{4, date(2026, time.April, 30)},
		{13, date(2027, time.January, 31)}, // clamping must not stick
	}
	for _, tt := range tests {
		if got := cycleStart(start, tt.cycle, "monthly"); !got.Equal(tt.want) {
			t.Errorf("cycle %d starts %s, want %s",
				tt.cycle, got.Format("2006-01-02"), tt.want.Format("2006-01-02"))
		}
	}
	// 2028 is a leap year, so the same stay would bill on the 29th.
	if got := cycleStart(date(2028, time.January, 31), 2, "monthly"); !got.Equal(date(2028, time.February, 29)) {
		t.Errorf("leap-year February cycle starts %s, want 2028-02-29", got.Format("2006-01-02"))
	}
}

// Moved in 2026-02-20 on ₹7,500/month, paid three months. By August 11 six
// cycles are due, so ₹22,500 is outstanding, and the money has been owed since
// the fourth cycle began on May 20 — 83 days.
func TestBuildCollections_BalanceAndDaysOverdue(t *testing.T) {
	const rent = 750000

	got := buildCollections([]collectionStayRow{
		stay(rent, "monthly", date(2026, time.February, 20), 3*rent),
	}, collectionsToday)

	if len(got) != 1 {
		t.Fatalf("got %d rows, want 1", len(got))
	}
	if got[0].BalancePaise != 3*rent {
		t.Errorf("BalancePaise = %d, want %d", got[0].BalancePaise, 3*rent)
	}
	if got[0].DaysSinceDue != 83 {
		t.Errorf("DaysSinceDue = %d, want 83 (owed since 2026-05-20)", got[0].DaysSinceDue)
	}
}

// Paying half of the cycle you are behind on does not restart the clock. The
// tenant still owes that cycle, so it is still the one being counted from.
func TestBuildCollections_PartPaymentDoesNotClearACycle(t *testing.T) {
	const rent = 750000
	start := date(2026, time.February, 20)

	threePaid := buildCollections([]collectionStayRow{stay(rent, "monthly", start, 3*rent)}, collectionsToday)
	threeAndAHalf := buildCollections([]collectionStayRow{stay(rent, "monthly", start, 3*rent+rent/2)}, collectionsToday)

	if threeAndAHalf[0].DaysSinceDue != threePaid[0].DaysSinceDue {
		t.Errorf("a part payment moved the overdue clock: %d vs %d",
			threeAndAHalf[0].DaysSinceDue, threePaid[0].DaysSinceDue)
	}
	// It does reduce the balance, by exactly what was paid.
	if want := int64(3*rent - rent/2); threeAndAHalf[0].BalancePaise != want {
		t.Errorf("BalancePaise = %d, want %d", threeAndAHalf[0].BalancePaise, want)
	}
	// And paying the whole cycle does move it — to June 20, 52 days back.
	fourPaid := buildCollections([]collectionStayRow{stay(rent, "monthly", start, 4*rent)}, collectionsToday)
	if fourPaid[0].DaysSinceDue != 52 {
		t.Errorf("DaysSinceDue after clearing the cycle = %d, want 52", fourPaid[0].DaysSinceDue)
	}
}

// Never paid anything: overdue since the day they moved in.
func TestBuildCollections_NeverPaid(t *testing.T) {
	const rent = 600000

	got := buildCollections([]collectionStayRow{
		stay(rent, "monthly", date(2026, time.February, 20), 0),
	}, collectionsToday)

	if got[0].BalancePaise != 6*rent {
		t.Errorf("BalancePaise = %d, want %d (6 cycles)", got[0].BalancePaise, 6*rent)
	}
	// 2026-02-20 → 2026-08-11.
	if got[0].DaysSinceDue != 172 {
		t.Errorf("DaysSinceDue = %d, want 172", got[0].DaysSinceDue)
	}
	if got[0].LastPaymentDate != nil {
		t.Errorf("LastPaymentDate = %v, want nil", *got[0].LastPaymentDate)
	}
}

// Weekly and daily stays roll over inside the month, so the overdue clock has
// to count from the right cycle boundary, not from the month.
func TestBuildCollections_WeeklyAndDailyCycles(t *testing.T) {
	// ₹2,000/week from 2026-06-15, ₹8,000 paid = 4 weeks. By Aug 11, 9 cycles
	// are due. The 5th cycle began on Jul 13 — 29 days back.
	weekly := buildCollections([]collectionStayRow{
		stay(200000, "weekly", date(2026, time.June, 15), 800000),
	}, collectionsToday)
	if weekly[0].BalancePaise != 1000000 {
		t.Errorf("weekly BalancePaise = %d, want 1000000", weekly[0].BalancePaise)
	}
	if weekly[0].DaysSinceDue != 29 {
		t.Errorf("weekly DaysSinceDue = %d, want 29", weekly[0].DaysSinceDue)
	}

	// ₹500/night from Aug 9, nothing paid: nights of the 9th, 10th and 11th.
	daily := buildCollections([]collectionStayRow{
		stay(50000, "daily", date(2026, time.August, 9), 0),
	}, collectionsToday)
	if daily[0].BalancePaise != 150000 {
		t.Errorf("daily BalancePaise = %d, want 150000", daily[0].BalancePaise)
	}
	if daily[0].DaysSinceDue != 2 {
		t.Errorf("daily DaysSinceDue = %d, want 2", daily[0].DaysSinceDue)
	}
}

// The list is a chase list, so anyone who does not owe money must not be on it
// — including tenants paid exactly up to date and tenants paying ahead.
func TestBuildCollections_ExcludesEveryoneWhoDoesNotOwe(t *testing.T) {
	const rent = 750000
	start := date(2026, time.February, 20) // 6 cycles due by today

	tests := []struct {
		name string
		row  collectionStayRow
	}{
		{"paid exactly up to date", stay(rent, "monthly", start, 6*rent)},
		{"paying a cycle ahead", stay(rent, "monthly", start, 7*rent)},
		{"rent-free bed", stay(0, "monthly", start, 0)},
		{"stay starts next month", stay(rent, "monthly", date(2026, time.September, 1), 0)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := buildCollections([]collectionStayRow{tt.row}, collectionsToday); len(got) != 0 {
				t.Errorf("got %d rows, want 0 (balance %d)", len(got), got[0].BalancePaise)
			}
		})
	}

	// One paise short is still a debt, though.
	short := stay(rent, "monthly", start, 6*rent-1)
	if got := buildCollections([]collectionStayRow{short}, collectionsToday); len(got) != 1 || got[0].BalancePaise != 1 {
		t.Errorf("owing one paise should appear with balance 1, got %+v", got)
	}
}

// Biggest debt at the top, because that is the order the owner works in.
func TestBuildCollections_SortedByBalanceThenAge(t *testing.T) {
	small := stay(500000, "monthly", date(2026, time.July, 1), 500000) // owes 500000
	small.TenantName = "Small debt"
	big := stay(750000, "monthly", date(2026, time.February, 20), 0) // owes 4500000
	big.TenantName = "Big debt"
	middle := stay(600000, "monthly", date(2026, time.May, 5), 600000) // owes 1800000
	middle.TenantName = "Middle debt"

	got := buildCollections([]collectionStayRow{small, middle, big}, collectionsToday)

	want := []string{"Big debt", "Middle debt", "Small debt"}
	if len(got) != len(want) {
		t.Fatalf("got %d rows, want %d", len(got), len(want))
	}
	for i, name := range want {
		if got[i].TenantName != name {
			t.Errorf("row %d is %q, want %q", i, got[i].TenantName, name)
		}
	}
	if got[0].BalancePaise != 4500000 || got[1].BalancePaise != 1800000 || got[2].BalancePaise != 500000 {
		t.Errorf("balances out of order: %d, %d, %d",
			got[0].BalancePaise, got[1].BalancePaise, got[2].BalancePaise)
	}

	// Equal debts: the one owed longest goes first. Both owe ₹5,000 — one is a
	// month behind on a big rent, the other four months behind on a small one.
	recent := stay(500000, "monthly", date(2026, time.June, 1), 1000000)
	recent.TenantName = "Recent"
	longStanding := stay(250000, "monthly", date(2026, time.February, 20), 1000000)
	longStanding.TenantName = "Long-standing"

	tied := buildCollections([]collectionStayRow{recent, longStanding}, collectionsToday)
	if tied[0].BalancePaise != tied[1].BalancePaise {
		t.Fatalf("fixture is not actually tied: %d vs %d", tied[0].BalancePaise, tied[1].BalancePaise)
	}
	if tied[0].DaysSinceDue != 52 || tied[1].DaysSinceDue != 10 {
		t.Errorf("ages = %d and %d, want 52 and 10", tied[0].DaysSinceDue, tied[1].DaysSinceDue)
	}
	if tied[0].TenantName != "Long-standing" {
		t.Errorf("tie broken toward %q, want the older debt first", tied[0].TenantName)
	}
}

// A stay with no bed assigned (deposit collected, room not allocated yet) still
// owes rent and still belongs on the list — the page renders it without a bed.
func TestBuildCollections_NullableFieldsPassThrough(t *testing.T) {
	row := stay(600000, "monthly", date(2026, time.May, 5), 600000)
	row.BedName = sql.NullString{}
	row.LastPaymentDate = nullStr("2026-05-05")

	got := buildCollections([]collectionStayRow{row}, collectionsToday)

	if len(got) != 1 {
		t.Fatalf("got %d rows, want 1", len(got))
	}
	if got[0].BedName != nil {
		t.Errorf("BedName = %q, want nil", *got[0].BedName)
	}
	if got[0].LastPaymentDate == nil || *got[0].LastPaymentDate != "2026-05-05" {
		t.Errorf("LastPaymentDate = %v, want 2026-05-05", got[0].LastPaymentDate)
	}
	if got[0].RoomName != "101" || got[0].SiteName != "Sunrise PG" || got[0].Phone != "9812345601" {
		t.Errorf("row lost its identifying fields: %+v", got[0])
	}
}
