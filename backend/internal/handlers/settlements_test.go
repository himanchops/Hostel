package handlers

import (
	"testing"
	"time"

	"github.com/winnow/hostel/internal/models"
)

// One tenant, five and a bit months, six payments, a month behind on rent —
// the shape of an actual move-out rather than a stay that starts today.
//
//	₹8,500/month from 15 Mar, moving out 20 Aug  → 6 cycles billed = ₹51,000
//	paid ₹42,500 across six payments (one month split in two)
//	deposit ₹17,000
const (
	settleRent    int64 = 850000  // ₹8,500
	settleDeposit int64 = 1700000 // ₹17,000
	settlePaid    int64 = 4250000 // ₹42,500 — five months' worth
)

var (
	settleStart = date(2026, time.March, 15)
	settleEnd   = date(2026, time.August, 20)
)

func settleStay() settlementStayRow {
	return settlementStayRow{
		StayID:        1,
		TenantID:      1,
		TenantName:    "Asha Rao",
		RentAmount:    settleRent,
		DepositAmount: settleDeposit,
		RentCycle:     "monthly",
		StartDate:     settleStart,
		TotalPaid:     settlePaid,
	}
}

// ─── Dues ────────────────────────────────────────────────────────────────────

func TestDuesFor_MultiMonthStay(t *testing.T) {
	dues, cycles := duesFor(settleRent, "monthly", settleStart, settleEnd, settlePaid)

	// 15 Mar → 20 Aug: five whole months, plus the sixth because the 20th is
	// past the 15th anchor.
	if cycles != 6 {
		t.Errorf("cycles = %d, want 6", cycles)
	}
	if want := int64(850000); dues != want {
		t.Errorf("dues = %d, want %d (₹51,000 billed − ₹42,500 paid)", dues, want)
	}
}

// Leaving one day short of the anchor is one cycle cheaper. This is the
// difference the owner is deciding when they pick a move-out date, so it has to
// be exact rather than approximately right.
func TestDuesFor_MoveOutDateChangesTheBill(t *testing.T) {
	dayBefore, cyclesBefore := duesFor(settleRent, "monthly", settleStart, date(2026, time.August, 14), settlePaid)
	onAnchor, cyclesOn := duesFor(settleRent, "monthly", settleStart, date(2026, time.August, 15), settlePaid)

	if cyclesBefore != 5 || cyclesOn != 6 {
		t.Fatalf("cycles = %d and %d, want 5 and 6", cyclesBefore, cyclesOn)
	}
	if dayBefore != 0 {
		t.Errorf("dues on 14 Aug = %d, want 0 — five cycles billed, five paid", dayBefore)
	}
	if onAnchor != 850000 {
		t.Errorf("dues on 15 Aug = %d, want 850000", onAnchor)
	}
}

// A tenant who paid ahead is owed the difference back on top of the deposit.
// Clamping dues at zero here would quietly keep their money.
func TestDuesFor_PaidAheadIsNegative(t *testing.T) {
	paid := int64(5950000) // seven months, but only six are billed
	dues, cycles := duesFor(settleRent, "monthly", settleStart, settleEnd, paid)

	if cycles != 6 {
		t.Fatalf("cycles = %d, want 6", cycles)
	}
	if want := int64(-850000); dues != want {
		t.Errorf("dues = %d, want %d", dues, want)
	}
	if refund := refundFor(settleDeposit, dues, nil); refund != 2550000 {
		t.Errorf("refund = %d, want 2550000 (₹17,000 deposit + ₹8,500 paid ahead)", refund)
	}
}

// A move-in on the 31st has no 31st to roll over on in February. cyclesElapsed
// clamps the anchor; the settlement inherits that, and must not skip the month.
func TestDuesFor_MonthEndStartClamps(t *testing.T) {
	start := date(2026, time.January, 31)
	dues, cycles := duesFor(600000, "monthly", start, date(2026, time.February, 28), 600000)

	if cycles != 2 {
		t.Errorf("cycles = %d, want 2 — February bills on the 28th", cycles)
	}
	if dues != 600000 {
		t.Errorf("dues = %d, want 600000", dues)
	}
}

