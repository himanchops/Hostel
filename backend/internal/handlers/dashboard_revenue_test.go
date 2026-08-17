package handlers

import (
	"testing"
	"time"
)

// All the revenue fixtures are read on the same day, mid-month: August 11 2026.
// Mid-month matters — it puts some stays' anchor days behind today and others
// ahead of it, which is exactly where "expected this month" gets interesting.
var revenueToday = date(2026, time.August, 11)

// A monthly stay is billed on its own anchor day, so whether it counts toward
// this month's expected revenue depends on where that day sits relative to
// today — not on the stay being new or old.
func TestComputeRevenue_MonthlyAnchorDayDecidesExpectedThisMonth(t *testing.T) {
	const rent = 750000 // ₹7,500

	// Anchor on the 20th: Feb–Jul have rolled over (6 cycles), but August's
	// rollover is still nine days out, so nothing is expected this month yet.
	notYetBilled := computeRevenue([]stayRevenueRow{
		{RentAmount: rent, RentCycle: "monthly", StartDate: date(2026, time.February, 20), TotalPaid: 6 * rent},
	}, 0, revenueToday)
	if notYetBilled.ExpectedThisMonth != 0 {
		t.Errorf("ExpectedThisMonth = %d, want 0 (anchor day is the 20th)", notYetBilled.ExpectedThisMonth)
	}
	if notYetBilled.OverdueAmount != 0 {
		t.Errorf("OverdueAmount = %d, want 0", notYetBilled.OverdueAmount)
	}

	// Anchor on the 1st: May–Aug is 4 cycles, and August's rolled over on the
	// 1st, so exactly one month's rent is expected this month.
	alreadyBilled := computeRevenue([]stayRevenueRow{
		{RentAmount: rent, RentCycle: "monthly", StartDate: date(2026, time.May, 1), TotalPaid: 4 * rent},
	}, 0, revenueToday)
	if alreadyBilled.ExpectedThisMonth != rent {
		t.Errorf("ExpectedThisMonth = %d, want %d (one cycle)", alreadyBilled.ExpectedThisMonth, rent)
	}
}

// A stay that starts mid-month has no cycles before this month at all, so its
// first cycle lands entirely in the current month's expected figure.
func TestComputeRevenue_StayStartedMidMonth(t *testing.T) {
	const rent = 600000 // ₹6,000

	got := computeRevenue([]stayRevenueRow{
		{RentAmount: rent, RentCycle: "monthly", StartDate: date(2026, time.August, 5), TotalPaid: 200000},
	}, 0, revenueToday)

	if got.ExpectedThisMonth != rent {
		t.Errorf("ExpectedThisMonth = %d, want %d", got.ExpectedThisMonth, rent)
	}
	// ₹6,000 due, ₹2,000 paid.
	if got.OverdueAmount != 400000 {
		t.Errorf("OverdueAmount = %d, want 400000", got.OverdueAmount)
	}
}

// Weekly and daily stays roll over several times inside one calendar month, so
// "expected this month" is the cycles crossed since the end of last month —
// not one rent.
func TestComputeRevenue_WeeklyAndDailyCycles(t *testing.T) {
	// Weekly, ₹2,000 a week from 2026-06-15. By Aug 11 that is 57 days = 9
	// cycles; by Jul 31 it was 46 days = 7. Two cycles fell in August.
	weekly := computeRevenue([]stayRevenueRow{
		{RentAmount: 200000, RentCycle: "weekly", StartDate: date(2026, time.June, 15), TotalPaid: 1400000},
	}, 0, revenueToday)
	if weekly.ExpectedThisMonth != 400000 {
		t.Errorf("weekly ExpectedThisMonth = %d, want 400000 (2 cycles)", weekly.ExpectedThisMonth)
	}
	// 9 cycles × ₹2,000 = ₹18,000 due, ₹14,000 paid.
	if weekly.OverdueAmount != 400000 {
		t.Errorf("weekly OverdueAmount = %d, want 400000", weekly.OverdueAmount)
	}

	// Daily, ₹500 a night from 2026-08-09: nights of the 9th, 10th and 11th.
	daily := computeRevenue([]stayRevenueRow{
		{RentAmount: 50000, RentCycle: "daily", StartDate: date(2026, time.August, 9), TotalPaid: 150000},
	}, 0, revenueToday)
	if daily.ExpectedThisMonth != 150000 {
		t.Errorf("daily ExpectedThisMonth = %d, want 150000 (3 cycles)", daily.ExpectedThisMonth)
	}
	if daily.OverdueAmount != 0 {
		t.Errorf("daily OverdueAmount = %d, want 0", daily.OverdueAmount)
	}
}

// A tenant paying ahead is not negative revenue. Their credit must not net off
// against what other tenants owe, or the overdue figure understates the hole.
func TestComputeRevenue_CreditDoesNotOffsetOthersArrears(t *testing.T) {
	const rent = 500000

	// Four cycles due (May 1 → Aug 11), ₹25,000 paid — a full cycle in credit.
	payingAhead := stayRevenueRow{
		RentAmount: rent, RentCycle: "monthly",
		StartDate: date(2026, time.May, 1), TotalPaid: 5 * rent,
	}
	// Four cycles due, nothing paid.
	inArrears := stayRevenueRow{
		RentAmount: rent, RentCycle: "monthly",
		StartDate: date(2026, time.May, 1), TotalPaid: 0,
	}

	alone := computeRevenue([]stayRevenueRow{inArrears}, 0, revenueToday)
	if alone.OverdueAmount != 4*rent {
		t.Errorf("OverdueAmount = %d, want %d", alone.OverdueAmount, 4*rent)
	}

	together := computeRevenue([]stayRevenueRow{payingAhead, inArrears}, 0, revenueToday)
	if together.OverdueAmount != 4*rent {
		t.Errorf("credit netted off arrears: OverdueAmount = %d, want %d",
			together.OverdueAmount, 4*rent)
	}
	// Both stays are still billed this month, credit or not.
	if together.ExpectedThisMonth != 2*rent {
		t.Errorf("ExpectedThisMonth = %d, want %d", together.ExpectedThisMonth, 2*rent)
	}
}

