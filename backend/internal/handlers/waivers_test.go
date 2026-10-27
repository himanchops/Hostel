package handlers

import (
	"testing"
	"time"
)

// Money waived (migration 017): it covers what someone owes, oldest month
// first, the way a rent payment would, but it is never cash and never more
// than they owe.

func TestWaiverCredit_NeverMoreThanOwed(t *testing.T) {
	cases := []struct {
		name                 string
		billed, paid, waiver int64
		want                 int64
	}{
		{"part of a shortfall", 900000, 600000, 100000, 100000},
		{"all of it", 900000, 600000, 300000, 300000},
		// They paid in full after it was waived: nothing left for it to
		// cover, and it must not become rent paid ahead.
		{"paid in full since", 900000, 900000, 100000, 0},
		{"paid more than billed", 900000, 1000000, 100000, 0},
		{"more waived than owed now", 900000, 850000, 100000, 50000},
		{"nothing waived", 900000, 600000, 0, 0},
	}
	for _, c := range cases {
		if got := waiverCredit(c.billed, c.paid, c.waiver); got != c.want {
			t.Errorf("%s: waiverCredit(%d, %d, %d) = %d, want %d", c.name, c.billed, c.paid, c.waiver, got, c.want)
		}
	}
}

func TestSummary_WaiverComesOffWhatTheyOwe(t *testing.T) {
	today := date(2026, time.October, 21)
	// Three cycles of ₹9,000 (1 Aug, 1 Sep, 1 Oct), ₹20,000 paid, ₹3,000 waived.
	got := summarize([]staySummaryRow{{
		StayID: 7, RentAmount: 900000, RentCycle: "monthly", StartDate: date(2026, time.August, 1),
		TotalPaid: 2000000, Waived: 300000,
	}}, today)
	if got.Balance != 400000 {
		t.Errorf("Balance = %d, want 400000 (₹27,000 billed − ₹20,000 paid − ₹3,000 waived)", got.Balance)
	}
	if got.TotalPaid != 2000000 {
		t.Errorf("TotalPaid = %d, want 2000000: letting go is not a payment", got.TotalPaid)
	}
	if got.TotalExpected != 2400000 {
		t.Errorf("TotalExpected = %d, want 2400000: what was waived is no longer expected", got.TotalExpected)
	}
	if len(got.Owing) != 1 || got.Owing[0] != (StayOwed{StayID: 7, Owed: 400000}) {
		t.Errorf("Owing = %+v, want one stay owing 400000", got.Owing)
	}
	// It covers the oldest month first: ₹23,000 covers August and September
	// (₹18,000) and ₹5,000 of October, so October is what is due, ₹4,000 of it.
	if got.DueDate == nil || *got.DueDate != "2026-10-01" || *got.DuePaise != 400000 {
		t.Errorf("due = %s %d, want 2026-10-01 400000", deref(got.DueDate), derefI(got.DuePaise))
	}
}

func TestSummary_WaiverNeverPutsThemAhead(t *testing.T) {
	today := date(2026, time.October, 21)
	// ₹3,000 waived, then they paid all ₹27,000 anyway.
	got := summarize([]staySummaryRow{{
		RentAmount: 900000, RentCycle: "monthly", StartDate: date(2026, time.August, 1),
		TotalPaid: 2700000, Waived: 300000,
	}}, today)
	if got.Balance != 0 {
		t.Errorf("Balance = %d, want 0, not ₹3,000 ahead", got.Balance)
	}
	if len(got.Owing) != 0 {
		t.Errorf("Owing = %+v, want none", got.Owing)
	}
}