func TestDuesFor_WeeklyAndDaily(t *testing.T) {
	start := date(2026, time.June, 3)

	// 3 Jun → 1 Jul is 28 days = cycles 1..5 (day 0 is cycle 1).
	weekly, weeks := duesFor(150000, "weekly", start, date(2026, time.July, 1), 450000)
	if weeks != 5 {
		t.Errorf("weeks = %d, want 5", weeks)
	}
	if weekly != 300000 {
		t.Errorf("weekly dues = %d, want 300000 (₹7,500 billed − ₹4,500 paid)", weekly)
	}

	daily, days := duesFor(40000, "daily", start, date(2026, time.June, 12), 300000)
	if days != 10 {
		t.Errorf("days = %d, want 10", days)
	}
	if daily != 100000 {
		t.Errorf("daily dues = %d, want 100000 (₹4,000 billed − ₹3,000 paid)", daily)
	}
}

// ─── Refund ──────────────────────────────────────────────────────────────────

func TestRefundFor_DepositMinusDuesPlusAdjustments(t *testing.T) {
	dues, _ := duesFor(settleRent, "monthly", settleStart, settleEnd, settlePaid)

	adjustments := []models.Adjustment{
		{Label: "Damaged chair", AmountPaise: -50000},
		{Label: "Unpaid electricity share", AmountPaise: -120000},
		{Label: "June advance returned", AmountPaise: 30000},
	}

	// ₹17,000 − ₹8,500 − ₹500 − ₹1,200 + ₹300 = ₹7,100
	if got := refundFor(settleDeposit, dues, adjustments); got != 710000 {
		t.Errorf("refund = %d, want 710000", got)
	}
}

// Deductions bigger than the deposit mean the tenant leaves owing money, and
// the sign has to survive to the screen — an owner shown ₹4,000 when the tenant
// owes ₹4,000 hands over cash they should be collecting.
func TestRefundFor_CanGoNegative(t *testing.T) {
	dues := int64(2550000) // three months behind
	adjustments := []models.Adjustment{{Label: "Broken window", AmountPaise: -300000}}

	if got := refundFor(settleDeposit, dues, adjustments); got != -1150000 {
		t.Errorf("refund = %d, want -1150000 (tenant owes ₹11,500)", got)
	}
}

func TestRefundFor_NoAdjustmentsIsDepositMinusDues(t *testing.T) {
	if got := refundFor(settleDeposit, 850000, nil); got != 850000 {
		t.Errorf("refund = %d, want 850000", got)
	}
	if got := refundFor(settleDeposit, 850000, []models.Adjustment{}); got != 850000 {
		t.Errorf("refund with an empty slice = %d, want 850000", got)
	}
}

// The check the POST handler runs. The realistic failure is a stale drawer: a
// payment lands between opening the calculator and confirming it, so the
// refund the owner is looking at is ₹8,500 too generous.
func TestRefund_StalePreviewNoLongerMatches(t *testing.T) {
	staleDues, _ := duesFor(settleRent, "monthly", settleStart, settleEnd, settlePaid)
	staleRefund := refundFor(settleDeposit, staleDues, nil)

	// Meanwhile the tenant pays the outstanding month.
	freshDues, _ := duesFor(settleRent, "monthly", settleStart, settleEnd, settlePaid+850000)
	freshRefund := refundFor(settleDeposit, freshDues, nil)

	if staleRefund == freshRefund {
		t.Fatal("a payment between preview and submit must change the refund, or the check is pointless")
	}
	if staleRefund != 850000 || freshRefund != 1700000 {
		t.Errorf("refunds = %d and %d, want 850000 and 1700000", staleRefund, freshRefund)
	}
}

// The tenant page shows a balance from the summary endpoint and, a click later,
// dues in the settlement drawer. Two numbers for the same thing that disagree
// is the bug this guards.
func TestDuesFor_AgreesWithTenantSummary(t *testing.T) {
	end := settleEnd
	summary := summarize([]staySummaryInput{{
		RentAmount: settleRent,
		RentCycle:  "monthly",
		StartDate:  settleStart,
		EndDate:    &end,
		TotalPaid:  settlePaid,
	}}, date(2026, time.December, 1)) // today is irrelevant once the stay has ended

	dues, _ := duesFor(settleRent, "monthly", settleStart, end, settlePaid)
	if dues != summary.Balance {
		t.Errorf("settlement dues %d disagree with the summary balance %d", dues, summary.Balance)
	}
}

