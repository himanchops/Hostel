package handlers

import (
	"database/sql"
	"testing"
	"time"
)

// Small constructors so table rows can carry optional values inline.
func ptr(t time.Time) *time.Time        { return &t }
func nullInt(v int64) sql.NullInt64     { return sql.NullInt64{Int64: v, Valid: true} }
func nullStr(v string) sql.NullString   { return sql.NullString{String: v, Valid: true} }
func nullTime(v time.Time) sql.NullTime { return sql.NullTime{Time: v, Valid: true} }

// Balance is total_paid − total_expected, so a negative balance means the
// tenant owes. The two thresholds that decide the colour of a bed:
//
//	balance >= 0            → paid    (settled, or in credit)
//	-rent < balance < 0     → partial (owes less than one full cycle)
//	balance <= -rent        → overdue (a whole cycle or more behind)
//
// The boundary at exactly one cycle owed is the one that matters: owing the
// full rent is overdue, owing one paise less is still partial.
func TestComputeBedStatus_BalanceThresholds(t *testing.T) {
	today := date(2026, time.August, 11)
	const rent = 750000 // ₹7,500 in paise

	tests := []struct {
		name    string
		balance int64
		want    BedStatus
	}{
		{"in credit — paid two cycles ahead", 1500000, StatusPaid},
		{"credit of one paise", 1, StatusPaid},
		{"settled exactly", 0, StatusPaid},
		{"owes one paise", -1, StatusPartial},
		{"owes half a cycle", -375000, StatusPartial},
		{"owes one paise less than a full cycle", -(rent - 1), StatusPartial},
		{"owes exactly one full cycle", -rent, StatusOverdue},
		{"owes one paise more than a full cycle", -(rent + 1), StatusOverdue},
		{"owes three cycles", -3 * rent, StatusOverdue},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := computeBedStatus(tt.balance, rent, nil, nil, today)
			if got != tt.want {
				t.Errorf("computeBedStatus(balance=%d, rent=%d) = %q, want %q",
					tt.balance, rent, got, tt.want)
			}
		})
	}
}

// The threshold scales with the stay's own rent, not with a fixed amount: the
// same ₹5,000 shortfall is partial for a ₹12,000 room and overdue for a ₹5,000
// one.
func TestComputeBedStatus_ThresholdScalesWithRent(t *testing.T) {
	today := date(2026, time.August, 11)
	const owed = -500000 // ₹5,000 short

	if got := computeBedStatus(owed, 1200000, nil, nil, today); got != StatusPartial {
		t.Errorf("₹5,000 short on ₹12,000 rent = %q, want %q", got, StatusPartial)
	}
	if got := computeBedStatus(owed, 500000, nil, nil, today); got != StatusOverdue {
		t.Errorf("₹5,000 short on ₹5,000 rent = %q, want %q", got, StatusOverdue)
	}
	if got := computeBedStatus(owed, 400000, nil, nil, today); got != StatusOverdue {
		t.Errorf("₹5,000 short on ₹4,000 rent = %q, want %q", got, StatusOverdue)
	}
}

// A rent-free bed (staff room, caretaker) can never be behind: with no cycle
// amount there is no cycle to fall a cycle behind on.
func TestComputeBedStatus_ZeroRentIsAlwaysPaid(t *testing.T) {
	today := date(2026, time.August, 11)

	for _, balance := range []int64{0, -1, -500000} {
		if got := computeBedStatus(balance, 0, nil, nil, today); got != StatusPaid {
			t.Errorf("zero rent with balance %d = %q, want %q", balance, got, StatusPaid)
		}
	}
}

// An expected departure inside 30 days marks the bed as vacating; one that has
// already passed marks it as departure_due instead.
//
// This test used to run against `end_date` and asserted that a past date still
// read as "vacating_soon" — behaviour that could never happen in production,
// because the grid only loads stays WHERE end_date IS NULL, so the parameter was
// always nil by the time it arrived. It was a passing test for unreachable
// code. Migration 006 gave the branch a field it can actually receive.
func TestComputeBedStatus_VacatingWindow(t *testing.T) {
	today := date(2026, time.August, 11)
	const rent = 750000

	tests := []struct {
		name        string
		expectedEnd time.Time
		want        BedStatus
	}{
		{"leaves today", today, StatusVacatingSoon},
		{"was due to leave last week — nobody confirmed", date(2026, time.August, 4), StatusDepartureDue},
		{"was due to leave months ago", date(2026, time.February, 1), StatusDepartureDue},
		{"leaves in 29 days", date(2026, time.September, 9), StatusVacatingSoon},
		{"leaves in exactly 30 days", date(2026, time.September, 10), StatusVacatingSoon},
		{"leaves in 31 days — outside the window", date(2026, time.September, 11), StatusPaid},
		{"leaves in three months", date(2026, time.November, 11), StatusPaid},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := computeBedStatus(0, rent, nil, ptr(tt.expectedEnd), today)
			if got != tt.want {
				t.Errorf("expected_end_date %s = %q, want %q",
					tt.expectedEnd.Format("2006-01-02"), got, tt.want)
			}
		})
	}
}

