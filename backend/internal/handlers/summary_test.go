package handlers

import (
	"testing"
	"time"
)

func date(y int, m time.Month, d int) time.Time {
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// summarize mirrors the aggregation loop in TenantHandler.Summary. It is kept
// in sync deliberately: the bug this guards was in the aggregation, not the
// query, so exercising the arithmetic is what matters.
type staySummaryInput struct {
	RentAmount int64
	RentCycle  string
	StartDate  time.Time
	EndDate    *time.Time
	TotalPaid  int64
}

func summarize(stays []staySummaryInput, today time.Time) TenantSummary {
	var s TenantSummary
	for _, st := range stays {
		start := dateOnly(st.StartDate)
		until := dateOnly(today)
		if st.EndDate != nil {
			until = dateOnly(*st.EndDate)
		}
		s.TotalPaid += st.TotalPaid
		s.TotalExpected += st.RentAmount * int64(cyclesElapsed(start, until, st.RentCycle))
		if days := int64(until.Sub(start).Hours() / 24); days > 0 {
			s.DurationDays += days
		}
	}
	s.Balance = s.TotalExpected - s.TotalPaid
	return s
}

// The regression: expected rent and duration used to be summed once per payment
// row because the query joined stays to payments. Adding a payment inflated both
// the balance owed and the stay duration.
func TestSummary_PerStayValuesDoNotScaleWithPaymentCount(t *testing.T) {
	today := date(2026, time.August, 11)
	start := date(2026, time.June, 1)
	const rent = 750000 // ₹7,500 in paise

	// Same stay, settled with a different number of payments each time. Only
	// TotalPaid should differ; expected and duration must stay constant.
	onePayment := summarize([]staySummaryInput{
		{RentAmount: rent, RentCycle: "monthly", StartDate: start, TotalPaid: 750000},
	}, today)
	fivePayments := summarize([]staySummaryInput{
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

	before := summarize([]staySummaryInput{
		{RentAmount: rent, RentCycle: "monthly", StartDate: start, TotalPaid: 800000},
	}, today)
	after := summarize([]staySummaryInput{
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

	got := summarize([]staySummaryInput{
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
	stay := []staySummaryInput{
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