// ─── Which date rent is billed to ────────────────────────────────────────────

func TestSettlementDate_OpenStayDefaultsToToday(t *testing.T) {
	today := date(2026, time.August, 11)
	got, err := settlementDate(settleStay(), "", today)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !got.Equal(today) {
		t.Errorf("date = %s, want %s", got.Format("2006-01-02"), today.Format("2006-01-02"))
	}
}

// Backfilling matters: a departure entered three days late must be billed to
// the day it happened, the same rule EndStayDialog follows.
func TestSettlementDate_OpenStayTakesTheRequestedDate(t *testing.T) {
	got, err := settlementDate(settleStay(), "2026-08-08", date(2026, time.August, 11))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if want := date(2026, time.August, 8); !got.Equal(want) {
		t.Errorf("date = %s, want 2026-08-08", got.Format("2006-01-02"))
	}
}

func TestSettlementDate_RejectsEndBeforeStart(t *testing.T) {
	_, err := settlementDate(settleStay(), "2026-03-01", date(2026, time.August, 11))
	if err == nil {
		t.Error("a move-out before the move-in should be refused")
	}
}

func TestSettlementDate_RejectsBadFormat(t *testing.T) {
	for _, bad := range []string{"08-08-2026", "next tuesday", "2026/08/08"} {
		if _, err := settlementDate(settleStay(), bad, date(2026, time.August, 11)); err == nil {
			t.Errorf("settlementDate(%q) should have errored", bad)
		}
	}
}

// An already-ended stay has the answer written on it. Silently billing a
// different period than the stay records would make the settlement and the
// ledger disagree about the same move-out.
func TestSettlementDate_EndedStayUsesItsOwnDate(t *testing.T) {
	stay := settleStay()
	end := date(2026, time.July, 31)
	stay.EndDate = &end

	got, err := settlementDate(stay, "", date(2026, time.August, 11))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !got.Equal(end) {
		t.Errorf("date = %s, want 2026-07-31", got.Format("2006-01-02"))
	}

	if _, err := settlementDate(stay, "2026-07-31", date(2026, time.August, 11)); err != nil {
		t.Errorf("a request agreeing with the stay should be fine, got %v", err)
	}
	if _, err := settlementDate(stay, "2026-08-05", date(2026, time.August, 11)); err == nil {
		t.Error("a request disagreeing with an ended stay should be refused, not ignored")
	}
}

// ─── Adjustment validation ───────────────────────────────────────────────────

func TestValidateAdjustments_RequiresALabel(t *testing.T) {
	cases := [][]models.Adjustment{
		{{Label: "", AmountPaise: -50000}},
		{{Label: "   ", AmountPaise: -50000}},
		{{Label: "Damaged chair", AmountPaise: -50000}, {Label: "", AmountPaise: -10000}},
	}
	for i, adjustments := range cases {
		if err := validateAdjustments(adjustments); err == nil {
			t.Errorf("case %d: an unlabelled adjustment should be refused", i)
		}
	}
}

// A ₹0 line is a real thing to record — "cleaning charge, waived" is worth
// having on the settlement even though it moves no money.
func TestValidateAdjustments_AllowsZero(t *testing.T) {
	if err := validateAdjustments([]models.Adjustment{{Label: "Cleaning charge — waived", AmountPaise: 0}}); err != nil {
		t.Errorf("a zero-amount adjustment should be allowed, got %v", err)
	}
}

func TestValidateAdjustments_Limits(t *testing.T) {
	if err := validateAdjustments(nil); err != nil {
		t.Errorf("no adjustments should be fine, got %v", err)
	}

	tooMany := make([]models.Adjustment, maxAdjustments+1)
	for i := range tooMany {
		tooMany[i] = models.Adjustment{Label: "Line", AmountPaise: -100}
	}
	if err := validateAdjustments(tooMany); err == nil {
		t.Errorf("more than %d adjustments should be refused", maxAdjustments)
	}

	long := make([]rune, maxAdjustmentLabel+1)
	for i := range long {
		long[i] = 'x'
	}
	if err := validateAdjustments([]models.Adjustment{{Label: string(long), AmountPaise: -100}}); err == nil {
		t.Error("an over-long label should be refused")
	}
}
