package handlers

import (
	"testing"
	"time"
)

// The fixture is the owner's case: a long stay whose rent goes up partway.
// Move-in 6 Jun 2026 at ₹5,000/month; from 6 Sep 2026 it is ₹5,500. On 21 Oct
// five cycles have begun — 6 Jun, 6 Jul, 6 Aug, 6 Sep, 6 Oct — three at the
// old rent and two at the new one.
var (
	raiseStart = date(2026, time.June, 6)
	raiseDate  = date(2026, time.September, 6)
	raiseToday = date(2026, time.October, 21)
	raised     = rentSchedule{
		{From: raiseStart, Rent: 500000},
		{From: raiseDate, Rent: 550000},
	}
)

func TestRentSchedule_EarlierMonthsKeepTheirRent(t *testing.T) {
	cycles := cyclesElapsed(raiseStart, raiseToday, "monthly")
	if cycles != 5 {
		t.Fatalf("cycles = %d, want 5", cycles)
	}
	// 3 × ₹5,000 + 2 × ₹5,500. Repricing the whole stay, as editing the rent
	// used to, would have said 5 × ₹5,500 = ₹27,500.
	if got := raised.billed(raiseStart, "monthly", 0, cycles); got != 2600000 {
		t.Errorf("billed = %d, want 2600000 (₹26,000)", got)
	}
}

func TestRentSchedule_FlatScheduleIsTheOldMultiplication(t *testing.T) {
	flat := flatSchedule(raiseStart, 500000)
	for n := 0; n <= 14; n++ {
		if got, want := flat.billed(raiseStart, "monthly", 0, n), int64(500000*n); got != want {
			t.Errorf("billed(0, %d) = %d, want %d", n, got, want)
		}
	}
}

// A change dated mid-cycle never splits a cycle: it applies from the next
// cycle that begins on or after it.
func TestRentSchedule_MidCycleDateAppliesFromTheNextDueDate(t *testing.T) {
	mid := rentSchedule{
		{From: raiseStart, Rent: 500000},
		{From: date(2026, time.August, 20), Rent: 550000},
	}
	if got := mid.billed(raiseStart, "monthly", 0, 5); got != 2600000 {
		t.Errorf("billed = %d, want 2600000 — the 6 Aug cycle began before the 20th", got)
	}

	onTheDay := rentSchedule{
		{From: raiseStart, Rent: 500000},
		{From: date(2026, time.August, 6), Rent: 550000},
	}
	// 2 × ₹5,000 + 3 × ₹5,500
	if got := onTheDay.billed(raiseStart, "monthly", 0, 5); got != 2650000 {
		t.Errorf("billed = %d, want 2650000 — a change dated on a due date includes it", got)
	}
}

func TestRentSchedule_TwoChanges(t *testing.T) {
	// Down for a quiet patch, then back up.
	s := rentSchedule{
		{From: raiseStart, Rent: 500000},
		{From: date(2026, time.July, 6), Rent: 400000},
		{From: date(2026, time.September, 6), Rent: 550000},
	}
	// Jun 5,000 · Jul 4,000 · Aug 4,000 · Sep 5,500 · Oct 5,500
	if got := s.billed(raiseStart, "monthly", 0, 5); got != 2400000 {
		t.Errorf("billed = %d, want 2400000", got)
	}
	// Just the cycles of September and October: from cycle 3 to cycle 5.
	if got := s.billed(raiseStart, "monthly", 3, 5); got != 1100000 {
		t.Errorf("billed(3, 5) = %d, want 1100000", got)
	}
}

func TestRentSchedule_PaidThroughClearsCyclesAtTheirOwnRent(t *testing.T) {
	cases := []struct {
		paid int64
		want int
	}{
		{0, 0},
		{1500000, 3},    // exactly Jun–Aug at ₹5,000
		{2000000, 3},    // ₹5,000 more is short of September's ₹5,500
		{2050000, 4},    // ...and ₹5,500 clears it
		{9999999999, 5}, // never past the cycles that have begun
	}
	for _, c := range cases {
		if got := raised.paidThrough(raiseStart, "monthly", c.paid, 5); got != c.want {
			t.Errorf("paidThrough(%d) = %d, want %d", c.paid, got, c.want)
		}
	}
}

