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
		DepositAgreed: settleDeposit,
		DepositHeld:   settleDeposit, // paid in full; the tests below take it away
		RentCycle:     "monthly",
		StartDate:     settleStart,
		TotalPaid:     settlePaid,
	}
}

// ─── The deposit refunded is the deposit received ────────────────────────────
//
// The UX audit's first blocker. The calculator used to refund the deposit
// AGREED at intake as if it were money in the drawer. Three ways that went
// wrong, all on the same ₹8,500/month stay with a ₹17,000 deposit agreed.

// Nothing paid at all. One cycle billed (15 Mar → 20 Mar). The old code offered
// him ₹17,000 − ₹8,500 = ₹8,500 back; he owes ₹8,500.
func TestPreview_NothingPaidIsNotRefundedAnything(t *testing.T) {
	stay := settleStay()
	stay.DepositHeld = 0
	stay.TotalPaid = 0

	p := (&SettlementHandler{}).previewFor(stay, date(2026, time.March, 20))

	if p.CyclesBilled != 1 {
		t.Fatalf("cycles = %d, want 1", p.CyclesBilled)
	}
	if p.DepositPaise != 0 {
		t.Errorf("deposit held = %d, want 0 — nothing was received", p.DepositPaise)
	}
	if p.DepositAgreedPaise != 1700000 {
		t.Errorf("deposit agreed = %d, want 1700000 — the term is still shown", p.DepositAgreedPaise)
	}
	if p.RefundPaise != -850000 {
		t.Errorf("refund = %d, want -850000 (the tenant owes one month); the old code said +850000", p.RefundPaise)
	}
}

// The deposit arrived in two instalments and fell short: ₹6,000 + ₹4,000 of
// the ₹17,000 agreed. Six cycles billed, five paid, so ₹8,500 of rent comes out
// of the ₹10,000 actually held.
func TestPreview_PartDepositIsRefundedOnlyAsFarAsItWasPaid(t *testing.T) {
	stay := settleStay()
	stay.DepositHeld = 600000 + 400000

	p := (&SettlementHandler{}).previewFor(stay, settleEnd)

	if p.DepositPaise != 1000000 || p.DepositAgreedPaise != 1700000 {
		t.Errorf("deposit held/agreed = %d/%d, want 1000000/1700000", p.DepositPaise, p.DepositAgreedPaise)
	}
	if p.DuesPaise != 850000 {
		t.Errorf("dues = %d, want 850000 (₹51,000 billed − ₹42,500 paid)", p.DuesPaise)
	}
	if p.RefundPaise != 150000 {
		t.Errorf("refund = %d, want 150000 (₹10,000 held − ₹8,500 dues)", p.RefundPaise)
	}
}

// Before payments had a kind, the only way to write a deposit down was as an
// ordinary payment. Here ₹25,500 arrived for one billed cycle: ₹17,000 of it was
// the deposit. The old code counted it twice — ₹17,000 "deposit held" from the
// agreed term, plus ₹17,000 "paid in advance" — and offered ₹34,000 back for
// ₹25,500 received.
func TestPreview_ADepositWrittenAsRentIsNeverRefundedTwice(t *testing.T) {
	end := date(2026, time.March, 20)

	asRent := settleStay()
	asRent.DepositHeld = 0
	asRent.TotalPaid = 2550000
	old := refundFor(asRent.DepositAgreed, 850000-2550000, 1700000, nil)
	if old != 3400000 {
		t.Fatalf("fixture is wrong: the old arithmetic should give 3400000, got %d", old)
	}

	p := (&SettlementHandler{}).previewFor(asRent, end)
	if p.RefundPaise != 1700000 {
		t.Errorf("refund = %d, want 1700000 — once, as a rent advance the owner chooses about", p.RefundPaise)
	}
	if p.AdvancePaise != 1700000 {
		t.Errorf("advance = %d, want 1700000", p.AdvancePaise)
	}

	// Recorded properly, the same money lands in the same place, but as a
	// deposit rather than as an advance.
	asDeposit := settleStay()
	asDeposit.DepositHeld = 1700000
	asDeposit.TotalPaid = 850000
	q := (&SettlementHandler{}).previewFor(asDeposit, end)
	if q.RefundPaise != 1700000 || q.DuesPaise != 0 || q.AdvancePaise != 0 {
		t.Errorf("refund/dues/advance = %d/%d/%d, want 1700000/0/0", q.RefundPaise, q.DuesPaise, q.AdvancePaise)
	}
}