// A stay booked to start next week is not revenue yet.
func TestComputeRevenue_FutureStartContributesNothing(t *testing.T) {
	got := computeRevenue([]stayRevenueRow{
		{RentAmount: 900000, RentCycle: "monthly", StartDate: date(2026, time.September, 1), TotalPaid: 0},
	}, 0, revenueToday)

	if got.ExpectedThisMonth != 0 {
		t.Errorf("ExpectedThisMonth = %d, want 0", got.ExpectedThisMonth)
	}
	if got.OverdueAmount != 0 {
		t.Errorf("OverdueAmount = %d, want 0", got.OverdueAmount)
	}
}

// Collected is measured by the payments table, not by billing cycles, so it is
// passed straight through — including when it disagrees with what was expected.
func TestComputeRevenue_CollectedPassesThrough(t *testing.T) {
	const collected = 1234500 // ₹12,345 banked this month

	empty := computeRevenue(nil, collected, revenueToday)
	if empty.CollectedThisMonth != collected {
		t.Errorf("CollectedThisMonth = %d, want %d", empty.CollectedThisMonth, collected)
	}
	if empty.ExpectedThisMonth != 0 || empty.OverdueAmount != 0 {
		t.Errorf("no stays should mean no expected or overdue, got %+v", empty)
	}
}

// The whole rollup at once: five active stays on three different cycles, with
// start dates spread from February to this month, arrears and credit mixed.
func TestComputeRevenue_MixedPortfolio(t *testing.T) {
	const collected = 1234500

	stays := []stayRevenueRow{
		// Monthly ₹7,500 since Feb 20. 6 cycles due (₹45,000), ₹37,500 paid —
		// one cycle behind. August's rollover is still ahead, so 0 expected.
		{RentAmount: 750000, RentCycle: "monthly", StartDate: date(2026, time.February, 20), TotalPaid: 3750000},
		// Monthly ₹6,000, moved in on August 5 and paid ₹2,000 of the first
		// month. Whole cycle expected this month, ₹4,000 short.
		{RentAmount: 600000, RentCycle: "monthly", StartDate: date(2026, time.August, 5), TotalPaid: 200000},
		// Weekly ₹2,000 since June 15. 9 cycles due, 2 of them in August;
		// ₹14,000 paid against ₹18,000.
		{RentAmount: 200000, RentCycle: "weekly", StartDate: date(2026, time.June, 15), TotalPaid: 1400000},
		// Daily ₹500 since August 9, fully paid. 3 nights, all in August.
		{RentAmount: 50000, RentCycle: "daily", StartDate: date(2026, time.August, 9), TotalPaid: 150000},
		// Monthly ₹5,000 since May 1, paid a cycle ahead. 4 due, 1 in August.
		{RentAmount: 500000, RentCycle: "monthly", StartDate: date(2026, time.May, 1), TotalPaid: 2500000},
	}

	got := computeRevenue(stays, collected, revenueToday)

	// 0 + ₹6,000 + ₹4,000 + ₹1,500 + ₹5,000
	if want := int64(1650000); got.ExpectedThisMonth != want {
		t.Errorf("ExpectedThisMonth = %d, want %d", got.ExpectedThisMonth, want)
	}
	// ₹7,500 + ₹4,000 + ₹4,000 + 0 + 0
	if want := int64(1550000); got.OverdueAmount != want {
		t.Errorf("OverdueAmount = %d, want %d", got.OverdueAmount, want)
	}
	if got.CollectedThisMonth != collected {
		t.Errorf("CollectedThisMonth = %d, want %d", got.CollectedThisMonth, collected)
	}
}

// Recording a payment moves collected and overdue by exactly the payment, and
// leaves expected untouched — expected is a function of time, not of cash.
func TestComputeRevenue_PaymentMovesOverdueByItsAmount(t *testing.T) {
	const rent = 800000
	const payment = 300000

	stay := func(paid int64) []stayRevenueRow {
		return []stayRevenueRow{
			{RentAmount: rent, RentCycle: "monthly", StartDate: date(2026, time.June, 1), TotalPaid: paid},
		}
	}

	// June, July, August — 3 cycles due by August 11.
	before := computeRevenue(stay(rent), 0, revenueToday)
	after := computeRevenue(stay(rent+payment), payment, revenueToday)

	if before.OverdueAmount-after.OverdueAmount != payment {
		t.Errorf("overdue moved by %d, want the payment amount %d",
			before.OverdueAmount-after.OverdueAmount, payment)
	}
	if after.OverdueAmount != 3*rent-(rent+payment) {
		t.Errorf("OverdueAmount = %d, want %d", after.OverdueAmount, 3*rent-(rent+payment))
	}
	if before.ExpectedThisMonth != after.ExpectedThisMonth {
		t.Errorf("expected changed with a payment: %d vs %d",
			before.ExpectedThisMonth, after.ExpectedThisMonth)
	}
	if after.CollectedThisMonth != payment {
		t.Errorf("CollectedThisMonth = %d, want %d", after.CollectedThisMonth, payment)
	}
}