func TestDuesForSchedule_SettlementBillsEachCycleAtItsRent(t *testing.T) {
	dues, cycles := duesForSchedule(raised, "monthly", raiseStart, raiseToday, 2000000)
	if cycles != 5 || dues != 600000 {
		t.Errorf("dues, cycles = %d, %d; want 600000 (₹6,000), 5", dues, cycles)
	}
}

func TestBuildCollections_RaisedRentDatesTheDebtFromTheFirstShortCycle(t *testing.T) {
	rows := buildCollections([]collectionStayRow{{
		StayID: 1, TenantName: "Raised", RentAmount: 550000, RentCycle: "monthly",
		StartDate: raiseStart, TotalPaid: 2000000, Schedule: raised,
	}}, raiseToday)
	if len(rows) != 1 {
		t.Fatalf("got %d rows, want 1", len(rows))
	}
	// Owes ₹26,000 − ₹20,000; behind since 6 Sep, the first cycle not covered.
	if rows[0].BalancePaise != 600000 {
		t.Errorf("balance = %d, want 600000", rows[0].BalancePaise)
	}
	if rows[0].DaysSinceDue != 45 {
		t.Errorf("days since due = %d, want 45 (6 Sep → 21 Oct)", rows[0].DaysSinceDue)
	}
}

func TestComputeRevenue_ExpectedThisMonthUsesTheNewRent(t *testing.T) {
	got := computeRevenue([]stayRevenueRow{{
		StayID: 1, RentAmount: 550000, RentCycle: "monthly", StartDate: raiseStart,
		TotalPaid: 2600000, Schedule: raised,
	}}, 0, raiseToday)
	if got.ExpectedThisMonth != 550000 {
		t.Errorf("expected this month = %d, want 550000 (the 6 Oct cycle)", got.ExpectedThisMonth)
	}
	if got.OverdueAmount != 0 {
		t.Errorf("overdue = %d, want 0 — ₹26,000 billed, ₹26,000 paid", got.OverdueAmount)
	}
}

func TestComputeTenantSummary_RaisedRentIsNotBackdated(t *testing.T) {
	got := computeTenantSummary([]staySummaryRow{{
		StayID: 1, RentAmount: 550000, RentCycle: "monthly", StartDate: raiseStart,
		TotalPaid: 2600000, Schedule: raised,
	}}, raiseToday)
	if got.TotalExpected != 2600000 || got.Balance != 0 {
		t.Errorf("expected, balance = %d, %d; want 2600000, 0 — a paid-up tenant must not "+
			"fall into arrears because the rent went up", got.TotalExpected, got.Balance)
	}
}

func TestComputeRevenueSeries_MonthsBeforeTheChangeKeepTheOldRent(t *testing.T) {
	points := computeRevenueSeries([]insightStay{{
		StayID: 1, RoomID: 1, RentAmount: 550000, RentCycle: "monthly",
		StartDate: raiseStart, Schedule: raised,
	}}, nil, raiseToday, 5)
	want := map[string]int64{
		"2026-06": 500000, "2026-07": 500000, "2026-08": 500000,
		"2026-09": 550000, "2026-10": 550000,
	}
	for _, p := range points {
		if w, ok := want[p.Month]; ok && p.ExpectedPaise != w {
			t.Errorf("%s billed %d, want %d", p.Month, p.ExpectedPaise, w)
		}
	}
}

// "Partial" is less than one cycle behind — measured against the rent being
// billed now. ₹5,000 behind on a ₹5,500 rent is partial, though it would have
// read as a full cycle overdue against the move-in rent.
func TestBuildBed_PartialIsMeasuredAgainstTheCurrentRent(t *testing.T) {
	row := gridRow{}
	row.BedID.Valid, row.BedID.Int64 = true, 1
	row.StayID.Valid, row.StayID.Int64 = true, 1
	row.RentAmount.Valid, row.RentAmount.Int64 = true, 550000
	row.RentCycle.Valid, row.RentCycle.String = true, "monthly"
	row.StartDate.Valid, row.StartDate.Time = true, raiseStart
	row.TotalPaid = 2100000 // ₹26,000 billed → ₹5,000 behind
	row.Schedule = raised

	bed := buildBed(row, raiseToday)
	if *bed.Balance != -500000 {
		t.Fatalf("balance = %d, want -500000", *bed.Balance)
	}
	if bed.Status != StatusPartial {
		t.Errorf("status = %s, want %s", bed.Status, StatusPartial)
	}
}
