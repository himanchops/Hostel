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
func TestPayeeRow_BalanceAndDaysOverdue(t *testing.T) {
	const rent = 750000

	got := []CollectionRow{payeeRow(stay(rent, "monthly", date(2026, time.February, 20), 3*rent), collectionsToday)}

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
func TestPayeeRow_PartPaymentDoesNotClearACycle(t *testing.T) {
	const rent = 750000
	start := date(2026, time.February, 20)

	threePaid := []CollectionRow{payeeRow(stay(rent, "monthly", start, 3*rent), collectionsToday)}
	threeAndAHalf := []CollectionRow{payeeRow(stay(rent, "monthly", start, 3*rent+rent/2), collectionsToday)}

	if threeAndAHalf[0].DaysSinceDue != threePaid[0].DaysSinceDue {
		t.Errorf("a part payment moved the overdue clock: %d vs %d",
			threeAndAHalf[0].DaysSinceDue, threePaid[0].DaysSinceDue)
	}
	// It does reduce the balance, by exactly what was paid.
	if want := int64(3*rent - rent/2); threeAndAHalf[0].BalancePaise != want {
		t.Errorf("BalancePaise = %d, want %d", threeAndAHalf[0].BalancePaise, want)
	}
	// And paying the whole cycle does move it — to June 20, 52 days back.
	fourPaid := []CollectionRow{payeeRow(stay(rent, "monthly", start, 4*rent), collectionsToday)}
	if fourPaid[0].DaysSinceDue != 52 {
		t.Errorf("DaysSinceDue after clearing the cycle = %d, want 52", fourPaid[0].DaysSinceDue)
	}
}

// Never paid anything: overdue since the day they moved in.
func TestPayeeRow_NeverPaid(t *testing.T) {
	const rent = 600000

	got := []CollectionRow{payeeRow(stay(rent, "monthly", date(2026, time.February, 20), 0), collectionsToday)}

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
func TestPayeeRow_WeeklyAndDailyCycles(t *testing.T) {
	// ₹2,000/week from 2026-06-15, ₹8,000 paid = 4 weeks. By Aug 11, 9 cycles
	// are due. The 5th cycle began on Jul 13 — 29 days back.
	weekly := []CollectionRow{payeeRow(stay(200000, "weekly", date(2026, time.June, 15), 800000), collectionsToday)}
	if weekly[0].BalancePaise != 1000000 {
		t.Errorf("weekly BalancePaise = %d, want 1000000", weekly[0].BalancePaise)
	}
	if weekly[0].DaysSinceDue != 29 {
		t.Errorf("weekly DaysSinceDue = %d, want 29", weekly[0].DaysSinceDue)
	}

	// ₹500/night from Aug 9, nothing paid: nights of the 9th, 10th and 11th.
	daily := []CollectionRow{payeeRow(stay(50000, "daily", date(2026, time.August, 9), 0), collectionsToday)}
	if daily[0].BalancePaise != 150000 {
		t.Errorf("daily BalancePaise = %d, want 150000", daily[0].BalancePaise)
	}
	if daily[0].DaysSinceDue != 2 {
		t.Errorf("daily DaysSinceDue = %d, want 2", daily[0].DaysSinceDue)
	}
}

// Anyone who does not owe money owes nothing on their row — including tenants
// paid exactly up to date and tenants paying ahead — so they never land under
// Overdue.
func TestPayeeRow_NothingOwedWhenPaidUpOrAhead(t *testing.T) {
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
			got := payeeRow(tt.row, collectionsToday)
			if got.BalancePaise != 0 || got.DaysSinceDue != 0 || (got.DueState != nil && *got.DueState == dueOverdue) {
				t.Errorf("owes %d, %d days, %s; want nothing owed", got.BalancePaise, got.DaysSinceDue, deref(got.DueState))
			}
		})
	}

	// One paise short is still a debt, though.
	short := stay(rent, "monthly", start, 6*rent-1)
	if got := payeeRow(short, collectionsToday); got.BalancePaise != 1 || *got.DueState != dueOverdue {
		t.Errorf("owing one paise should be overdue with balance 1, got %d %s", got.BalancePaise, *got.DueState)
	}
}

