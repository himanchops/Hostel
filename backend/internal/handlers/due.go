package handlers

import "time"

// When is this tenant's rent due? The owner asked to see it at a glance. The
// app has always billed on each stay's anchor day (cycleStart), but no screen
// said when that was, so the answer could only be inferred from the payments.
//
// rentDue is that answer for one open stay, in the shape the screens say it:
//
//	overdue     the oldest cycle not fully paid began before today
//	            ("due 15 Oct" on a red tile; "Overdue since 15 Oct")
//	due_today   a cycle began today and is not yet paid
//	upcoming    paid up to now; the next cycle begins on Date
//	paid_ahead  paid past the cycle billed now; nothing is due until Date
//
// A stay with no rent to pay (a rent-free bed) has nothing due, ever: dueFor
// returns the zero rentDue, State "", and callers send no due fields.
//
// Date is always the start of the oldest cycle not fully paid. Behind, that is
// the day they fell behind; square or ahead, it is the day the next payment
// falls due. Paise is what is still owed on that one cycle: less than a full
// rent when part of it is paid already.
type rentDue struct {
	Date  time.Time
	Paise int64
	State string
}

const (
	dueOverdue   = "overdue"
	dueToday     = "due_today"
	dueUpcoming  = "upcoming"
	duePaidAhead = "paid_ahead"
)

// dueFor works out a stay's next due rent from the same rules that bill it:
// cyclesElapsed for what has been billed, paidThrough for how many cycles the
// money covers (oldest first, the rule Collections uses for days overdue), and
// cycleStart for the date. Nothing here is re-derived on the client.
func dueFor(sched rentSchedule, start time.Time, cycle string, totalPaid int64, today time.Time) rentDue {
	start, today = dateOnly(start), dateOnly(today)
	billed := cyclesElapsed(start, today, cycle)
	// Far enough ahead that a tenant who paid a year in advance still reads
	// as paid ahead, not as a loop that stopped counting.
	paid := sched.paidThrough(start, cycle, totalPaid, billed+240)

	date := cycleStart(start, paid+1, cycle)
	if sched.at(date) <= 0 {
		return rentDue{}
	}
	credit := totalPaid - sched.billed(start, cycle, 0, paid)
	due := rentDue{Date: date, Paise: sched.at(date) - credit}

	switch {
	case date.Equal(today):
		due.State = dueToday
	case date.Before(today):
		due.State = dueOverdue
	case paid > billed:
		due.State = duePaidAhead
	default:
		due.State = dueUpcoming
	}
	return due
}