func TestSummary_WaivedAfterSettlementComesOffTheShortfall(t *testing.T) {
	today := date(2026, time.October, 21)
	ended := date(2026, time.September, 30)
	refund := int64(-550000) // settled owing ₹5,500
	got := summarize([]staySummaryRow{{
		StayID: 9, RentAmount: 900000, RentCycle: "monthly", StartDate: date(2026, time.June, 1), EndDate: &ended,
		TotalPaid: 2000000, SettlementRefund: &refund,
		PaidAfterSettlement: 50000, WaivedAfterSettlement: 200000,
	}}, today)
	if got.Balance != 300000 {
		t.Errorf("Balance = %d, want 300000 (₹5,500 − ₹500 paid since − ₹2,000 waived)", got.Balance)
	}
	if len(got.Owing) != 1 || got.Owing[0] != (StayOwed{StayID: 9, Owed: 300000, Settled: true}) {
		t.Errorf("Owing = %+v, want the settled stay owing 300000", got.Owing)
	}

	allOfIt := summarize([]staySummaryRow{{
		RentAmount: 900000, RentCycle: "monthly", StartDate: date(2026, time.June, 1), EndDate: &ended,
		TotalPaid: 2000000, SettlementRefund: &refund, WaivedAfterSettlement: 550000,
	}}, today)
	if allOfIt.Balance != 0 || len(allOfIt.Owing) != 0 {
		t.Errorf("all of it waived: Balance = %d, Owing = %+v, want 0 and none", allOfIt.Balance, allOfIt.Owing)
	}
}

func TestSettlementDues_WaiverBeforeSettling(t *testing.T) {
	end := date(2026, time.September, 30)
	stay := settlementStayRow{
		RentAmount: 900000, RentCycle: "monthly", StartDate: date(2026, time.July, 1), EndDate: &end,
		TotalPaid: 2400000, Waived: 200000,
	}
	// July, August, September: ₹27,000 billed, ₹24,000 paid, ₹2,000 waived.
	if dues, cycles := stay.dues(end); dues != 100000 || cycles != 3 {
		t.Errorf("dues = %d over %d cycles, want 100000 over 3", dues, cycles)
	}
	// Paid in full anyway: no advance appears out of the money waived.
	stay.TotalPaid = 2700000
	if dues, _ := stay.dues(end); dues != 0 {
		t.Errorf("dues = %d, want 0, never −200000", dues)
	}
	// Paid ahead on its own is still an advance.
	stay.TotalPaid = 2800000
	if dues, _ := stay.dues(end); dues != -100000 {
		t.Errorf("dues = %d, want −100000", dues)
	}
}

func TestPayeeRow_WaiverCoversTheOldestMonth(t *testing.T) {
	today := date(2026, time.October, 21)
	row := collectionStayRow{
		RentAmount: 900000, RentCycle: "monthly", StartDate: date(2026, time.August, 1),
		TotalPaid: 900000, Waived: 900000,
	}
	got := payeeRow(row, today)
	// August paid, September waived: only October is owed, due 20 days ago.
	if got.BalancePaise != 900000 {
		t.Errorf("BalancePaise = %d, want 900000", got.BalancePaise)
	}
	if got.DaysSinceDue != 20 {
		t.Errorf("DaysSinceDue = %d, want 20 (since 1 Oct, not since 1 Sep)", got.DaysSinceDue)
	}
}

func TestForMonth(t *testing.T) {
	today := date(2026, time.October, 21)
	open := staySummaryRow{
		RentAmount: 900000, RentCycle: "monthly", StartDate: date(2026, time.August, 5), TotalPaid: 900000,
	}
	// August's cycle is paid, so it comes off the one that began 5 Sep.
	if got := forMonth(open, today); !got.Equal(date(2026, time.September, 1)) {
		t.Errorf("forMonth = %s, want 2026-09-01", got.Format("2006-01-02"))
	}
	open.Waived = 900000 // September already waived
	if got := forMonth(open, today); !got.Equal(date(2026, time.October, 1)) {
		t.Errorf("forMonth = %s, want 2026-10-01", got.Format("2006-01-02"))
	}

	ended := date(2026, time.September, 12)
	refund := int64(-300000)
	settled := staySummaryRow{
		RentAmount: 900000, RentCycle: "monthly", StartDate: date(2026, time.June, 1), EndDate: &ended,
		SettlementRefund: &refund,
	}
	if got := forMonth(settled, today); !got.Equal(date(2026, time.September, 1)) {
		t.Errorf("forMonth settled = %s, want the month they left, 2026-09-01", got.Format("2006-01-02"))
	}
}

func TestRupees(t *testing.T) {
	for paise, want := range map[int64]string{
		50000: "₹500", 300000: "₹3,000", 1234500: "₹12,345", 12345600: "₹1,23,456", 1234567800: "₹1,23,45,678",
	} {
		if got := rupees(paise); got != want {
			t.Errorf("rupees(%d) = %s, want %s", paise, got, want)
		}
	}
}