// A stay with no bed assigned (deposit collected, room not allocated yet) still
// owes rent and still has a row — the page renders it without a bed.
func TestPayeeRow_NullableFieldsPassThrough(t *testing.T) {
	row := stay(600000, "monthly", date(2026, time.May, 5), 600000)
	row.BedName = sql.NullString{}
	row.LastPaymentDate = nullStr("2026-05-05")

	got := []CollectionRow{payeeRow(row, collectionsToday)}

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

// ── Moved out, still owes (UX audit M12) ─────────────────────────────────────

func TestSettledOwed(t *testing.T) {
	tests := []struct {
		name         string
		refund, paid int64
		want         int64
	}{
		{"short at the counter, nothing since", -550000, 0, 550000},
		{"part paid since", -550000, 200000, 350000},
		{"paid off exactly", -550000, 550000, 0},
		{"overpaid is square, not a credit", -550000, 600000, 0},
		{"deposit went back to the tenant", 300000, 0, 0},
		{"settled square", 0, 0, 0},
	}
	for _, tt := range tests {
		if got := settledOwed(tt.refund, tt.paid); got != tt.want {
			t.Errorf("%s: settledOwed(%d, %d) = %d, want %d", tt.name, tt.refund, tt.paid, got, tt.want)
		}
	}
}

func movedOut(id int64, name string, refund, paidAfter int64, settled time.Time) movedOutRow {
	return movedOutRow{
		StayID: id, TenantID: id, TenantName: name, Phone: "9812345601",
		SiteName: "Sunrise PG", RoomName: "101", BedName: nullStr("A"),
		RentAmount: 500000, RentCycle: "monthly", EndDate: "2026-07-31",
		RefundPaise: refund, SettledAt: settled, PaidAfter: paidAfter,
	}
}

// The list keeps who still owes, drops who has paid up, puts the biggest debt
// first, and counts days from the settlement — the day the debt was agreed.
func TestBuildMovedOut(t *testing.T) {
	rows := buildMovedOut([]movedOutRow{
		movedOut(1, "Paid Up", -300000, 300000, date(2026, time.July, 31)),
		movedOut(2, "Small", -150000, 0, date(2026, time.August, 1)),
		movedOut(3, "Large", -700000, 150000, date(2026, time.July, 21)),
	}, collectionsToday)

	if len(rows) != 2 {
		t.Fatalf("got %d rows, want 2 — a paid-off shortfall is not a debt", len(rows))
	}
	if rows[0].TenantName != "Large" || rows[0].BalancePaise != 550000 {
		t.Errorf("first row = %s %d, want Large 550000 (₹7,000 short less ₹1,500 paid)", rows[0].TenantName, rows[0].BalancePaise)
	}
	if rows[0].DaysSinceDue != 21 {
		t.Errorf("Large DaysSinceDue = %d, want 21 (settled 21 Jul, today 11 Aug)", rows[0].DaysSinceDue)
	}
	if rows[1].TenantName != "Small" || rows[1].BalancePaise != 150000 || rows[1].DaysSinceDue != 10 {
		t.Errorf("second row = %+v, want Small 150000 settled 10 days ago", rows[1])
	}
	for _, r := range rows {
		if !r.MovedOut || r.EndDate == nil || *r.EndDate != "2026-07-31" {
			t.Errorf("%s: MovedOut=%v EndDate=%v, want true and 2026-07-31", r.TenantName, r.MovedOut, r.EndDate)
		}
	}

	// The dashboard's figure is the same money as the list's.
	total := movedOutTotal([]movedOutRow{
		movedOut(1, "Paid Up", -300000, 300000, date(2026, time.July, 31)),
		movedOut(2, "Small", -150000, 0, date(2026, time.August, 1)),
		movedOut(3, "Large", -700000, 150000, date(2026, time.July, 21)),
	})
	if total != 700000 {
		t.Errorf("movedOutTotal = %d, want 700000 (550000 + 150000)", total)
	}
}

// The Payments screen lists everyone, owing or not, soonest due first — and
// says when each is due with the same dueFor the grid uses, so a tile and a
// row can never disagree about a date.
func TestBuildPayees_SoonestDueFirst(t *testing.T) {
	behind := stay(650000, "monthly", date(2026, time.June, 5), 650000*2) // paid Jun, Jul; Aug due 5 Aug
	behind.StayID, behind.TenantName = 1, "Behind"
	soon := stay(500000, "monthly", date(2026, time.July, 14), 500000) // paid Jul; Aug due 14 Aug
	soon.StayID, soon.TenantName = 2, "Soon"
	ahead := stay(800000, "monthly", date(2026, time.July, 1), 800000*4) // paid Jul–Oct; in credit
	ahead.StayID, ahead.TenantName = 3, "Ahead"
	ahead.LastPaymentType = nullStr("online")

	rows := buildPayees([]collectionStayRow{ahead, soon, behind}, collectionsToday)
	if len(rows) != 3 {
		t.Fatalf("got %d rows, want all three active stays", len(rows))
	}

	want := []struct {
		name, date, state string
		balance, due      int64
		days              int
	}{
		{"Behind", "2026-08-05", dueOverdue, 650000, 650000, 6},
		{"Soon", "2026-08-14", dueUpcoming, 0, 500000, 0},
		{"Ahead", "2026-11-01", duePaidAhead, 0, 800000, 0},
	}
	for i, w := range want {
		r := rows[i]
		if r.TenantName != w.name || *r.DueDate != w.date || *r.DueState != w.state ||
			r.BalancePaise != w.balance || *r.DuePaise != w.due || r.DaysSinceDue != w.days {
			t.Errorf("row %d: got %s due %s %s, owes ₹%d, next ₹%d, %d days; want %s due %s %s, owes ₹%d, next ₹%d, %d days",
				i, r.TenantName, *r.DueDate, *r.DueState, r.BalancePaise/100, *r.DuePaise/100, r.DaysSinceDue,
				w.name, w.date, w.state, w.balance/100, w.due/100, w.days)
		}
	}
	if rows[2].LastPaymentType == nil || *rows[2].LastPaymentType != "online" {
		t.Errorf("last payment type = %v, want online, so the form can prefill it", rows[2].LastPaymentType)
	}
	if rows[0].LastPaymentType != nil {
		t.Errorf("a stay with no recorded type should send none, got %s", *rows[0].LastPaymentType)
	}

}

// Payments' "Deposit still owed" (Oct 2026): what is left of the agreed
// deposit, on the board row, and nothing where nothing should be chased.
func TestPayeeRow_DepositOwed(t *testing.T) {
	cases := []struct {
		name          string
		agreed, paid  int64
		booking       bool
		owed, showsAs int64 // owed is deposit_owed_paise; showsAs is deposit_amount
	}{
		{"nothing paid", 1400000, 0, false, 1400000, 1400000},
		{"half paid", 1400000, 650000, false, 750000, 1400000},
		{"paid in full", 1400000, 1400000, false, 0, 0},
		{"paid more than agreed", 1000000, 1200000, false, 0, 0},
		{"no deposit agreed", 0, 0, false, 0, 0},
		{"a booking pays on arrival", 1400000, 0, true, 0, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s := stay(700000, "monthly", date(2026, time.July, 5), 700000)
			s.DepositAmount, s.DepositPaid = c.agreed, c.paid
			if c.booking {
				s.BedName = sql.NullString{}
			}
			row := payeeRow(s, collectionsToday)
			if row.DepositOwedPaise != c.owed || row.DepositAmount != c.showsAs {
				t.Fatalf("owed %d of %d, want %d of %d", row.DepositOwedPaise, row.DepositAmount, c.owed, c.showsAs)
			}
			// A deposit is never rent: the rent balance is the same either way.
			if row.BalancePaise != 700000 {
				t.Fatalf("rent balance %d, want 700000", row.BalancePaise)
			}
		})
	}
}
