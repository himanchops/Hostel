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
	// rollover is still nine days out, so nothing is due this month yet. It
	// is still expected: the 20th is in August.
	notYetBilled := computeRevenue([]stayRevenueRow{
		{RentAmount: rent, RentCycle: "monthly", StartDate: date(2026, time.February, 20), TotalPaid: 6 * rent},
	}, 0, revenueToday)
	if notYetBilled.DueThisMonth != 0 {
		t.Errorf("DueThisMonth = %d, want 0 (anchor day is the 20th)", notYetBilled.DueThisMonth)
	}
	if notYetBilled.ExpectedThisMonth != rent {
		t.Errorf("ExpectedThisMonth = %d, want %d (the 20th is still to come)", notYetBilled.ExpectedThisMonth, rent)
	}
	if notYetBilled.OverdueAmount != 0 {
		t.Errorf("OverdueAmount = %d, want 0", notYetBilled.OverdueAmount)
	}

	// Anchor on the 1st: May–Aug is 4 cycles, and August's rolled over on the
	// 1st, so exactly one month's rent is expected this month.
	alreadyBilled := computeRevenue([]stayRevenueRow{
		{RentAmount: rent, RentCycle: "monthly", StartDate: date(2026, time.May, 1), TotalPaid: 4 * rent},
	}, 0, revenueToday)
	if alreadyBilled.DueThisMonth != rent || alreadyBilled.ExpectedThisMonth != rent {
		t.Errorf("due, expected = %d, %d; want %d for both (one cycle)",
			alreadyBilled.DueThisMonth, alreadyBilled.ExpectedThisMonth, rent)
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
// "due this month" is the cycles crossed since the end of last month — not one
// rent — and "expected" is every cycle that starts by the 31st.
func TestComputeRevenue_WeeklyAndDailyCycles(t *testing.T) {
	// Weekly, ₹2,000 a week from 2026-06-15. By Aug 11 that is 57 days = 9
	// cycles; by Jul 31 it was 46 days = 7. Two cycles fell in August.
	weekly := computeRevenue([]stayRevenueRow{
		{RentAmount: 200000, RentCycle: "weekly", StartDate: date(2026, time.June, 15), TotalPaid: 1400000},
	}, 0, revenueToday)
	if weekly.DueThisMonth != 400000 {
		t.Errorf("weekly DueThisMonth = %d, want 400000 (2 cycles)", weekly.DueThisMonth)
	}
	// Rent days 3, 10, 17, 24 and 31 August.
	if weekly.ExpectedThisMonth != 1000000 {
		t.Errorf("weekly ExpectedThisMonth = %d, want 1000000 (5 cycles)", weekly.ExpectedThisMonth)
	}
	// 9 cycles × ₹2,000 = ₹18,000 due, ₹14,000 paid.
	if weekly.OverdueAmount != 400000 {
		t.Errorf("weekly OverdueAmount = %d, want 400000", weekly.OverdueAmount)
	}

	// Daily, ₹500 a night from 2026-08-09: nights of the 9th, 10th and 11th.
	daily := computeRevenue([]stayRevenueRow{
		{RentAmount: 50000, RentCycle: "daily", StartDate: date(2026, time.August, 9), TotalPaid: 150000},
	}, 0, revenueToday)
	if daily.DueThisMonth != 150000 {
		t.Errorf("daily DueThisMonth = %d, want 150000 (3 cycles)", daily.DueThisMonth)
	}
	// Every night from the 9th to the 31st, as if they stay.
	if daily.ExpectedThisMonth != 1150000 {
		t.Errorf("daily ExpectedThisMonth = %d, want 1150000 (23 nights)", daily.ExpectedThisMonth)
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
		// one cycle behind. August's rollover is still ahead: 0 due, ₹7,500
		// expected.
		{RentAmount: 750000, RentCycle: "monthly", StartDate: date(2026, time.February, 20), TotalPaid: 3750000},
		// Monthly ₹6,000, moved in on August 5 and paid ₹2,000 of the first
		// month. Whole cycle expected this month, ₹4,000 short.
		{RentAmount: 600000, RentCycle: "monthly", StartDate: date(2026, time.August, 5), TotalPaid: 200000},
		// Weekly ₹2,000 since June 15. 9 cycles due, 2 of them in August and
		// 5 by the 31st; ₹14,000 paid against ₹18,000.
		{RentAmount: 200000, RentCycle: "weekly", StartDate: date(2026, time.June, 15), TotalPaid: 1400000},
		// Daily ₹500 since August 9, fully paid. 3 nights so far, 23 by the 31st.
		{RentAmount: 50000, RentCycle: "daily", StartDate: date(2026, time.August, 9), TotalPaid: 150000},
		// Monthly ₹5,000 since May 1, paid a cycle ahead. 4 due, 1 in August.
		{RentAmount: 500000, RentCycle: "monthly", StartDate: date(2026, time.May, 1), TotalPaid: 2500000},
	}

	got := computeRevenue(stays, collected, revenueToday)

	// 0 + ₹6,000 + ₹4,000 + ₹1,500 + ₹5,000
	if want := int64(1650000); got.DueThisMonth != want {
		t.Errorf("DueThisMonth = %d, want %d", got.DueThisMonth, want)
	}
	// ₹7,500 + ₹6,000 + ₹10,000 + ₹11,500 + ₹5,000
	if want := int64(4000000); got.ExpectedThisMonth != want {
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

// Someone who left on the 5th was billed for August on the 1st. Their rent
// stays in "expected" (Insights counts it too) while they drop out of
// overdue, which is open stays only: a leaver who owes is on Payments. Left
// out of expected, two settled leavers once read "₹75,000 of ₹69,500".
func TestComputeRevenue_LeaverThisMonthStaysInExpected(t *testing.T) {
	const rent = 800000 // ₹8,000
	left := ptr(date(2026, time.August, 5))

	got := computeRevenue([]stayRevenueRow{
		// Monthly from 1 May, left 5 Aug owing August: billed this month, not overdue here.
		{RentAmount: rent, RentCycle: "monthly", StartDate: date(2026, time.May, 1), EndDate: left, TotalPaid: 3 * rent},
		// Left on their rent day, the 1st: August was never billed.
		{RentAmount: rent, RentCycle: "monthly", StartDate: date(2026, time.May, 1), EndDate: ptr(date(2026, time.August, 1)), TotalPaid: 3 * rent},
		// Daily, ₹500 from 30 Jul, left the morning of 3 Aug: nights of 1st and 2nd are this month's.
		{RentAmount: 50000, RentCycle: "daily", StartDate: date(2026, time.July, 30), EndDate: ptr(date(2026, time.August, 3)), TotalPaid: 0},
		// Still here, one month behind.
		{RentAmount: rent, RentCycle: "monthly", StartDate: date(2026, time.June, 1), TotalPaid: 2 * rent},
	}, 0, revenueToday)

	if want := int64(rent + 2*50000 + rent); got.ExpectedThisMonth != want {
		t.Errorf("ExpectedThisMonth = %d, want %d", got.ExpectedThisMonth, want)
	}
	if got.OverdueAmount != rent {
		t.Errorf("OverdueAmount = %d, want %d (the open stay only)", got.OverdueAmount, rent)
	}
	if got.StaysOpen != 1 || got.StaysOwing != 1 {
		t.Errorf("stays open/owing = %d/%d, want 1/1", got.StaysOpen, got.StaysOwing)
	}
}

// Someone who has said when they are going is expected to pay for the rent
// days before it and not after; someone whose date has passed, still here,
// goes on being billed, because nothing acts on a leaving date by itself.
func TestComputeRevenue_LeavingDateTrimsExpectedNotDue(t *testing.T) {
	const rent = 600000 // ₹6,000

	got := computeRevenue([]stayRevenueRow{
		// Rent day the 20th, going on the 15th: August's rent day never comes.
		{RentAmount: rent, RentCycle: "monthly", StartDate: date(2026, time.May, 20),
			ExpectedEnd: ptr(date(2026, time.August, 15)), TotalPaid: 3 * rent},
		// Rent day the 20th, going on the 25th: August's is before they go.
		{RentAmount: rent, RentCycle: "monthly", StartDate: date(2026, time.May, 20),
			ExpectedEnd: ptr(date(2026, time.August, 25)), TotalPaid: 3 * rent},
		// Rent day the 5th, said they would go on the 5th, still here on the
		// 11th: August's rent was billed when they stayed, so it is expected.
		{RentAmount: rent, RentCycle: "monthly", StartDate: date(2026, time.May, 5),
			ExpectedEnd: ptr(date(2026, time.August, 5)), TotalPaid: 4 * rent},
		// Daily ₹500 from the 9th, going the morning of the 14th: five nights.
		{RentAmount: 50000, RentCycle: "daily", StartDate: date(2026, time.August, 9),
			ExpectedEnd: ptr(date(2026, time.August, 14)), TotalPaid: 0},
	}, 0, revenueToday)

	// 0 + ₹6,000 + ₹6,000 + 5 × ₹500
	if want := int64(rent + rent + 5*50000); got.ExpectedThisMonth != want {
		t.Errorf("ExpectedThisMonth = %d, want %d", got.ExpectedThisMonth, want)
	}
	// Only the 5th has come and gone, plus the 9th, 10th and 11th nights.
	if want := int64(rent + 3*50000); got.DueThisMonth != want {
		t.Errorf("DueThisMonth = %d, want %d", got.DueThisMonth, want)
	}
}