// A tenant who paid more deposit than was agreed gets back what they paid.
// The agreed figure is a label; it caps nothing.
func TestPreview_DepositOverpaidIsRefundedInFull(t *testing.T) {
	stay := settleStay()
	stay.DepositHeld = 2000000 // ₹20,000 against ₹17,000 agreed
	stay.TotalPaid = 5100000   // every cycle paid

	p := (&SettlementHandler{}).previewFor(stay, settleEnd)
	if p.RefundPaise != 2000000 {
		t.Errorf("refund = %d, want 2000000", p.RefundPaise)
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

// Leaving ON the rent day costs nothing more: the month they paid covers them
// up to that day (the owner's rule, Oct 2026 — it used to bill the new month).
// Staying one night past it starts the next month. This is the difference the
// owner is deciding when they pick a move-out date, so it has to be exact.
func TestDuesFor_MoveOutDateChangesTheBill(t *testing.T) {
	onAnchor, cyclesOn := duesFor(settleRent, "monthly", settleStart, date(2026, time.August, 15), settlePaid)
	dayAfter, cyclesAfter := duesFor(settleRent, "monthly", settleStart, date(2026, time.August, 16), settlePaid)

	if cyclesOn != 5 || cyclesAfter != 6 {
		t.Fatalf("cycles = %d and %d, want 5 and 6", cyclesOn, cyclesAfter)
	}
	if onAnchor != 0 {
		t.Errorf("dues leaving on 15 Aug, the rent day = %d, want 0 — five cycles billed, five paid", onAnchor)
	}
	if dayAfter != 850000 {
		t.Errorf("dues leaving on 16 Aug = %d, want 850000", dayAfter)
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
	// Returning the advance in full is the default, not a law — see
	// TestRefundFor_AdvanceIsTheOwnersChoice for the other two options.
	if refund := refundFor(settleDeposit, dues, advanceHeld(dues), nil); refund != 2550000 {
		t.Errorf("refund = %d, want 2550000 (₹17,000 deposit + ₹8,500 paid ahead)", refund)
	}
}

// ─── What happens to a rent advance ──────────────────────────────────────────

func TestAdvanceHeld(t *testing.T) {
	if got := advanceHeld(-850000); got != 850000 {
		t.Errorf("advanceHeld(-850000) = %d, want 850000", got)
	}
	// Owing rent is not a negative advance.
	if got := advanceHeld(850000); got != 0 {
		t.Errorf("advanceHeld(850000) = %d, want 0", got)
	}
	if got := advanceHeld(0); got != 0 {
		t.Errorf("advanceHeld(0) = %d, want 0", got)
	}
}

// Return all of it, some of it, or none — the owner decides at the counter, and
// the arithmetic must not decide for them. Same ₹8,500 advance in each case,
// three different refunds.
func TestRefundFor_AdvanceIsTheOwnersChoice(t *testing.T) {
	const dues = -850000 // ₹8,500 paid beyond what was billed

	tests := []struct {
		name     string
		returned int64
		want     int64
	}{
		{"all of it", 850000, 2550000},  // ₹17,000 + ₹8,500
		{"half of it", 425000, 2125000}, // ₹17,000 + ₹4,250
		{"none of it", 0, 1700000},      // the deposit alone
	}
	for _, tt := range tests {
		if got := refundFor(settleDeposit, dues, tt.returned, nil); got != tt.want {
			t.Errorf("%s: refund = %d, want %d", tt.name, got, tt.want)
		}
	}
}

// Withholding the advance and adding a deduction are different things and must
// compose, not collide.
func TestRefundFor_WithheldAdvancePlusAdjustments(t *testing.T) {
	adjustments := []models.Adjustment{{Label: "Damaged chair", AmountPaise: -50000}}

	// ₹17,000 deposit + ₹0 advance returned − ₹500 = ₹16,500
	if got := refundFor(settleDeposit, -850000, 0, adjustments); got != 1650000 {
		t.Errorf("refund = %d, want 1650000", got)
	}
}

func TestValidateAdvanceReturned(t *testing.T) {
	// A tenant who owes rent has no advance to hand back.
	if err := validateAdvanceReturned(850000, 0); err != nil {
		t.Errorf("returning nothing when none is held should be fine, got %v", err)
	}
	if err := validateAdvanceReturned(850000, 50000); err == nil {
		t.Error("returning an advance that does not exist should be refused")
	}

	// With ₹8,500 held, anything from nothing to all of it is legitimate.
	for _, ok := range []int64{0, 1, 425000, 850000} {
		if err := validateAdvanceReturned(-850000, ok); err != nil {
			t.Errorf("returning %d of 850000 should be allowed, got %v", ok, err)
		}
	}
	// Beyond it is not: that would be inventing money.
	if err := validateAdvanceReturned(-850000, 850001); err == nil {
		t.Error("returning more advance than was paid should be refused")
	}
	if err := validateAdvanceReturned(-850000, -1); err == nil {
		t.Error("a negative advance return should be refused")
	}
}

// A move-in on the 31st has no 31st to roll over on in February. cyclesElapsed
// clamps the anchor; the settlement inherits that, and must not skip the month.
func TestDuesFor_MonthEndStartClamps(t *testing.T) {
	start := date(2026, time.January, 31)
	// Leaving 1 Mar: February's month began on the 28th, so it is billed.
	dues, cycles := duesFor(600000, "monthly", start, date(2026, time.March, 1), 600000)

	if cycles != 2 {
		t.Errorf("cycles = %d, want 2 — February bills on the 28th", cycles)
	}
	if dues != 600000 {
		t.Errorf("dues = %d, want 600000", dues)
	}
}

func TestDuesFor_WeeklyAndDaily(t *testing.T) {
	start := date(2026, time.June, 3)

	// Leaving 2 Jul: weeks starting 3, 10, 17, 24 Jun and 1 Jul = 5. (Leaving
	// on 1 Jul itself would be 4: a cycle starting on the leaving day is not
	// billed.)
	weekly, weeks := duesFor(150000, "weekly", start, date(2026, time.July, 2), 450000)
	if weeks != 5 {
		t.Errorf("weeks = %d, want 5", weeks)
	}
	if weekly != 300000 {
		t.Errorf("weekly dues = %d, want 300000 (₹7,500 billed − ₹4,500 paid)", weekly)
	}

	// Leaving 13 Jun: the nights of 3–12 Jun = 10. The leaving day is not a night.
	daily, days := duesFor(40000, "daily", start, date(2026, time.June, 13), 300000)
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
	if got := refundFor(settleDeposit, dues, 0, adjustments); got != 710000 {
		t.Errorf("refund = %d, want 710000", got)
	}
}

// Deductions bigger than the deposit mean the tenant leaves owing money, and
// the sign has to survive to the screen — an owner shown ₹4,000 when the tenant
// owes ₹4,000 hands over cash they should be collecting.
func TestRefundFor_CanGoNegative(t *testing.T) {
	dues := int64(2550000) // three months behind
	adjustments := []models.Adjustment{{Label: "Broken window", AmountPaise: -300000}}

	if got := refundFor(settleDeposit, dues, 0, adjustments); got != -1150000 {
		t.Errorf("refund = %d, want -1150000 (tenant owes ₹11,500)", got)
	}
}

func TestRefundFor_NoAdjustmentsIsDepositMinusDues(t *testing.T) {
	if got := refundFor(settleDeposit, 850000, 0, nil); got != 850000 {
		t.Errorf("refund = %d, want 850000", got)
	}
	if got := refundFor(settleDeposit, 850000, 0, []models.Adjustment{}); got != 850000 {
		t.Errorf("refund with an empty slice = %d, want 850000", got)
	}
}

// The check the POST handler runs. The realistic failure is a stale drawer: a
// payment lands between opening the calculator and confirming it, so the
// refund the owner is looking at is ₹8,500 too generous.
func TestRefund_StalePreviewNoLongerMatches(t *testing.T) {
	staleDues, _ := duesFor(settleRent, "monthly", settleStart, settleEnd, settlePaid)
	staleRefund := refundFor(settleDeposit, staleDues, 0, nil)

	// Meanwhile the tenant pays the outstanding month.
	freshDues, _ := duesFor(settleRent, "monthly", settleStart, settleEnd, settlePaid+850000)
	freshRefund := refundFor(settleDeposit, freshDues, 0, nil)

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
	summary := summarize([]staySummaryRow{{
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

// The house rule: notice is due by the start of the rent month they leave
// in, when they pay for it. Rent on the 15th, leaving 10 Nov: the last month
// began 15 Oct, so notice on 15 Oct counts and 16 Oct does not.
func TestNoticeOnTime(t *testing.T) {
	start := date(2026, time.June, 15)
	leaving := date(2026, time.November, 10)
	if got := noticeBy(start, "monthly", leaving); !got.Equal(date(2026, time.October, 15)) {
		t.Fatalf("notice due by %s, want 15 Oct", got.Format("2 Jan"))
	}
	day := func(m time.Month, d int) *time.Time { t := date(2026, m, d); return &t }
	cases := []struct {
		name   string
		notice *time.Time
		want   bool
	}{
		{"a month ahead", day(time.October, 1), true},
		{"on the rent day", day(time.October, 15), true},
		{"the day after", day(time.October, 16), false},
		{"in the last week", day(time.November, 3), false},
		{"never", nil, false},
	}
	for _, c := range cases {
		if got := noticeOnTime(start, "monthly", c.notice, leaving); got != c.want {
			t.Errorf("%s: on time = %v, want %v", c.name, got, c.want)
		}
	}

	// A 31st move-in: November has no 31st, so its rent month began 30 Nov,
	// and leaving 5 Dec needs notice by then.
	if got := noticeBy(date(2026, time.August, 31), "monthly", date(2026, time.December, 5)); !got.Equal(date(2026, time.November, 30)) {
		t.Errorf("31st move-in: notice due by %s, want 30 Nov", got.Format("2 Jan"))
	}
}

func TestRefundMethod(t *testing.T) {
	s := func(v string) *string { return &v }
	cases := []struct {
		name    string
		sent    *string
		refund  int64
		want    *string
		wantErr bool
	}{
		{"cash handed back", s("cash"), 650000, s("cash"), false},
		{"UPI handed back", s("online"), 650000, s("online"), false},
		{"not said", nil, 650000, nil, false},
		// Nothing went back, so there is no "how" to keep.
		{"deposit kept", s("cash"), 0, nil, false},
		{"tenant owes", s("online"), -250000, nil, false},
		{"not a method", s("cheque"), 650000, nil, true},
	}
	for _, c := range cases {
		got, err := refundMethod(c.sent, c.refund)
		if (err != nil) != c.wantErr || deref(got) != deref(c.want) {
			t.Errorf("%s: got %s, %v; want %s, error %v", c.name, deref(got), err, deref(c.want), c.wantErr)
		}
	}
}

// The owner's example: rent on the 23rd, leaving on the 23rd. The month that
// begins that day is not theirs to pay, and the notice was due when they paid
// their last month, on 23 Sep — and the tenant summary and Insights bill the
// ended stay the same way.
func TestLeavingOnTheRentDay(t *testing.T) {
	start := date(2026, time.August, 23)
	leaving := date(2026, time.October, 23)
	if got := cyclesThroughEnd(start, leaving, "monthly"); got != 2 {
		t.Errorf("billed %d months, want 2 (23 Aug and 23 Sep)", got)
	}
	if got := noticeBy(start, "monthly", leaving); !got.Equal(date(2026, time.September, 23)) {
		t.Errorf("notice due by %s, want 23 Sep", got.Format("2 Jan"))
	}
	if dues, _ := duesFor(700000, "monthly", start, leaving, 1400000); dues != 0 {
		t.Errorf("dues = %d, want 0: both months paid, nothing more owed", dues)
	}
	// Moving in and out the same day is still a stay, billed its first month.
	if got := cyclesThroughEnd(start, start, "monthly"); got != 1 {
		t.Errorf("same-day stay billed %d months, want 1", got)
	}
	ended := leaving
	sum := summarize([]staySummaryRow{{RentAmount: 700000, RentCycle: "monthly", StartDate: start, EndDate: &ended, TotalPaid: 1400000}}, date(2026, time.November, 5))
	if sum.TotalExpected != 1400000 {
		t.Errorf("tenant summary billed %d, want 1400000 — the same two months", sum.TotalExpected)
	}
	stay := insightStay{StartDate: start, EndDate: &ended, RentCycle: "monthly"}
	if got := billedCycles(stay, date(2026, time.November, 5)); got != 2 {
		t.Errorf("Insights billed %d months, want 2", got)
	}
}

// A booking: ₹3,000 paid on 23 Oct to hold a place from 1 Nov at ₹6,000, plus
// a ₹5,000 deposit, and they never came. Nobody slept there, so nothing is
// billed; the ₹3,000 is rent paid ahead and the deposit is still held. The
// house rules keep both by default (the sheet's moveOutSettlement), and the
// owner can hand any of it back.
func TestCancelledBooking_BillsNothing(t *testing.T) {
	booking := settleStay()
	booking.Booking = true
	booking.RentAmount = 600000
	booking.StartDate = date(2026, time.November, 1)
	booking.TotalPaid = 300000
	booking.DepositHeld = 500000

	// Cancelled after the day they were due, and before it.
	for _, end := range []time.Time{date(2026, time.November, 3), date(2026, time.October, 28)} {
		got, err := settlementDate(booking, end.Format("2006-01-02"), date(2026, time.November, 3))
		if err != nil {
			t.Fatalf("cancelling on %s: %v", end.Format("2 Jan"), err)
		}
		p := (&SettlementHandler{}).previewFor(booking, got)
		if p.DuesPaise != -300000 || p.CyclesBilled != 0 || p.AdvancePaise != 300000 {
			t.Errorf("cancelled %s: dues/cycles/advance = %d/%d/%d, want -300000/0/300000",
				end.Format("2 Jan"), p.DuesPaise, p.CyclesBilled, p.AdvancePaise)
		}
	}

	// The same dates on a stay that had a bed are a typo, and still refused.
	if _, err := settlementDate(settleStay(), "2026-03-01", date(2026, time.August, 11)); err == nil {
		t.Error("a move-out before the move-in should still be refused for a real stay")
	}

	// The tenant page and Insights agree it was never billed.
	if got := endedCycles(booking.StartDate, booking.StartDate, "monthly", true); got != 0 {
		t.Errorf("endedCycles = %d for a booking, want 0", got)
	}
	if got := endedCycles(booking.StartDate, booking.StartDate, "monthly", false); got != 1 {
		t.Errorf("endedCycles = %d for a same-day stay with a bed, want 1", got)
	}
	ended := booking.StartDate
	sum := summarize([]staySummaryRow{{
		RentAmount: 600000, RentCycle: "monthly", StartDate: booking.StartDate,
		EndDate: &ended, Booking: true, TotalPaid: 300000,
	}}, date(2026, time.November, 5))
	if sum.TotalExpected != 0 {
		t.Errorf("tenant summary billed %d for a cancelled booking, want 0", sum.TotalExpected)
	}
}
