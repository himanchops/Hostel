package handlers

import (
	"testing"
	"time"
)

func date(y int, m time.Month, d int) time.Time {
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// summarize calls the REAL aggregation, rather than a copy of it.
//
// It used to be a hand-maintained mirror "kept in sync deliberately", and that
// is exactly how the settlement bug survived: the handler and the mirror agreed
// with each other and both ignored settlements. A test that reimplements the
// thing it tests can only ever confirm its own arithmetic.
func summarize(stays []staySummaryRow, today time.Time) TenantSummary {
	return computeTenantSummary(stays, today)
}

func money(n int64) *int64 { return &n }

// The regression: expected rent and duration used to be summed once per payment
// row because the query joined stays to payments. Adding a payment inflated both
// the balance owed and the stay duration.
func TestSummary_PerStayValuesDoNotScaleWithPaymentCount(t *testing.T) {
	today := date(2026, time.August, 11)
	start := date(2026, time.June, 1)
	const rent = 750000 // ₹7,500 in paise

	// Same stay, settled with a different number of payments each time. Only
	// TotalPaid should differ; expected and duration must stay constant.
	onePayment := summarize([]staySummaryRow{
		{RentAmount: rent, RentCycle: "monthly", StartDate: start, TotalPaid: 750000},
	}, today)
	fivePayments := summarize([]staySummaryRow{
		{RentAmount: rent, RentCycle: "monthly", StartDate: start, TotalPaid: 3050000},
	}, today)

	if onePayment.TotalExpected != fivePayments.TotalExpected {
		t.Errorf("expected rent changed with payment count: %d vs %d",
			onePayment.TotalExpected, fivePayments.TotalExpected)
	}
	if onePayment.DurationDays != fivePayments.DurationDays {
		t.Errorf("duration changed with payment count: %d vs %d",
			onePayment.DurationDays, fivePayments.DurationDays)
	}

	// 2026-06-01 → 2026-08-11 is 71 days.
	if got := fivePayments.DurationDays; got != 71 {
		t.Errorf("DurationDays = %d, want 71", got)
	}
	// cyclesElapsed counts 3 monthly cycles (June, July, August).
	if got := fivePayments.TotalExpected; got != rent*3 {
		t.Errorf("TotalExpected = %d, want %d", got, rent*3)
	}
	// Paid ₹30,500 against ₹22,500 expected — a credit, so a negative balance.
	if got := fivePayments.Balance; got != rent*3-3050000 {
		t.Errorf("Balance = %d, want %d", got, rent*3-3050000)
	}
}

func TestSummary_AddingPaymentReducesBalance(t *testing.T) {
	today := date(2026, time.August, 11)
	start := date(2026, time.June, 1)
	const rent = 800000

	before := summarize([]staySummaryRow{
		{RentAmount: rent, RentCycle: "monthly", StartDate: start, TotalPaid: 800000},
	}, today)
	after := summarize([]staySummaryRow{
		{RentAmount: rent, RentCycle: "monthly", StartDate: start, TotalPaid: 1600000},
	}, today)

	if after.Balance >= before.Balance {
		t.Errorf("recording a payment did not reduce the balance: before=%d after=%d",
			before.Balance, after.Balance)
	}
	if diff := before.Balance - after.Balance; diff != 800000 {
		t.Errorf("balance moved by %d, want the payment amount 800000", diff)
	}
}

func TestSummary_MultipleStaysAccumulate(t *testing.T) {
	today := date(2026, time.August, 11)
	ended := date(2026, time.March, 1)

	got := summarize([]staySummaryRow{
		// A finished stay: 2026-01-01 → 2026-03-01. 59 days, and 3 monthly
		// cycles — rent is due at the start of each cycle, so Jan, Feb and Mar
		// are all charged (see cyclesElapsed).
		{RentAmount: 500000, RentCycle: "monthly", StartDate: date(2026, time.January, 1),
			EndDate: &ended, TotalPaid: 1000000},
		// An active stay: 2026-06-01 → today, 3 cycles, 71 days.
		{RentAmount: 750000, RentCycle: "monthly", StartDate: date(2026, time.June, 1),
			TotalPaid: 2250000},
	}, today)

	if got.DurationDays != 59+71 {
		t.Errorf("DurationDays = %d, want %d", got.DurationDays, 59+71)
	}
	if want := int64(500000*3 + 750000*3); got.TotalExpected != want {
		t.Errorf("TotalExpected = %d, want %d", got.TotalExpected, want)
	}
	if got.TotalPaid != 3250000 {
		t.Errorf("TotalPaid = %d, want 3250000", got.TotalPaid)
	}
	if got.Balance != got.TotalExpected-got.TotalPaid {
		t.Errorf("Balance is not expected minus paid")
	}
}

// An ended stay must stop accruing rent and days once it is over.
func TestSummary_EndedStayStopsAccruing(t *testing.T) {
	ended := date(2026, time.March, 1)
	stay := []staySummaryRow{
		{RentAmount: 500000, RentCycle: "monthly", StartDate: date(2026, time.January, 1),
			EndDate: &ended, TotalPaid: 1000000},
	}

	atEnd := summarize(stay, date(2026, time.March, 1))
	muchLater := summarize(stay, date(2026, time.December, 25))

	if atEnd.TotalExpected != muchLater.TotalExpected {
		t.Errorf("ended stay kept accruing rent: %d vs %d", atEnd.TotalExpected, muchLater.TotalExpected)
	}
	if atEnd.DurationDays != muchLater.DurationDays {
		t.Errorf("ended stay kept accruing days: %d vs %d", atEnd.DurationDays, muchLater.DurationDays)
	}
}

// ── Settlements ──────────────────────────────────────────────────────────────

// The reported bug, with the owner's own numbers: ₹5,000 billed, ₹2,500 paid,
// ₹1,000 deposit held, and the remaining ₹1,500 written off at the counter.
// The settlement nets to zero, so nothing is owed — but the tenant page kept
// reading "₹2,500 owed" because Balance never looked at settlements.
func TestSummary_SettledStayIsSquare(t *testing.T) {
	ended := date(2026, time.September, 8)
	got := summarize([]staySummaryRow{{
		RentAmount: 500000, RentCycle: "monthly",
		StartDate: date(2026, time.September, 7), EndDate: &ended,
		TotalPaid: 250000, SettlementRefund: money(0),
	}}, date(2026, time.September, 8))

	if got.Balance != 0 {
		t.Errorf("Balance = %d, want 0 — the settlement resolved the dues", got.Balance)
	}
	// The history is untouched: they really did pay ₹2,500 against ₹5,000 billed.
	if got.TotalPaid != 250000 || got.TotalExpected != 500000 {
		t.Errorf("history changed: paid=%d expected=%d, want 250000/500000",
			got.TotalPaid, got.TotalExpected)
	}
}

// A settlement that left the tenant owing money still shows as owed — writing
// the balance off entirely would hide a real debt.
func TestSummary_SettlementCanLeaveTheTenantOwing(t *testing.T) {
	ended := date(2026, time.September, 8)
	got := summarize([]staySummaryRow{{
		RentAmount: 500000, RentCycle: "monthly",
		StartDate: date(2026, time.September, 7), EndDate: &ended,
		TotalPaid: 0, SettlementRefund: money(-400000), // ₹4,000 short at the counter
	}}, date(2026, time.September, 8))

	if got.Balance != 400000 {
		t.Errorf("Balance = %d, want 400000 — the settlement says they still owe", got.Balance)
	}
}

// A refund owed to the TENANT is not a tenant credit. Recording the settlement
// is recording the handover, so it must not leave them looking permanently
// "ahead" on the balance card.
func TestSummary_RefundToTenantIsNotACredit(t *testing.T) {
	ended := date(2026, time.September, 8)
	got := summarize([]staySummaryRow{{
		RentAmount: 500000, RentCycle: "monthly",
		StartDate: date(2026, time.September, 7), EndDate: &ended,
		TotalPaid: 500000, SettlementRefund: money(100000), // deposit went back
	}}, date(2026, time.September, 8))

	if got.Balance != 0 {
		t.Errorf("Balance = %d, want 0 — a paid-out refund is not a credit", got.Balance)
	}
}

// Settling one stay must not silence what is owed on another. A tenant can
// settle an old stay and still be behind on a current one.
func TestSummary_SettledStayDoesNotMaskAnActiveOne(t *testing.T) {
	ended := date(2026, time.March, 1)
	got := summarize([]staySummaryRow{
		{RentAmount: 500000, RentCycle: "monthly", StartDate: date(2026, time.January, 1),
			EndDate: &ended, TotalPaid: 0, SettlementRefund: money(0)},
		// Active, three cycles billed, nothing paid.
		{RentAmount: 750000, RentCycle: "monthly", StartDate: date(2026, time.June, 1),
			TotalPaid: 0},
	}, date(2026, time.August, 11))

	if got.Balance != 750000*3 {
		t.Errorf("Balance = %d, want %d — only the active stay is outstanding",
			got.Balance, 750000*3)
	}
}
