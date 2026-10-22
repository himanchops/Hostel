package handlers

import (
	"testing"
	"time"
)

func TestDueFor(t *testing.T) {
	today := date(2026, time.October, 21)
	flat := func(start time.Time, rent int64) rentSchedule { return flatSchedule(start, rent) }

	cases := []struct {
		name      string
		sched     rentSchedule
		start     time.Time
		paid      int64
		wantDate  time.Time
		wantPaise int64
		wantState string
	}{
		{
			// Moved in 15 Sep at ₹6,500, paid Sep and Oct: next is 15 Nov.
			name: "square", sched: flat(date(2026, time.September, 15), 650000),
			start: date(2026, time.September, 15), paid: 1300000,
			wantDate: date(2026, time.November, 15), wantPaise: 650000, wantState: dueUpcoming,
		},
		{
			// Paid Sep only: behind since the Oct cycle began.
			name: "one month behind", sched: flat(date(2026, time.September, 15), 650000),
			start: date(2026, time.September, 15), paid: 650000,
			wantDate: date(2026, time.October, 15), wantPaise: 650000, wantState: dueOverdue,
		},
		{
			// Paid Sep and ₹2,500 of Oct: still behind since 15 Oct, ₹4,000 short on it.
			name: "part of a month paid", sched: flat(date(2026, time.September, 15), 650000),
			start: date(2026, time.September, 15), paid: 900000,
			wantDate: date(2026, time.October, 15), wantPaise: 400000, wantState: dueOverdue,
		},
		{
			// Moved in on the 21st of last month: today's cycle is billed and unpaid.
			name: "due today", sched: flat(date(2026, time.September, 21), 550000),
			start: date(2026, time.September, 21), paid: 550000,
			wantDate: today, wantPaise: 550000, wantState: dueToday,
		},
		{
			// Paid Oct, Nov and Dec on a 15 Oct move-in: nothing due until 15 Jan.
			name: "paid ahead", sched: flat(date(2026, time.October, 15), 850000),
			start: date(2026, time.October, 15), paid: 2550000,
			wantDate: date(2027, time.January, 15), wantPaise: 850000, wantState: duePaidAhead,
		},
		{
			// A 31 Aug move-in: September has no 31st, so its cycle began on the
			// 30th; October's is the 31st. Paid Aug and Sep, so next is 31 Oct.
			name: "31st across a short month", sched: flat(date(2026, time.August, 31), 600000),
			start: date(2026, time.August, 31), paid: 1200000,
			wantDate: date(2026, time.October, 31), wantPaise: 600000, wantState: dueUpcoming,
		},
		{
			// Rent ₹9,000 from 20 Sep, ₹9,500 from 20 Oct, both paid: the next
			// due is at the new rent.
			name: "after a rent change", sched: rentSchedule{
				{From: date(2026, time.September, 20), Rent: 900000},
				{From: date(2026, time.October, 20), Rent: 950000},
			},
			start: date(2026, time.September, 20), paid: 1850000,
			wantDate: date(2026, time.November, 20), wantPaise: 950000, wantState: dueUpcoming,
		},
		{
			// Booked to arrive next month and paid nothing yet: the first rent
			// is due on arrival, not overdue.
			name: "moves in later", sched: flat(date(2026, time.November, 1), 500000),
			start: date(2026, time.November, 1), paid: 0,
			wantDate: date(2026, time.November, 1), wantPaise: 500000, wantState: dueUpcoming,
		},
	}
	// A rent-free bed: nothing is ever due, so no date and no state, rather
	// than "overdue since move-in" on ₹0.
	if got := dueFor(flat(date(2026, time.June, 1), 0), date(2026, time.June, 1), "monthly", 0, today); got.State != "" {
		t.Errorf("rent-free: got %s %s, want nothing due", got.Date.Format("2 Jan 2006"), got.State)
	}

	for _, c := range cases {
		got := dueFor(c.sched, c.start, "monthly", c.paid, today)
		if !got.Date.Equal(c.wantDate) || got.Paise != c.wantPaise || got.State != c.wantState {
			t.Errorf("%s: got %s ₹%d %s, want %s ₹%d %s", c.name,
				got.Date.Format("2 Jan 2006"), got.Paise/100, got.State,
				c.wantDate.Format("2 Jan 2006"), c.wantPaise/100, c.wantState)
		}
	}
}

func TestSummary_DueIsTheOpenStays(t *testing.T) {
	today := date(2026, time.October, 21)
	ended := date(2026, time.August, 31)
	open := summarize([]staySummaryRow{
		{RentAmount: 450000, RentCycle: "monthly", StartDate: date(2026, time.June, 1), EndDate: &ended, TotalPaid: 1350000},
		{RentAmount: 500000, RentCycle: "monthly", StartDate: date(2026, time.October, 14), TotalPaid: 500000},
	}, today)
	if open.DueDate == nil || *open.DueDate != "2026-11-14" || *open.DuePaise != 500000 || *open.DueState != dueUpcoming {
		t.Errorf("due = %v %v %v, want 2026-11-14 500000 upcoming", deref(open.DueDate), derefI(open.DuePaise), deref(open.DueState))
	}

	gone := summarize([]staySummaryRow{
		{RentAmount: 450000, RentCycle: "monthly", StartDate: date(2026, time.June, 1), EndDate: &ended, TotalPaid: 1350000},
	}, today)
	if gone.DueDate != nil {
		t.Errorf("a tenant with no open stay has nothing due, got %s", *gone.DueDate)
	}
}

func deref(s *string) string {
	if s == nil {
		return "<nil>"
	}
	return *s
}

func derefI(n *int64) int64 {
	if n == nil {
		return -1
	}
	return *n
}