// A departure the owner has not confirmed outranks the money. The bed may hold
// someone who left a month ago or someone who never went; either way the
// question needs answering before the balance is worth reading.
func TestComputeBedStatus_DepartureDueOutranksArrears(t *testing.T) {
	today := date(2026, time.August, 11)
	const rent = 750000

	overdueBalance := int64(-3 * rent) // three cycles behind
	pastDue := ptr(date(2026, time.July, 1))

	if got := computeBedStatus(overdueBalance, rent, nil, pastDue, today); got != StatusDepartureDue {
		t.Errorf("three cycles behind AND past due = %q, want %q", got, StatusDepartureDue)
	}
	// Without the expected date it is simply overdue, so the arrears path is
	// not being masked in general — only by an unanswered question.
	if got := computeBedStatus(overdueBalance, rent, nil, nil, today); got != StatusOverdue {
		t.Errorf("three cycles behind, no expected date = %q, want %q", got, StatusOverdue)
	}
}

// Notice given is vacating regardless of how far out the end date is, or
// whether an end date exists at all.
func TestComputeBedStatus_NoticeAlwaysVacating(t *testing.T) {
	today := date(2026, time.August, 11)
	const rent = 750000

	notice := ptr(date(2026, time.August, 1))
	farOff := ptr(date(2027, time.June, 30))

	if got := computeBedStatus(0, rent, notice, nil, today); got != StatusVacatingSoon {
		t.Errorf("notice with no expected date = %q, want %q", got, StatusVacatingSoon)
	}
	if got := computeBedStatus(0, rent, notice, farOff, today); got != StatusVacatingSoon {
		t.Errorf("notice with a far-off expected date = %q, want %q", got, StatusVacatingSoon)
	}
}

// Vacating outranks the money status: a tenant on notice reads orange even
// while owing several cycles. The collections view — not the grid — is where
// what they owe on the way out gets chased.
func TestComputeBedStatus_VacatingOutranksBalance(t *testing.T) {
	today := date(2026, time.August, 11)
	const rent = 750000

	tests := []struct {
		name       string
		balance    int64
		noticeDate *time.Time
		endDate    *time.Time
	}{
		{"overdue with notice", -3 * rent, ptr(date(2026, time.August, 1)), nil},
		{"partial with notice", -100000, ptr(date(2026, time.August, 1)), nil},
		{"overdue, ending inside the window", -3 * rent, nil, ptr(date(2026, time.August, 20))},
		{"in credit, ending inside the window", 500000, nil, ptr(date(2026, time.August, 20))},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := computeBedStatus(tt.balance, rent, tt.noticeDate, tt.endDate, today)
			if got != StatusVacatingSoon {
				t.Errorf("computeBedStatus = %q, want %q", got, StatusVacatingSoon)
			}
		})
	}
}

// The status a bed gets from a real grid row: an occupied bed's balance comes
// from cyclesElapsed × rent against what was actually paid, and a bed with no
// stay is vacant no matter what else the row carries.
func TestBuildBed_StatusFromStayAndPayments(t *testing.T) {
	today := date(2026, time.August, 11)
	const rent = 600000 // ₹6,000

	// Moved in 2026-02-20; rollovers on the 20th of Mar–Jul, so 6 cycles are
	// due by August 11 — ₹36,000 expected.
	occupied := func(paid int64) gridRow {
		return gridRow{
			BedID:      nullInt(11),
			BedName:    nullStr("A1"),
			StayID:     nullInt(501),
			RentAmount: nullInt(rent),
			RentCycle:  nullStr("monthly"),
			StartDate:  nullTime(date(2026, time.February, 20)),
			TenantID:   nullInt(77),
			TenantName: nullStr("Asha Rao"),
			TotalPaid:  paid,
		}
	}

	paidUp := buildBed(occupied(6*rent), today)
	if *paidUp.TotalExpected != 6*rent {
		t.Errorf("TotalExpected = %d, want %d", *paidUp.TotalExpected, 6*rent)
	}
	if *paidUp.Balance != 0 {
		t.Errorf("Balance = %d, want 0", *paidUp.Balance)
	}
	if paidUp.Status != StatusPaid {
		t.Errorf("Status = %q, want %q", paidUp.Status, StatusPaid)
	}

	// Five cycles paid out of six — a full cycle behind.
	behind := buildBed(occupied(5*rent), today)
	if *behind.Balance != -rent {
		t.Errorf("Balance = %d, want %d", *behind.Balance, -rent)
	}
	if behind.Status != StatusOverdue {
		t.Errorf("Status = %q, want %q", behind.Status, StatusOverdue)
	}

	// Half of that last cycle paid — still partial.
	partial := buildBed(occupied(5*rent+300000), today)
	if *partial.Balance != -300000 {
		t.Errorf("Balance = %d, want -300000", *partial.Balance)
	}
	if partial.Status != StatusPartial {
		t.Errorf("Status = %q, want %q", partial.Status, StatusPartial)
	}

	vacant := buildBed(gridRow{BedID: nullInt(12), BedName: nullStr("A2")}, today)
	if vacant.Status != StatusVacant {
		t.Errorf("Status = %q, want %q", vacant.Status, StatusVacant)
	}
	if vacant.Balance != nil || vacant.Tenant != nil || vacant.StayID != nil {
		t.Error("a vacant bed must not carry stay, tenant or money fields")
	}
}
