package handlers

import (
	"testing"
	"time"
)

// UX audit M3. On 9 Sep the dashboard said ₹69,900 collected and Insights said
// ₹53,600; the gap was exactly two payments dated the 13th (₹8,500) and the
// 17th (₹7,800). Same ledger here, four payments, and only what is dated on or
// before today counts.
func TestCollectedWindow_StopsAtToday(t *testing.T) {
	today := date(2026, time.September, 9)
	from, until := collectedWindow(today)

	if !from.Equal(date(2026, time.September, 1)) || !until.Equal(date(2026, time.September, 10)) {
		t.Fatalf("window = [%s, %s), want [2026-09-01, 2026-09-10)",
			from.Format("2006-01-02"), until.Format("2006-01-02"))
	}

	ledger := []struct {
		on     time.Time
		amount int64
	}{
		{date(2026, time.September, 2), 3000000}, // ₹30,000
		{date(2026, time.September, 9), 2360000}, // ₹23,600 — today counts
		{date(2026, time.September, 13), 850000}, // ₹8,500 — not yet
		{date(2026, time.September, 17), 780000}, // ₹7,800 — not yet
	}
	var collected int64
	for _, p := range ledger {
		if !p.on.Before(from) && p.on.Before(until) {
			collected += p.amount
		}
	}
	if collected != 5360000 {
		t.Errorf("collected = %d, want 5360000 (₹53,600, Insights' figure) — the old window gave 6990000", collected)
	}
}

// On the last day of the month "up to today" and "the whole month" are the same
// window; it must not run into the next month.
func TestCollectedWindow_LastDayIsTheWholeMonth(t *testing.T) {
	from, until := collectedWindow(date(2026, time.September, 30))
	if !from.Equal(date(2026, time.September, 1)) || !until.Equal(date(2026, time.October, 1)) {
		t.Errorf("window = [%s, %s), want [2026-09-01, 2026-10-01)",
			from.Format("2006-01-02"), until.Format("2006-01-02"))
	}

	_, until = collectedWindow(date(2026, time.December, 31))
	if !until.Equal(date(2027, time.January, 1)) {
		t.Errorf("until on 31 Dec = %s, want 2027-01-01", until.Format("2006-01-02"))
	}
}

func TestCollectedWindow_FirstOfTheMonth(t *testing.T) {
	from, until := collectedWindow(date(2026, time.October, 1))
	if !from.Equal(date(2026, time.October, 1)) || !until.Equal(date(2026, time.October, 2)) {
		t.Errorf("window = [%s, %s), want [2026-10-01, 2026-10-02)",
			from.Format("2006-01-02"), until.Format("2006-01-02"))
	}
}

// A payment dated after tomorrow is refused. Tomorrow itself is allowed: the
// server's "today" is UTC, and just after midnight in India the owner's today
// is already the server's tomorrow.
func TestValidatePaymentDate(t *testing.T) {
	now := time.Date(2026, time.September, 9, 20, 0, 0, 0, time.UTC) // 01:30 on the 10th in IST

	for _, ok := range []time.Time{
		date(2025, time.January, 15),   // backfilled from last year
		date(2026, time.September, 9),  // today, UTC
		date(2026, time.September, 10), // today, IST
	} {
		if err := validatePaymentDate(ok, now); err != nil {
			t.Errorf("%s should be allowed, got %v", ok.Format("2006-01-02"), err)
		}
	}
	for _, bad := range []time.Time{
		date(2026, time.September, 11),
		date(2026, time.September, 13), // the audit's
		date(2026, time.September, 17), // the audit's
	} {
		if err := validatePaymentDate(bad, now); err == nil {
			t.Errorf("%s should be refused as future-dated", bad.Format("2006-01-02"))
		}
	}
}
